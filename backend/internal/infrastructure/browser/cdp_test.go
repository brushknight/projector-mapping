package browser

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/coder/websocket"
)

// A fake DevTools endpoint: /json/list names the output page; its socket answers Runtime.evaluate.
func TestPageFullscreenAsksThePageAsAUserGesture(t *testing.T) {
	var got map[string]any
	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/json/list" {
			ws := "ws" + strings.TrimPrefix(srv.URL, "http") + "/devtools/page/A"
			_ = json.NewEncoder(w).Encode([]map[string]string{
				{"type": "service_worker", "url": "http://127.0.0.1:7400/out", "webSocketDebuggerUrl": ws + "x"},
				{"type": "page", "url": "http://127.0.0.1:7400/out?x=1", "webSocketDebuggerUrl": ws},
			})
			return
		}
		c, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer c.CloseNow()
		_, b, err := c.Read(r.Context())
		if err != nil {
			return
		}
		_ = json.Unmarshal(b, &got)
		_ = c.Write(r.Context(), websocket.MessageText, []byte(`{"id":1,"result":{"result":{"type":"boolean","value":true}}}`))
	}))
	defer srv.Close()
	u, _ := url.Parse(srv.URL)
	profile := t.TempDir()
	if err := os.WriteFile(filepath.Join(profile, "DevToolsActivePort"), []byte(u.Port()+"\n/devtools/browser/x\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := PageFullscreen(context.Background(), profile, "http://127.0.0.1:7400/out"); err != nil {
		t.Fatal(err)
	}
	p, _ := got["params"].(map[string]any)
	if got["method"] != "Runtime.evaluate" || p["userGesture"] != true || !strings.Contains(p["expression"].(string), "requestFullscreen") {
		t.Fatalf("sent %v", got)
	}
}
