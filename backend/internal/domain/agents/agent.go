// Package agents holds agent sessions (Codex or Claude runs), their event log and the agent permission settings.
package agents

import "time"

// Session statuses.
const (
	Running   = "running"
	Done      = "done"
	Failed    = "failed"
	Cancelled = "cancelled"
)

// Session is one agent run.
type Session struct {
	ID        string    `json:"id"`
	Agent     string    `json:"agent"`
	Prompt    string    `json:"prompt"`
	Status    string    `json:"status"`
	SceneID   string    `json:"sceneId"`
	DraftID   string    `json:"draftId"`
	CreatedAt time.Time `json:"createdAt"`
}

// IsValidAgent tells whether the runner knows the agent.
func IsValidAgent(a string) bool { return a == "codex" || a == "claude" }

// Event kinds.
const (
	KindMessage = "message"
	KindTool    = "tool"
	KindStatus  = "status"
)

// Event is one line of a session's log.
type Event struct {
	Seq        int       `json:"seq"`
	Kind       string    `json:"kind"`
	Tool       string    `json:"tool,omitempty"`
	Text       string    `json:"text"`
	DurationMs int64     `json:"durationMs,omitempty"`
	OK         *bool     `json:"ok,omitempty"`
	TS         time.Time `json:"ts"`
}

// Settings are the editor's agent toggles; both are off by default.
type Settings struct {
	AgentMayPreview bool `json:"agentMayPreview"`
	AgentMayGoLive  bool `json:"agentMayGoLive"`
}
