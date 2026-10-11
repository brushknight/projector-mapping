package main

import "testing"

func TestServerPortFollowsProjmapURL(t *testing.T) {
	t.Setenv("PROJMAP_PORT", "")
	t.Setenv("PROJMAP_URL", "http://127.0.0.1:7499/")
	if p := serverPort(); p != 7499 {
		t.Fatalf("port from PROJMAP_URL: got %d, want 7499", p)
	}
	t.Setenv("PROJMAP_URL", "http://studio.local")
	if p := serverPort(); p != 7400 {
		t.Fatalf("no port in PROJMAP_URL: got %d, want the default 7400", p)
	}
	t.Setenv("PROJMAP_URL", "")
	t.Setenv("PROJMAP_PORT", "7600")
	if p := serverPort(); p != 7600 {
		t.Fatalf("PROJMAP_PORT: got %d, want 7600", p)
	}
}
