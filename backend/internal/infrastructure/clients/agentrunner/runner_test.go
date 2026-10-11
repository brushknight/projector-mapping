package agentrunner

import (
	"strings"
	"testing"

	agentport "projmap/internal/application/ports/out/agents"
)

func TestClaudeStream(t *testing.T) {
	ev, fail := ParseLines("claude", []string{
		`{"type":"system","subtype":"init"}`,
		`{"type":"assistant","message":{"content":[{"type":"text","text":"Looking at the scene."},{"type":"tool_use","id":"tu1","name":"mcp__projmap__surface_create","input":{"name":"top"}}]}}`,
		`{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"tu1","is_error":false}]}}`,
		`not json`,
		`{"type":"result","subtype":"success","is_error":false,"result":"done"}`,
	})
	if fail != "" || len(ev) != 2 || ev[0].Kind != "message" || ev[1].Tool != "surface_create" || ev[1].Text != "top" || !*ev[1].OK {
		t.Fatalf("events %+v %q", ev, fail)
	}
	_, fail = ParseLines("claude", []string{`{"type":"result","subtype":"error_max_turns","is_error":true,"result":"stopped"}`})
	if !strings.Contains(fail, "stopped") {
		t.Fatalf("failure %q", fail)
	}
}

func TestCodexStream(t *testing.T) {
	ev, fail := ParseLines("codex", []string{
		`{"type":"thread.started","thread_id":"x"}`,
		`{"type":"item.started","item":{"id":"i1","type":"mcp_tool_call","server":"projmap","tool":"scene_get","arguments":{},"status":"in_progress"}}`,
		`{"type":"item.completed","item":{"id":"i1","type":"mcp_tool_call","server":"projmap","tool":"scene_get","status":"failed"}}`,
		`{"type":"item.completed","item":{"id":"i2","type":"agent_message","text":"Mapped three faces."}}`,
		`{"type":"turn.completed"}`,
	})
	if fail != "" || len(ev) != 2 || ev[0].Tool != "scene_get" || *ev[0].OK || ev[1].Text != "Mapped three faces." {
		t.Fatalf("events %+v", ev)
	}
}

func TestCommand(t *testing.T) {
	args, stdin := Command("claude", agentport.Spec{Agent: "claude", Prompt: "p", MCPURL: "http://127.0.0.1:7400/mcp", Token: "tok_1"})
	j := strings.Join(args, " ")
	if stdin != "p" || !strings.Contains(j, "--output-format stream-json") || !strings.Contains(j, "Bearer tok_1") || !strings.Contains(j, "--strict-mcp-config") {
		t.Fatalf("claude %v", args)
	}
	args, stdin = Command("codex", agentport.Spec{Agent: "codex", Prompt: "p", MCPURL: "u", Token: "tok_1", Self: "/bin/projmap"})
	j = strings.Join(args, " ")
	if stdin != "" || args[0] != "exec" || args[len(args)-1] != "p" || !strings.Contains(j, `mcp_servers.projmap.command="/bin/projmap"`) {
		t.Fatalf("codex %v", args)
	}
}
