package faces

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"projmap/internal/application/app_errors"
)

func TestReadLocalStaysInHome(t *testing.T) {
	root := t.TempDir()
	home := filepath.Join(root, "home")
	outside := filepath.Join(root, "outside")
	for _, d := range []string{home, outside} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	homeDir = func() (string, error) { return home, nil }
	t.Cleanup(func() { homeDir = os.UserHomeDir })
	_ = os.WriteFile(filepath.Join(home, "logo.svg"), []byte("<svg/>"), 0o644)
	_ = os.WriteFile(filepath.Join(outside, "secret.png"), []byte("x"), 0o644)
	_ = os.Symlink(filepath.Join(outside, "secret.png"), filepath.Join(home, "link.png"))
	_ = os.WriteFile(filepath.Join(home, "big.png"), make([]byte, MaxUpload+1), 0o644)

	if b, err := readLocal("~/logo.svg"); err != nil || string(b) != "<svg/>" {
		t.Fatalf("home file %q %v", b, err)
	}
	for p, want := range map[string]string{
		filepath.Join(outside, "secret.png"):      "outside your home",
		filepath.Join(home, "link.png"):           "outside your home",
		filepath.Join(home, "..", "outside", "x"): "does not exist",
		"relative.png":                 "absolute",
		filepath.Join(home, "big.png"): "limit",
		home:                           "not a file",
	} {
		_, err := readLocal(p)
		if err == nil || !strings.Contains(app_errors.As(err).Message, want) {
			t.Errorf("%s: %v, want %q", p, err, want)
		}
	}
}

func TestStrokeValidation(t *testing.T) {
	w := 2.0
	st, err := strokesFrom([]StrokeIn{{Tool: "PEN", Points: [][]float64{{0.5, 0.5}}, Color: "f00", Width: &w}}, -1, 2, "uv")
	if err != nil || st[0].Tool != "pen" || len(st[0].Points) != 2 || st[0].Color != "#ff0000" {
		t.Fatalf("a one-point pen is a dot: %+v %v", st, err)
	}
	if _, err := strokesFrom(nil, -1, 2, "uv"); err == nil {
		t.Fatal("no strokes")
	}
	st, _ = strokesFrom([]StrokeIn{{Tool: "text", Points: [][]float64{{0.1, 0.1}}, Text: "hi"}, {Tool: "line", Points: [][]float64{{0, 0}, {1, 1}}, Fill: true}}, -1, 2, "uv")
	if st[0].Size != 48 || st[0].Width != 0 || st[1].Fill || st[1].Width != 4 {
		t.Fatalf("defaults %+v", st)
	}
}
