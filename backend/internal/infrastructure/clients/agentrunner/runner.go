// Package agentrunner starts the agent CLIs with this server attached over MCP and turns their JSON output into
// AgentEvents:
//
//	claude -p --output-format stream-json --verbose --mcp-config '<json>' --strict-mcp-config \
//	       --allowedTools mcp__projmap --permission-mode dontAsk      (prompt on stdin)
//	codex exec --json --skip-git-repo-check --sandbox read-only \
//	       -c mcp_servers.projmap.command="<projmap>" -c mcp_servers.projmap.args=["mcp","--token","<t>","--url","<mcp>"] \
//	       -c approval_policy="never" "<prompt>"
//
// Claude reaches /mcp over streamable HTTP with the scoped token as a bearer header; Codex goes through the stdio
// bridge (`projmap mcp`). Both binaries are looked up in PATH plus the usual install folders.
package agentrunner

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	agentport "projmap/internal/application/ports/out/agents"
	"projmap/internal/domain/agents"
)

// Runner implements the agents.Runner port.
type Runner struct {
	// Lookup finds a binary (exec.LookPath plus common folders); replaceable in tests.
	Lookup func(name string) (string, error)
}

var _ agentport.Runner = (*Runner)(nil)

// New makes a runner.
func New() *Runner { return &Runner{Lookup: lookup} }

func lookup(name string) (string, error) {
	if p, err := exec.LookPath(name); err == nil {
		return p, nil
	}
	home, _ := os.UserHomeDir()
	for _, dir := range []string{"/opt/homebrew/bin", "/usr/local/bin", filepath.Join(home, ".local/bin"), filepath.Join(home, ".npm-global/bin"),
		filepath.Join(home, ".bun/bin"), filepath.Join(home, ".claude/local")} {
		p := filepath.Join(dir, name)
		if st, err := os.Stat(p); err == nil && !st.IsDir() && st.Mode()&0o111 != 0 {
			return p, nil
		}
	}
	return "", fmt.Errorf("%s not found", name)
}

func (r *Runner) Available(agent string) string {
	if _, err := r.Lookup(agent); err != nil {
		name := map[string]string{"codex": "Codex", "claude": "Claude Code"}[agent]
		return fmt.Sprintf("%s is not installed on this Mac (no %s command found). Install it or pick the other agent.", name, agent)
	}
	return ""
}

// Command builds the CLI invocation (exported for tests).
func Command(bin string, spec agentport.Spec) (args []string, stdin string) {
	switch spec.Agent {
	case "claude":
		cfg, _ := json.Marshal(map[string]any{"mcpServers": map[string]any{"projmap": map[string]any{
			"type": "http", "url": spec.MCPURL, "headers": map[string]string{"Authorization": "Bearer " + spec.Token}}}})
		return []string{"-p", "--output-format", "stream-json", "--verbose", "--mcp-config", string(cfg), "--strict-mcp-config",
			"--allowedTools", "mcp__projmap", "--permission-mode", "dontAsk"}, spec.Prompt
	default:
		self, _ := json.Marshal(spec.Self)
		margs, _ := json.Marshal([]string{"mcp", "--token", spec.Token, "--url", spec.MCPURL})
		return []string{"exec", "--json", "--skip-git-repo-check", "--sandbox", "read-only",
			"-c", "mcp_servers.projmap.command=" + string(self), "-c", "mcp_servers.projmap.args=" + string(margs),
			"-c", `approval_policy="never"`, spec.Prompt}, ""
	}
}

func (r *Runner) Run(ctx context.Context, spec agentport.Spec, emit func(agents.Event)) error {
	bin, err := r.Lookup(spec.Agent)
	if err != nil {
		return fmt.Errorf("%s is not installed", spec.Agent)
	}
	args, stdin := Command(bin, spec)
	cmd := exec.CommandContext(ctx, bin, args...)
	cmd.Dir = spec.WorkDir
	cmd.Env = append(os.Environ(), "PROJMAP_AGENT=1")
	cmd.WaitDelay = 3 * time.Second
	if stdin != "" {
		cmd.Stdin = strings.NewReader(stdin)
	}
	out, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	var stderr tail
	cmd.Stderr = &stderr
	if err := cmd.Start(); err != nil {
		return err
	}
	p := newParser(spec.Agent, emit)
	sc := bufio.NewScanner(out)
	sc.Buffer(make([]byte, 1<<20), 16<<20)
	for sc.Scan() {
		p.line(sc.Bytes())
	}
	err = cmd.Wait()
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if err != nil {
		if msg := stderr.String(); msg != "" {
			return fmt.Errorf("%v: %s", err, msg)
		}
		if p.failure != "" {
			return fmt.Errorf("%s", p.failure)
		}
		return err
	}
	if p.failure != "" {
		return fmt.Errorf("%s", p.failure)
	}
	return nil
}

// tail keeps the last 2 KB of stderr.
type tail struct {
	mu  sync.Mutex
	buf []byte
}

func (t *tail) Write(b []byte) (int, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.buf = append(t.buf, b...)
	if len(t.buf) > 2048 {
		t.buf = t.buf[len(t.buf)-2048:]
	}
	return len(b), nil
}

func (t *tail) String() string {
	t.mu.Lock()
	defer t.mu.Unlock()
	return strings.TrimSpace(string(t.buf))
}

var _ io.Writer = (*tail)(nil)

// parser turns JSON lines into events.
type parser struct {
	agent   string
	emit    func(agents.Event)
	started map[string]toolStart
	failure string
}

