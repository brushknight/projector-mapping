// Package sounds holds the sound tools: the library and playing a pad or a sound on the audio output.
package sounds

import (
	"context"
	"fmt"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"projmap/internal/application/app_errors"
	showsvc "projmap/internal/application/services/show"
	"projmap/internal/domain/assets"
	"projmap/internal/infrastructure/mcp/tools"
)

// Register adds sound_list and sound_play.
func Register(s *mcp.Server, env *tools.Env) {
	tools.Add(s, env, &mcp.Tool{Name: "sound_list", Title: "List the sounds",
		Description: "The sound library (sound effects the user uploaded): sha, name and duration in seconds, plus the active scene's soundboard pads. " +
			"Use a sha or name in clip_add {sound} to put a sound on the timeline (a sound track), or in sound_play to hear it."}, soundList)
	tools.Add(s, env, &mcp.Tool{Name: "sound_play", Title: "Play a sound",
		Description: "Plays a soundboard pad (id or name, in the active scene) or a library sound (sha or name) on the audio output (the projector's /out by default). " +
			"Needs \"agent may preview\". Fails when no audio output is connected."}, soundPlay)
}

// FindSound returns the library sound with that sha (or sha prefix of 6+) or name (case-insensitive).
func FindSound(ctx context.Context, e *tools.Env, ref string) (*assets.Asset, error) {
	if e.D.Sounds == nil {
		return nil, app_errors.Unavailable("The sound library is not available.")
	}
	l, err := e.D.Sounds.List(ctx)
	if err != nil {
		return nil, err
	}
	ref = strings.TrimSpace(ref)
	for i := range l {
		if l[i].SHA == ref || (len(ref) >= 6 && strings.HasPrefix(l[i].SHA, ref)) {
			return &l[i], nil
		}
	}
	for i := range l {
		if strings.EqualFold(l[i].Name, ref) {
			return &l[i], nil
		}
	}
	return nil, app_errors.NotFound("Sound %q is not in the library. sound_list shows the sounds; the user uploads new ones in the editor's sound library.", ref)
}

type soundLine struct {
	SHA      string  `json:"sha"`
	Name     string  `json:"name"`
	Duration float64 `json:"duration"`
}

type padLine struct {
	ID    string  `json:"id"`
	Name  string  `json:"name"`
	Sound string  `json:"sound"`
	Loop  bool    `json:"loop"`
	Vol   float64 `json:"volume"`
}

func soundList(ctx context.Context, e *tools.Env, _ struct{}) (*mcp.CallToolResult, error) {
	if e.D.Sounds == nil {
		return nil, app_errors.Unavailable("The sound library is not available.")
	}
	l, err := e.D.Sounds.List(ctx)
	if err != nil {
		return nil, err
	}
	out := struct {
		Sounds []soundLine `json:"sounds"`
		Pads   []padLine   `json:"pads"`
	}{Sounds: []soundLine{}, Pads: []padLine{}}
	for _, a := range l {
		d := 0.0
		if a.Duration != nil {
			d = *a.Duration
		}
		out.Sounds = append(out.Sounds, soundLine{SHA: a.SHA, Name: a.Name, Duration: d})
	}
	if sc, _, err := e.View(ctx); err == nil {
		for _, p := range sc.Sounds.Pads {
			out.Pads = append(out.Pads, padLine{ID: p.ID, Name: p.Name, Sound: p.Sound, Loop: p.Loop, Vol: p.Volume})
		}
	}
	return tools.JSON(fmt.Sprintf("%d sounds in the library, %d pads on the scene's soundboard.", len(out.Sounds), len(out.Pads)), out), nil
}

type playIn struct {
	Pad    string   `json:"pad,omitempty" jsonschema:"a soundboard pad id or name in the active scene"`
	Sound  string   `json:"sound,omitempty" jsonschema:"a library sound sha"`
	Name   string   `json:"name,omitempty" jsonschema:"a pad name or a sound name"`
	Volume *float64 `json:"volume,omitempty" jsonschema:"0..1, default 1"`
}

func soundPlay(ctx context.Context, e *tools.Env, in playIn) (*mcp.CallToolResult, error) {
	if err := e.NeedPreview(ctx); err != nil {
		return nil, err
	}
	args := showsvc.PlayIn{Volume: in.Volume}
	padRef := in.Pad
	if padRef == "" && in.Sound == "" {
		padRef = in.Name
	}
	if padRef != "" {
		id := e.D.Show.Get(ctx).ActiveSceneID
		if id == "" {
			return nil, app_errors.NoScene("No scene is active.")
		}
		sc, err := e.D.Scenes.Scene(ctx, id)
		if err != nil {
			return nil, err
		}
		for _, p := range sc.Sounds.Pads {
			if p.ID == padRef || strings.EqualFold(p.Name, padRef) {
				args.PadID = p.ID
				break
			}
		}
		if args.PadID == "" && in.Pad != "" {
			return nil, app_errors.NotFound("Pad %q is not on the active scene's soundboard. sound_list shows the pads.", in.Pad)
		}
	}
	if args.PadID == "" {
		ref := in.Sound
		if ref == "" {
			ref = in.Name
		}
		if ref == "" {
			return nil, app_errors.BadRequest("Give pad, sound or name.")
		}
		a, err := FindSound(ctx, e, ref)
		if err != nil {
			return nil, err
		}
		args.SoundID = a.SHA
	}
	ack, err := e.D.Show.PlaySound(ctx, args)
	if err != nil {
		return nil, err
	}
	if ack.Stopped {
		return tools.Text("That looping pad was playing, so it stopped."), nil
	}
	return tools.Text("Playing (%s) on %d audio output(s).", ack.PlayID, ack.Outputs), nil
}
