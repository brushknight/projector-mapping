// Package agents holds the agent runner port: starting codex exec or claude -p with this server attached over MCP.
package agents

import (
	"context"

	"projmap/internal/domain/agents"
)

// Spec is one run.
type Spec struct {
	Agent   string
	Prompt  string
	MCPURL  string
	Token   string
	WorkDir string
	// Self is this binary, for codex's stdio bridge (projmap mcp).
	Self string
}

// Runner starts agent CLIs.
type Runner interface {
	// Available tells whether the agent's CLI is installed ("" when it is, else why not).
	Available(agent string) string
	// Run starts the agent and sends its events until it exits; the returned error is the exit result.
	Run(ctx context.Context, spec Spec, emit func(agents.Event)) error
}
