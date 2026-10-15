package main

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"projmap/internal/apitest"
)

// TestBridgeSurvivesAServerRestart: Codex keeps one `projmap mcp` bridge for its whole session. When the server
// restarts, its MCP sessions are gone; the bridge reconnects, replays initialize and the next tools/call works.
func TestBridgeSurvivesAServerRestart(t *testing.T) {
	h := apitest.New(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	clientT, bridgeT := mcp.NewInMemoryTransports()
	local, err := bridgeT.Connect(ctx)
	if err != nil {
		t.Fatal(err)
	}
	b := newBridge(h.URL+"/mcp", http.DefaultClient, local)
	b.Retry = 5 * time.Second
	b.log = t.Logf
	done := make(chan error, 1)
	go func() { done <- b.run(ctx) }()

	cs, err := mcp.NewClient(&mcp.Implementation{Name: "codex", Version: "test"}, nil).Connect(ctx, clientT, nil)
	if err != nil {
		t.Fatal(err)
	}
	call := func(what string) {
		t.Helper()
		cctx, ccancel := context.WithTimeout(ctx, 8*time.Second)
		defer ccancel()
		res, err := cs.CallTool(cctx, &mcp.CallToolParams{Name: "camera_stream_status"})
		if err != nil {
			t.Fatalf("%s: %v", what, err)
		}
		if res.IsError || len(res.Content) == 0 {
			t.Fatalf("%s: %+v", what, res)
		}
		if tc, ok := res.Content[0].(*mcp.TextContent); !ok || !strings.Contains(tc.Text, "connected") {
			t.Fatalf("%s: content %+v", what, res.Content[0])
		}
	}
	call("first call")
	h.Restart(nil)
	call("after a server restart")
	h.Restart(nil)
	call("after a second restart")
	select {
	case err := <-done:
		t.Fatalf("the bridge exited: %v", err)
	default:
	}
}
