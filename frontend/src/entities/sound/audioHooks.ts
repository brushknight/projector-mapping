/**
 * React bindings of the audio engine (protocol §14):
 *
 *   useAudioClient(hub, { role, enabled })  the audio output client: plays `sound.play` / `sound.stop` and the active
 *                                           scene's timeline sound on the server clock while show.audio.output names
 *                                           this client (projector → role output, editor → editor, phone → remote)
 *   usePreviewAudio(scene, preview, opts)   the editor preview (Space) plays the timeline's sound clips locally
 *   useAudioUnlocked()                      true while the page's AudioContext runs
 *   useSoundList(hub)                       the `sounds` channel (the library)
 */
import { useEffect, useMemo, useState } from 'react'
import { useChannel } from '../../shared/lib/useHub'
import type { Hub } from '../../shared/lib/ws'
import type { PreviewClock } from '../scene/editor/preview'
import type { Scene } from '../scene/types'
import { playhead, showAudio, type AudioOutput, type Show } from '../show/types'
import { AudioEngine, audioContext, audioUnlocked, ctxTimeAt, LEAD, onAudioState, soundLength, unlockAudio, unlockOnGesture, type Planner } from './audio'
import { holdPoint, planClips } from './audioSchedule'
import type { Sound, SoundPlayMsg, SoundStopMsg } from './types'

/** Which `show.audio.output` a hub role plays for. */
export const OUTPUT_OF_ROLE: Record<'output' | 'editor' | 'remote', AudioOutput> = { output: 'projector', editor: 'editor', remote: 'phone' }

/** True while the page's AudioContext runs (creates the context on first use). */
export function useAudioUnlocked(): boolean {
  const [on, setOn] = useState(() => audioUnlocked())
  useEffect(() => {
    setOn(audioUnlocked())
    return onAudioState(setOn)
  }, [])
  return on
}

/** The sound library from the `sounds` channel (newest first), or [] until it arrives. */
export function useSoundList(hub: Hub): Sound[] {
  return useChannel<Sound[]>(hub, 'sounds').doc ?? []
}

export interface AudioClient {
  /** show.audio.output names this client */
  active: boolean
  /** the browser lets the page play sound */
  unlocked: boolean
  /** resumes the AudioContext (call from a click) */
  unlock: () => Promise<boolean>
  /** volume × master for this client's own media (video layer sound), 0 while muted, inactive or locked */
  masterGain: number
}

/**
 * The audio output client. Mount it once per page that says cap `audio` in hello (/out, the editor). It follows
 * `show` and the active scene itself, so pages need not pass them.
 */
export function useAudioClient(hub: Hub, opts: { role: 'output' | 'editor' | 'remote'; enabled?: boolean }): AudioClient {
  const enabled = opts.enabled ?? true
  const show = useChannel<Show>(hub, 'show').doc
  const sceneId = show?.activeSceneId ?? null
  const scene = useChannel<Scene>(hub, enabled && sceneId ? `scene:${sceneId}` : null).doc
  const audio = showAudio(show)
  const active = enabled && audio.output === OUTPUT_OF_ROLE[opts.role]
  const engine = useMemo(() => new AudioEngine(), [])
  const unlocked = useAudioUnlocked()
  const [clockTick, setClockTick] = useState(0)

  useEffect(() => {
    engine.revive()
    return () => engine.dispose()
  }, [engine])
  useEffect(() => engine.setMaster(audio.volume, audio.muted), [engine, audio.volume, audio.muted])
  // the first click or key press on the page lets it play sound
  useEffect(() => (enabled ? unlockOnGesture() : undefined), [enabled])
  useEffect(() => hub.on('clock', () => setClockTick((n) => n + 1)), [hub])

  // direct messages (no channel): pads, cue sounds, library sounds
  useEffect(() => {
    if (!enabled) return
    const offs = [
      hub.onMessage<SoundPlayMsg>('sound.play', (d) => {
        // a locked context would play it late, at the first click; drop it instead
        if (d && audioUnlocked()) void engine.playOneShot(d)
      }),
      hub.onMessage<SoundStopMsg>('sound.stop', (d) => engine.stop(d ?? {})),
    ]
    return () => offs.forEach((f) => f())
  }, [hub, engine, enabled])

  // another client took the output: stop what this one plays
  useEffect(() => {
    if (!active) engine.stop()
  }, [active, engine])

  // the timeline on the server clock: re-planned on every show or scene change
  useEffect(() => {
    const t = show?.transport
    if (!active || !unlocked || !show || !t || !scene || scene.id !== show.activeSceneId || t.state !== 'playing' || show.preview?.draftId) {
      engine.stopTimeline()
      return
    }
    const ctx = audioContext()
    if (!ctx) return
    const planner: Planner = () => {
      const perf = performance.now()
      const base = ctxTimeAt(ctx, perf)
      const ph = playhead(t, hub.serverNow())
      return planClips(scene, ph + LEAD, { until: holdPoint(scene, ph), fileDuration: soundLength }).map((p) => ({ ...p, when: base + LEAD + p.delay }))
    }
    engine.syncTimeline(planner)
  }, [active, unlocked, show, scene, engine, hub, clockTick])

  // from show.audio itself (not the engine, which takes the new master in an effect after this render)
  return { active, unlocked, unlock: unlockAudio, masterGain: active && unlocked && !audio.muted ? Math.max(0, Math.min(1, audio.volume)) : 0 }
}

