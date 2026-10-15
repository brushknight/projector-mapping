# Sound and video

projmap plays your own sound effects with the light and loops videos as backdrops. This guide covers the sound
library, the soundboard, sound on the timeline, where the sound comes out, and video loops from files or YouTube.

## Where the sound comes out

The projector computer plays every sound by default: the `/out` page uses the browser's Web Audio, so connect
speakers to that computer (or to the projector's audio input over HDMI).

Browsers keep a page silent until someone clicks it. `/out` shows **click to enable sound** until it can play; click
the projector output once and the note goes away. `projmap open --out` starts Chrome with
`--autoplay-policy=no-user-gesture-required`, so a kiosk window opened that way plays at once and never shows the
note.

You can send the sound somewhere else. In the editor's Show space (the wall group) or in the phone's sounds sheet,
pick the **audio output**:

| output | plays on |
| --- | --- |
| projector | the `/out` page on the projector computer (default) |
| laptop editor | the editor in your browser |
| phone | the iPhone app, through its speaker or whatever it is connected to |

Next to it are the **master volume** and **mute**. They apply at once, also to sounds that are already playing.

## The sound library

Add sounds in the editor: Show space → **sounds**, or the **sounds** tab of the library in the Map and Content
spaces. Pick or drop WAV, MP3, M4A, AIFF or OGG files (up to 64 MB each). The editor reads each file first, so the
library shows its length and a waveform. Click a sound to hear it on the audio output, rename it, or delete it.

The server keeps the files with your other assets. Deleting a sound leaves the pads, clips and cues that used it in
place; they say **missing sound** until you pick another one.

## The soundboard

Every scene has its own soundboard: a grid of pads in the Show space and in the phone's sounds sheet (the speaker
button at the top of every tab, and a card in the Objects tab).

- **Play:** click or tap a pad. In the editor, a pad with a key also plays when you press that key (while no text
  field has focus).
- **Loop:** a looping pad repeats until you press it again. It shows as playing on every screen.
- **Stop all** stops every pad and cue sound. It does not stop the timeline.
- **Edit:** add a pad, then give it a name, a sound, a volume, a colour, an icon and optionally a key. Pads are part of
  the scene, so a duplicated scene brings its pads along.

## Sound on the timeline

Add a **sound** track to the timeline and put sound clips on it, like effect clips on a face. A clip has its sound,
where in the file it starts (offset), a volume, and fade in and fade out. Trim and move clips by dragging; the clip
shows the sound's waveform.

When the timeline plays on the wall, the audio output schedules the clips on the same clock as the picture, so a
door slam lands on the frame where the light flashes. Pause and stop silence them.

While you build, press **Space** in the editor to preview: the editor plays the timeline's sound clips itself, without
touching the wall. The speaker button on the transport bar mutes the preview.

### Sound on a cue

A cue can play a sound when it starts: select the cue and pick **play sound on go**. Pressing GO on that cue (in the
editor, on the phone or over MCP), or playback running into an auto-follow cue, plays it on the audio output.

## Video loops

The scenery mode can loop a video instead of a photo. Pick it from the **videos** category next to the photo
categories, in the editor's Show space or the phone's Scenery tab. Blur, brightness, warmth and drift work like they
do for photos (brightness 100 % shows the original picture, new layers start at 90 %); a video also has a loop window
(from, to).

### A video's own sound

Turn on **sound** on the video layer and set its **volume**. The sound plays on the audio output only, at the layer's
volume times the master volume, and master mute silences it:

- **projector** (the default): the `/out` page plays it. If the browser has not had a click yet, `/out` shows "click
  to enable sound"; click it once. `projmap open --out` starts the browser so it needs no click.
- **editor**: the editor's wall preview in the Show space plays it.
- **phone**: nothing plays video sound in this version; pick the projector or the editor.

Previews, thumbnails and the editor's other views stay muted. The viewer (`/view`) plays it only when you turn on its
own sound toggle. This works for video files and for embedded YouTube players.

### Add a video file

**add video file** takes MP4, MOV or WebM (up to 512 MB). On the phone it picks a video from Photos.

### Add from YouTube

**add from YouTube** takes a youtube.com/watch, youtu.be or Shorts link, an optional trim (start and end seconds)
and a quality (up to 1080p by default).

- **With yt-dlp on the server's Mac** (`brew install yt-dlp`), the server downloads the video, trims it with ffmpeg
  and keeps it as a local file. It shows progress while it works. The loop then plays offline, sharp, and takes any
  amount of blur like a photo.
- **Without yt-dlp**, the loop plays as an embedded YouTube player behind the picture: looping, without controls,
  from the trim start, muted unless its **sound** is on and the page is the audio output. It needs the internet, stays at the bottom of its stack, and its blur and warmth are
  approximations. The import dialog says so and offers the install command.

Videos are yours to use: download only what you have the right to show.

## Over MCP

Agents see the library with `sound_list`, play a pad or a sound with `sound_play`, and put sound clips on the
timeline with `clip_add` (`sound`, `offset`, `volume`). `sound_play` only works while **agents may preview** is on in the editor's agent settings, so an agent never plays sound through your speakers without your say. See [agents-mcp.md](agents-mcp.md).

## Troubleshooting

- **No sound from the projector computer:** click the `/out` window once, check the audio output is **projector**,
  check master volume and mute, and check the computer's own output device.
- **"Nothing plays sound right now":** no screen is set up to play. Open `/out` on the projector computer and click
  it, or pick another audio output.
- **A video plays without sound:** turn on **sound** on the video layer, check the audio output and master mute, and
  click `/out` once if it shows "click to enable sound".
- **A YouTube loop stays black:** the embed needs the internet, and some videos do not allow embedding. Install
  yt-dlp and import it again to keep a local copy.
