package videos

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"projmap/internal/apitest"
)

type video struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	Ref       string  `json:"ref"`
	Source    string  `json:"source"`
	URL       string  `json:"url"`
	YouTubeID string  `json:"youtubeId"`
	SHA       string  `json:"sha"`
	Thumb     *string `json:"thumb"`
	Duration  float64 `json:"duration"`
	Width     int     `json:"width"`
	CreatedAt string  `json:"createdAt"`
}

type job struct {
	ID        string  `json:"id"`
	URL       string  `json:"url"`
	YouTubeID string  `json:"youtubeId"`
	Mode      string  `json:"mode"`
	Status    string  `json:"status"`
	Progress  float64 `json:"progress"`
	Message   string  `json:"message"`
	MaxHeight int     `json:"maxHeight"`
	Start     float64 `json:"start"`
	End       float64 `json:"end"`
	VideoID   *string `json:"videoId"`
	Ref       *string `json:"ref"`
}

const embedMessage = "yt-dlp is not installed, so this loop plays as an embedded YouTube player. Install it with brew install yt-dlp for offline, sharper loops you can fully blur."

func start(t *testing.T, h *apitest.H, body map[string]any) job {
	t.Helper()
	r := h.Do("POST", "/api/v1/videos/import", body)
	apitest.Expect(t, r, http.StatusAccepted)
	var j job
	r.Into(t, &j)
	return j
}

func TestImportWithoutYTDLP(t *testing.T) {
	apitest.ToolsPath(t, nil)
	h := apitest.New(t)
	ws := h.Connect("remote", "phone")
	ws.Sub("videos")
	if r := h.Do("GET", "/api/v1/videos/tools", nil).Map(t); r["ytdlp"] != false || r["ffmpeg"] != false {
		t.Fatalf("tools %v", r)
	}
	for _, u := range []string{"", "not a link", "https://vimeo.com/123", "https://youtube.com/watch?v=short", "ftp://youtu.be/aqz-KE-bpKQ",
		"https://www.youtube.com/embed/aqz-KE-bpKQ"} {
		m := apitest.ExpectErr(t, h.Do("POST", "/api/v1/videos/import", map[string]any{"url": u}), http.StatusBadRequest, "invalid_url")
		if m["message"] != "Paste a YouTube link: youtube.com/watch, youtu.be or a Shorts link." {
			t.Fatalf("message %v", m["message"])
		}
	}
	apitest.ExpectErr(t, h.Do("POST", "/api/v1/videos/import", map[string]any{"url": "https://youtu.be/aqz-KE-bpKQ", "maxHeight": 999}), http.StatusBadRequest, "bad_request")
	apitest.ExpectErr(t, h.Do("POST", "/api/v1/videos/import", map[string]any{"url": "https://youtu.be/aqz-KE-bpKQ", "start": 10, "end": 5}), http.StatusBadRequest, "bad_request")

	j := start(t, h, map[string]any{"url": "https://m.youtube.com/watch?v=aqz-KE-bpKQ&t=3", "start": 12, "end": 32})
	if j.Mode != "embed" || j.Status != "done" || j.Progress != 1 || j.Message != embedMessage || j.YouTubeID != "aqz-KE-bpKQ" ||
		j.MaxHeight != 1080 || j.Start != 12 || j.End != 32 || j.Ref == nil || *j.Ref != "youtube:aqz-KE-bpKQ" || j.VideoID == nil {
		t.Fatalf("embed job %+v", j)
	}
	var l []video
	ws.NextOn("snapshot", "videos").Into(t, &l)
	if len(l) != 1 || l[0].Ref != "youtube:aqz-KE-bpKQ" || l[0].Source != "youtube" || l[0].SHA != "" || l[0].Thumb != nil || l[0].ID != *j.VideoID ||
		l[0].Duration != 20 || l[0].Name != "youtube aqz-KE-bpKQ" {
		t.Fatalf("videos %+v", l)
	}
	var again job
	h.Do("GET", "/api/v1/videos/import/"+j.ID, nil).Into(t, &again)
	if again.Status != "done" || again.ID != j.ID {
		t.Fatalf("job %+v", again)
	}
	snap := ws.Sub("import:" + j.ID)
	if !strings.Contains(string(snap.D), `"status":"done"`) {
		t.Fatalf("import snapshot %s", snap.D)
	}
	apitest.ExpectErr(t, h.Do("GET", "/api/v1/videos/import/imp_nope", nil), http.StatusNotFound, "not_found")
	if l := h.Do("GET", "/api/v1/videos/import", nil).List(t); len(l) != 1 {
		t.Fatalf("recent jobs %v", l)
	}
	// a name sticks; rename and delete
	j2 := start(t, h, map[string]any{"url": "https://youtube.com/shorts/aqz-KE-bpKQ", "name": "waves"})
	r := h.Do("PATCH", "/api/v1/videos/"+*j2.VideoID, map[string]any{"name": "big waves"})
	apitest.Expect(t, r, http.StatusOK)
	if r.Map(t)["name"] != "big waves" {
		t.Fatalf("rename %s", r.Body)
	}
	apitest.Expect(t, h.Do("DELETE", "/api/v1/videos/"+*j2.VideoID, nil), http.StatusNoContent)
	apitest.ExpectErr(t, h.Do("DELETE", "/api/v1/videos/"+*j2.VideoID, nil), http.StatusNotFound, "not_found")
	if l := h.Do("GET", "/api/v1/videos", nil).List(t); len(l) != 1 {
		t.Fatalf("videos after delete %v", l)
	}
	// videos survive a restart
	h.Restart(nil)
	if l := h.Do("GET", "/api/v1/videos", nil).List(t); len(l) != 1 {
		t.Fatalf("videos after restart %v", l)
	}
}