type toolStart struct {
	name, text string
	at         time.Time
}

func newParser(agent string, emit func(agents.Event)) *parser {
	return &parser{agent: agent, emit: emit, started: map[string]toolStart{}}
}

// ToolName strips the MCP prefixes (mcp__projmap__scene_get → scene_get).
func ToolName(n string) string {
	if i := strings.LastIndex(n, "__"); i >= 0 {
		return n[i+2:]
	}
	return n
}

// summarize is a short text for a tool call's input.
func summarize(input json.RawMessage) string {
	var m map[string]any
	if json.Unmarshal(input, &m) == nil {
		for _, k := range []string{"name", "summary", "names", "surface", "id", "effect", "pattern", "action"} {
			if v, ok := m[k]; ok {
				switch x := v.(type) {
				case string:
					return x
				case []any:
					parts := make([]string, 0, len(x))
					for _, e := range x {
						parts = append(parts, fmt.Sprint(e))
					}
					return strings.Join(parts, ", ")
				}
			}
		}
		if len(m) == 0 {
			return ""
		}
	}
	s := string(input)
	if len(s) > 120 {
		s = s[:120] + "…"
	}
	return s
}

func okp(b bool) *bool { return &b }

func (p *parser) line(b []byte) {
	var ev map[string]json.RawMessage
	if json.Unmarshal(b, &ev) != nil {
		return
	}
	var typ string
	_ = json.Unmarshal(ev["type"], &typ)
	if p.agent == "claude" {
		p.claude(typ, ev)
	} else {
		p.codex(typ, ev)
	}
}

// ParseLines feeds JSON lines through the parser (tests).
func ParseLines(agent string, lines []string) ([]agents.Event, string) {
	var out []agents.Event
	p := newParser(agent, func(e agents.Event) { out = append(out, e) })
	for _, l := range lines {
		p.line([]byte(l))
	}
	return out, p.failure
}

func (p *parser) claude(typ string, ev map[string]json.RawMessage) {
	switch typ {
	case "assistant", "user":
		var msg struct {
			Content []struct {
				Type      string          `json:"type"`
				Text      string          `json:"text"`
				ID        string          `json:"id"`
				Name      string          `json:"name"`
				Input     json.RawMessage `json:"input"`
				ToolUseID string          `json:"tool_use_id"`
				IsError   bool            `json:"is_error"`
			} `json:"content"`
		}
		_ = json.Unmarshal(ev["message"], &msg)
		for _, c := range msg.Content {
			switch c.Type {
			case "text":
				if t := strings.TrimSpace(c.Text); t != "" {
					p.emit(agents.Event{Kind: agents.KindMessage, Text: t})
				}
			case "tool_use":
				if c.Name == "ToolSearch" { // Claude Code loading tool schemas, not work
					continue
				}
				p.started[c.ID] = toolStart{name: ToolName(c.Name), text: summarize(c.Input), at: time.Now()}
			case "tool_result":
				st, ok := p.started[c.ToolUseID]
				if !ok {
					continue
				}
				delete(p.started, c.ToolUseID)
				p.emit(agents.Event{Kind: agents.KindTool, Tool: st.name, Text: st.text, DurationMs: time.Since(st.at).Milliseconds(), OK: okp(!c.IsError)})
			}
		}
	case "result":
		var r struct {
			IsError bool   `json:"is_error"`
			Result  string `json:"result"`
			Subtype string `json:"subtype"`
		}
		_ = json.Unmarshal(mustJSON(ev), &r)
		if r.IsError {
			p.failure = strings.TrimSpace(r.Result + " " + r.Subtype)
		}
	}
}

func (p *parser) codex(typ string, ev map[string]json.RawMessage) {
	switch typ {
	case "item.started", "item.completed":
		var it struct {
			ID        string          `json:"id"`
			Type      string          `json:"type"`
			Text      string          `json:"text"`
			Tool      string          `json:"tool"`
			Arguments json.RawMessage `json:"arguments"`
			Status    string          `json:"status"`
			Command   string          `json:"command"`
		}
		_ = json.Unmarshal(ev["item"], &it)
		switch it.Type {
		case "agent_message":
			if typ == "item.completed" && strings.TrimSpace(it.Text) != "" {
				p.emit(agents.Event{Kind: agents.KindMessage, Text: strings.TrimSpace(it.Text)})
			}
		case "mcp_tool_call":
			if typ == "item.started" {
				p.started[it.ID] = toolStart{name: ToolName(it.Tool), text: summarize(it.Arguments), at: time.Now()}
				return
			}
			st, ok := p.started[it.ID]
			if !ok {
				st = toolStart{name: ToolName(it.Tool), text: summarize(it.Arguments), at: time.Now()}
			}
			delete(p.started, it.ID)
			p.emit(agents.Event{Kind: agents.KindTool, Tool: st.name, Text: st.text, DurationMs: time.Since(st.at).Milliseconds(), OK: okp(it.Status != "failed")})
		case "command_execution":
			if typ == "item.completed" {
				p.emit(agents.Event{Kind: agents.KindTool, Tool: "shell", Text: it.Command, OK: okp(it.Status != "failed")})
			}
		}
	case "turn.failed", "error":
		var e struct {
			Message string `json:"message"`
			Error   struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		_ = json.Unmarshal(mustJSON(ev), &e)
		p.failure = strings.TrimSpace(e.Message + " " + e.Error.Message)
	}
}

func mustJSON(m map[string]json.RawMessage) []byte {
	b, _ := json.Marshal(m)
	return b
}
