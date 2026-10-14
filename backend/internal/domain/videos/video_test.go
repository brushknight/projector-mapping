package videos

import "testing"

func TestYouTubeID(t *testing.T) {
	good := map[string]string{
		"https://www.youtube.com/watch?v=aqz-KE-bpKQ":            "aqz-KE-bpKQ",
		"https://youtube.com/watch?v=aqz-KE-bpKQ&t=12s":          "aqz-KE-bpKQ",
		"http://m.youtube.com/watch?feature=share&v=aqz-KE-bpKQ": "aqz-KE-bpKQ",
		"https://youtu.be/aqz-KE-bpKQ":                           "aqz-KE-bpKQ",
		"https://youtu.be/aqz-KE-bpKQ?si=abc":                    "aqz-KE-bpKQ",
		"https://www.youtube.com/shorts/aqz-KE-bpKQ":             "aqz-KE-bpKQ",
		"https://youtube.com/shorts/aqz-KE-bpKQ?feature=share":   "aqz-KE-bpKQ",
		"  https://www.youtube.com/watch?v=aqz-KE-bpKQ  ":        "aqz-KE-bpKQ",
		"HTTPS://WWW.YOUTUBE.COM/watch?v=aqz-KE-bpKQ":            "aqz-KE-bpKQ",
	}
	for u, want := range good {
		if got := YouTubeID(u); got != want {
			t.Errorf("%q → %q, want %q", u, got, want)
		}
	}
	bad := []string{"", "aqz-KE-bpKQ", "ftp://youtu.be/aqz-KE-bpKQ", "https://vimeo.com/123", "https://youtube.com/watch?v=short",
		"https://youtube.com/watch", "https://youtube.com/embed/aqz-KE-bpKQ", "https://evil.com/watch?v=aqz-KE-bpKQ",
		"https://youtu.be/", "https://www.youtube.com/shorts/", "https://youtube.com.evil.com/watch?v=aqz-KE-bpKQ",
		"https://youtube.com/watch?v=aqz-KE-bpK!"}
	for _, u := range bad {
		if got := YouTubeID(u); got != "" {
			t.Errorf("%q → %q, want none", u, got)
		}
	}
}

func TestCheckTrim(t *testing.T) {
	if CheckTrim(0, 0) != nil || CheckTrim(12, 32) != nil || CheckTrim(5, 0) != nil {
		t.Fatal("valid trims refused")
	}
	if CheckTrim(-1, 0) == nil || CheckTrim(10, 5) == nil || CheckTrim(10, 10) == nil {
		t.Fatal("invalid trims accepted")
	}
}