// fakeYTDLP prints progress the way yt-dlp --newline does and writes a small file at the -o path.
const fakeYTDLP = `#!/bin/sh
out=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2;;
    *) shift;;
  esac
done
echo "[youtube] aqz-KE-bpKQ: Downloading webpage"
for p in 10.0 42.5 77.0 100.0; do
  echo "[download]  $p% of    1.00MiB at    2.00MiB/s ETA 00:00"
  sleep 0.15
done
f=$(echo "$out" | sed 's/%(ext)s/mp4/')
printf 'XXXXftypisom' > "$f"
head -c 2048 /dev/zero >> "$f"
echo '{"title":"Big Buck Bunny"}' > "$(echo "$out" | sed 's/%(ext)s/info.json/')"
`

const failingYTDLP = `#!/bin/sh
echo "[youtube] aqz-KE-bpKQ: Downloading webpage"
echo "ERROR: [youtube] aqz-KE-bpKQ: Video unavailable" >&2
exit 1
`

func wait(t *testing.T, h *apitest.H, id string) job {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		var j job
		h.Do("GET", "/api/v1/videos/import/"+id, nil).Into(t, &j)
		if j.Status != "running" {
			return j
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("import %s did not finish", id)
	return job{}
}

func TestImportWithYTDLP(t *testing.T) {
	apitest.ToolsPath(t, map[string]string{"yt-dlp": fakeYTDLP})
	h := apitest.New(t)
	if r := h.Do("GET", "/api/v1/videos/tools", nil).Map(t); r["ytdlp"] != true || r["ffmpeg"] != false {
		t.Fatalf("tools %v", r)
	}
	ws := h.Connect("editor", "editor")
	j := start(t, h, map[string]any{"url": "https://www.youtube.com/watch?v=aqz-KE-bpKQ", "maxHeight": 720})
	if j.Mode != "download" || j.Status != "running" || j.MaxHeight != 720 || j.VideoID != nil || j.Ref != nil {
		t.Fatalf("download job %+v", j)
	}
	ws.Sub("import:" + j.ID)
	sawProgress := false
	var last job
	for last.Status != "done" && last.Status != "failed" {
		m := ws.NextOn("snapshot", "import:"+j.ID)
		m.Into(t, &last)
		if last.Status == "running" && strings.HasPrefix(last.Message, "downloading ") && last.Progress > 0 && last.Progress <= 0.8 {
			sawProgress = true
		}
	}
	if !sawProgress {
		t.Error("no downloading progress on the import channel")
	}
	if last.Status != "done" || last.Progress != 1 || last.Ref == nil || !strings.HasPrefix(*last.Ref, "asset:") || last.VideoID == nil {
		t.Fatalf("finished job %+v", last)
	}
	var vs []video
	h.Do("GET", "/api/v1/videos", nil).Into(t, &vs)
	v := vs[0]
	if len(vs) != 1 || v.ID != *last.VideoID || v.Ref != *last.Ref || v.Source != "youtube" || v.YouTubeID != "aqz-KE-bpKQ" ||
		v.Name != "Big Buck Bunny" || v.SHA == "" || v.Thumb != nil || v.URL != "https://www.youtube.com/watch?v=aqz-KE-bpKQ" {
		t.Fatalf("video %+v", v)
	}
	a := h.Do("GET", "/api/v1/assets/"+v.SHA, nil).Map(t)
	if a["kind"] != "video" || a["mime"] != "video/mp4" {
		t.Fatalf("asset %v", a)
	}
	apitest.Expect(t, h.Do("GET", "/a/"+v.SHA, nil), http.StatusOK)
	// a trim needs ffmpeg: without it the import fails and says why
	j = start(t, h, map[string]any{"url": "https://youtu.be/aqz-KE-bpKQ", "start": 2, "end": 6})
	if f := wait(t, h, j.ID); f.Status != "failed" || !strings.Contains(f.Message, "ffmpeg is not installed") {
		t.Fatalf("trim without ffmpeg %+v", f)
	}
	// deleting the video removes its file
	apitest.Expect(t, h.Do("DELETE", "/api/v1/videos/"+v.ID, nil), http.StatusNoContent)
	apitest.Expect(t, h.Do("GET", "/a/"+v.SHA, nil), http.StatusNotFound)
}

func TestImportFails(t *testing.T) {
	apitest.ToolsPath(t, map[string]string{"yt-dlp": failingYTDLP})
	h := apitest.New(t)
	j := start(t, h, map[string]any{"url": "https://youtu.be/aqz-KE-bpKQ"})
	f := wait(t, h, j.ID)
	if f.Status != "failed" || !strings.Contains(f.Message, "Video unavailable") || f.VideoID != nil {
		t.Fatalf("failed job %+v", f)
	}
	if l := h.Do("GET", "/api/v1/videos", nil).List(t); len(l) != 0 {
		t.Fatalf("videos %v", l)
	}
}

func TestVideoUpload(t *testing.T) {
	apitest.ToolsPath(t, nil)
	h := apitest.New(t)
	mp4 := append([]byte("\x00\x00\x00\x20ftypisom\x00\x00\x02\x00isomiso2mp41"), make([]byte, 4096)...)
	r := h.Do("POST", "/api/v1/videos", apitest.File("Ocean Loop.mp4", mp4, map[string]string{}))
	apitest.Expect(t, r, http.StatusCreated)
	var v video
	r.Into(t, &v)
	if v.Source != "file" || v.Name != "Ocean Loop" || !strings.HasPrefix(v.Ref, "asset:") || v.SHA == "" || v.Ref != "asset:"+v.SHA || v.Thumb != nil || v.URL != "" {
		t.Fatalf("upload %+v", v)
	}
	if a := h.Do("GET", "/api/v1/assets/"+v.SHA, nil).Map(t); a["kind"] != "video" || a["bytes"] != float64(len(mp4)) {
		t.Fatalf("asset %v", a)
	}
	r = h.Do("POST", "/api/v1/videos", apitest.File("w.webm", append([]byte{0x1A, 0x45, 0xDF, 0xA3}, make([]byte, 64)...), map[string]string{"name": "wind"}))
	apitest.Expect(t, r, http.StatusCreated)
	if r.Map(t)["name"] != "wind" {
		t.Fatalf("named upload %s", r.Body)
	}
	apitest.ExpectErr(t, h.Do("POST", "/api/v1/videos", apitest.File("notes.txt", []byte("not a video at all"), nil)), http.StatusBadRequest, "unsupported")
	apitest.ExpectErr(t, h.Do("POST", "/api/v1/videos", map[string]any{"file": "x"}), http.StatusBadRequest, "bad_request")
	if l := h.Do("GET", "/api/v1/videos", nil).List(t); len(l) != 2 || l[0].(map[string]any)["name"] != "wind" {
		t.Fatalf("newest first %v", l)
	}
	apitest.ExpectErr(t, h.Do("PATCH", "/api/v1/videos/"+v.ID, map[string]any{"name": " "}), http.StatusBadRequest, "bad_request")
	apitest.Expect(t, h.Do("DELETE", "/api/v1/videos/"+v.ID, nil), http.StatusNoContent)
	apitest.Expect(t, h.Do("GET", "/a/"+v.SHA, nil), http.StatusNotFound)
}