/**
 * The editor preview's sound (§14): while the preview clock plays, the scene's sound clips play locally from its
 * playhead (whatever show.audio.output says). It re-plans on play, pause, seek, loop wraps and scene edits.
 */
export function usePreviewAudio(scene: Scene | null, preview: PreviewClock, opts: { muted: boolean; mutedTracks?: ReadonlySet<string> }) {
  const engine = useMemo(() => new AudioEngine(), [])
  const unlocked = useAudioUnlocked()
  const [jump, setJump] = useState(0)
  useEffect(() => {
    engine.revive()
    return () => engine.dispose()
  }, [engine])
  useEffect(() => engine.setMaster(1, opts.muted), [engine, opts.muted])

  // a seek or a loop wrap moves the playhead off its expected path: plan again
  useEffect(() => {
    if (!preview.playing) return
    let lastT = preview.t()
    let lastMs = performance.now()
    const id = setInterval(() => {
      const t = preview.t()
      const ms = performance.now()
      if (Math.abs(t - (lastT + (ms - lastMs) / 1000)) > 0.06) setJump((n) => n + 1)
      lastT = t
      lastMs = ms
    }, 120)
    return () => clearInterval(id)
  }, [preview, preview.playing])

  useEffect(() => {
    if (!preview.playing || !scene) {
      engine.stopTimeline()
      return
    }
    // Space is a key press: the context may resume on it
    if (!unlocked) void unlockAudio()
    const ctx = audioContext()
    if (!ctx) return
    const muted = opts.mutedTracks
    const planner: Planner = () => {
      const base = ctxTimeAt(ctx, performance.now())
      const t = preview.t()
      return planClips(scene, t + LEAD, { fileDuration: soundLength, mutedTracks: muted }).map((p) => ({ ...p, when: base + LEAD + p.delay }))
    }
    engine.syncTimeline(planner)
  }, [preview, preview.playing, scene, engine, unlocked, jump, opts.mutedTracks])
}

/**
 * (§15) The viewer's own sound: while `on`, the wall's timeline sound clips play locally on the server clock (the
 * viewer is never an audio client, so pads and cue sounds stay on the audio output).
 */
export function useLocalWallAudio(hub: Hub, show: Show | null, scene: Scene | null, on: boolean) {
  const engine = useMemo(() => new AudioEngine(), [])
  const unlocked = useAudioUnlocked()
  const [clockTick, setClockTick] = useState(0)
  const audio = showAudio(show)
  useEffect(() => {
    engine.revive()
    return () => engine.dispose()
  }, [engine])
  useEffect(() => engine.setMaster(audio.volume, audio.muted || !on), [engine, audio.volume, audio.muted, on])
  useEffect(() => hub.on('clock', () => setClockTick((n) => n + 1)), [hub])
  useEffect(() => {
    const t = show?.transport
    if (!on || !unlocked || !show || !t || !scene || t.state !== 'playing') {
      engine.stopTimeline()
      return
    }
    const ctx = audioContext()
    if (!ctx) return
    const planner: Planner = () => {
      const base = ctxTimeAt(ctx, performance.now())
      const ph = playhead(t, hub.serverNow())
      return planClips(scene, ph + LEAD, { until: holdPoint(scene, ph), fileDuration: soundLength }).map((p) => ({ ...p, when: base + LEAD + p.delay }))
    }
    engine.syncTimeline(planner)
  }, [on, unlocked, show, scene, engine, hub, clockTick])
}
