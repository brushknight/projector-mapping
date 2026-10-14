// Package videos holds the video library (the scenery "videos" tiles), YouTube imports and YouTube link parsing
// (protocol §14).
package videos

import (
	"fmt"
	"net/url"
	"regexp"
	"strings"
	"time"
)

// Sources of a video.
const (
	SourceFile    = "file"
	SourceYouTube = "youtube"
)

// Video is one tile of the scenery "videos" category.
type Video struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Ref       string    `json:"ref"`
	Source    string    `json:"source"`
	URL       string    `json:"url,omitempty"`
	YouTubeID string    `json:"youtubeId,omitempty"`
	SHA       string    `json:"sha,omitempty"`
	Thumb     *string   `json:"thumb"`
	Duration  float64   `json:"duration"`
	Width     int       `json:"width,omitempty"`
	Height    int       `json:"height,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}

// Import modes and statuses.
const (
	ModeDownload  = "download"
	ModeEmbed     = "embed"
	StatusRunning = "running"
	StatusDone    = "done"
	StatusFailed  = "failed"
)

// EmbedMessage is the message of an import done without yt-dlp.
const EmbedMessage = "yt-dlp is not installed, so this loop plays as an embedded YouTube player. Install it with brew install yt-dlp for offline, sharper loops you can fully blur."

// InvalidURLMessage answers a link that is not a YouTube video.
const InvalidURLMessage = "Paste a YouTube link: youtube.com/watch, youtu.be or a Shorts link."

// ImportJob is one YouTube import.
type ImportJob struct {
	ID        string    `json:"id"`
	URL       string    `json:"url"`
	YouTubeID string    `json:"youtubeId"`
	Mode      string    `json:"mode"`
	Status    string    `json:"status"`
	Progress  float64   `json:"progress"`
	Message   string    `json:"message"`
	MaxHeight int       `json:"maxHeight"`
	Start     float64   `json:"start"`
	End       float64   `json:"end"`
	VideoID   *string   `json:"videoId"`
	Ref       *string   `json:"ref"`
	CreatedAt time.Time `json:"createdAt"`
	// Name is the requested name (not on the wire).
	Name string `json:"-"`
}

// MaxHeights are the allowed maxHeight values; DefaultMaxHeight is used when none is given.
var MaxHeights = []int{360, 480, 720, 1080, 1440, 2160}

const DefaultMaxHeight = 1080

// ValidMaxHeight tells whether h is one of MaxHeights.
func ValidMaxHeight(h int) bool {
	for _, m := range MaxHeights {
		if m == h {
			return true
		}
	}
	return false
}

var idRe = regexp.MustCompile(`^[A-Za-z0-9_-]{11}$`)

// YouTubeID returns the video id of a YouTube watch, youtu.be or Shorts link (http or https, www. or m.; extra query
// parameters are ignored), or "" when raw is not one.
func YouTubeID(raw string) string {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
		return ""
	}
	host := strings.ToLower(u.Hostname())
	ok := func(id string) string {
		if idRe.MatchString(id) {
			return id
		}
		return ""
	}
	switch host {
	case "youtu.be":
		parts := strings.Split(strings.TrimPrefix(u.Path, "/"), "/")
		return ok(parts[0])
	case "youtube.com", "www.youtube.com", "m.youtube.com":
		if u.Path == "/watch" {
			return ok(u.Query().Get("v"))
		}
		if rest, found := strings.CutPrefix(u.Path, "/shorts/"); found {
			return ok(strings.Split(rest, "/")[0])
		}
	}
	return ""
}

// CheckTrim validates an import's start and end (end 0 = to the end).
func CheckTrim(start, end float64) error {
	if start < 0 || end < 0 {
		return fmt.Errorf("start and end must be 0 or more seconds")
	}
	if end > 0 && end <= start {
		return fmt.Errorf("end must be after start")
	}
	return nil
}

// Ref helpers.
func AssetRef(sha string) string  { return "asset:" + sha }
func YouTubeRef(id string) string { return "youtube:" + id }
