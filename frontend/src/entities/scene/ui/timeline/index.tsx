import { Fragment, useLayoutEffect, useRef, useState, type DragEvent, type PointerEvent } from 'react'
import { Icon, Menu, Pill, Waveform } from '../../../../shared/components'
import { pressed } from '../../../../shared/lib/pointer'
import { cx } from '../../../../shared/lib/cx'
import { newId } from '../../../../shared/lib/ids'
import { useRaf } from '../../../../shared/lib/useRaf'
import { clipHoldMode, LAYER_CLIP_DEFAULTS, stepBounds, stepEnd } from '../../../../render/timeline'
import { useEditor } from '../../editor/context'
import { addClip, addCue, addSoundClip, addTrack, convergeSource, cuePath, removeCue, removeTrack, round3, setClipTimes, soundClip, sortedCues } from '../../ops'
import type { Clip, ContentLayer, Scene, Track } from '../../types'
import { soundClipParams } from '../../../sound/audioSchedule'
import { usePreviewAudio, useSoundList } from '../../../sound/audioHooks'
import type { Sound } from '../../../sound/types'
import { formatTime } from './time'
import s from './styles.module.css'

export { formatTime }

const EDGE_PX = 7
const SNAP_PX = 6

/** Every content layer of the scene with a readable owner name (layer tracks target them). */
function contentLayers(scene: Scene): Array<{ layer: ContentLayer; owner: string }> {
  return scene.objects.flatMap((o) => [
    ...(o.layers ?? []).map((layer) => ({ layer, owner: o.name })),
    ...o.surfaces.flatMap((x) => (x.layers ?? []).map((layer) => ({ layer, owner: `${o.name} · ${x.name}` }))),
  ])
}

/** Remembers the preview sound mute on this browser (storage may be blocked: then it is not remembered). */
const MUTE_KEY = 'projmap.previewSoundMuted'
function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1'
  } catch {
    return false
  }
}
function writeMuted(v: boolean) {
  try {
    localStorage.setItem(MUTE_KEY, v ? '1' : '0')
  } catch {
    /* not remembered */
  }
}

/** The drag payload a sound from the library carries (text/plain), so it can be dropped on a sound track. */
export const SOUND_DRAG_PREFIX = 'sound:'

/** The part of a sound's peaks a clip plays: from `offset` for the clip's length. */
function clipPeaks(snd: Sound | undefined, clip: Clip): number[] {
  if (!snd?.peaks?.length || !(snd.duration > 0)) return []
  const p = soundClipParams(clip)
  const n = snd.peaks.length
  const a = Math.max(0, Math.floor((p.offset / snd.duration) * n))
  const b = Math.min(n, Math.ceil(((p.offset + clip.end - clip.start) / snd.duration) * n))
  return b > a ? snd.peaks.slice(a, b) : []
}

type ClipDrag = { id: string; mode: 'move' | 'start' | 'end'; x0: number; y0: number; start: number; end: number; trackId: string; moved: boolean }

/**
 * Under the stage in both spaces. Collapsed it is the editor's transport bar (play, loop, time, scrub); open it shows
 * the ruler with cues, tracks and clips. Every control here moves the editor preview only; the wall follows it only
 * with "wall follows" on. Drag clips to move them, their edges to resize.
 */
export function Timeline() {
  const ed = useEditor()
  const scene = ed.scene
  const open = ed.timelineOpen
  const lanesRef = useRef<HTMLDivElement>(null)
  const phRef = useRef<HTMLElement>(null)
  const tcRef = useRef<HTMLSpanElement>(null)
  const scrubRef = useRef<HTMLDivElement>(null)
  const scrubHead = useRef<HTMLElement>(null)
  const [laneW, setLaneW] = useState(800)
  const [drag, setDrag] = useState<ClipDrag | null>(null)
  const [override, setOverride] = useState<{ id: string; start: number; end: number; trackId: string } | null>(null)
  const [scrub, setScrub] = useState<number | null>(null)
  const [soundMuted, setSoundMuted] = useState(readMuted)
  const sounds = useSoundList(ed.hub)
  // §14: the preview (Space) plays the timeline's sound clips here, whatever the wall's audio output is
  usePreviewAudio(scene, ed.preview, { muted: soundMuted, mutedTracks: ed.mutedTracks })
  const duration = Math.max(1, scene?.timeline.duration ?? 20)
  const pps = laneW / duration
  const playing = ed.preview.playing
  const seek = (t: number) => ed.preview.seek(round3(t))

  useLayoutEffect(() => {
    const el = lanesRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setLaneW(el.clientWidth))
    ro.observe(el)
    setLaneW(el.clientWidth)
    return () => ro.disconnect()
  }, [open, !!scene])

  // the playhead and the timecode move every frame without re-rendering the timeline
  useRaf(() => {
    const t = scrub ?? ed.preview.t()
    const f = `${Math.min(1, Math.max(0, t / duration)) * 100}%`
    if (phRef.current) phRef.current.style.left = f
    if (scrubHead.current) scrubHead.current.style.left = f
    if (tcRef.current) tcRef.current.textContent = formatTime(t)
    // the preview holds at the end unless it loops
    if (ed.preview.playing && !ed.preview.loop && t >= duration - 1e-3) ed.preview.pause()
  })

  if (!scene) return <section className={s.tl} aria-label="timeline" data-open={open} />

  const tracks = scene.timeline.tracks
  const cues = sortedCues(scene)
  const timeAt = (clientX: number) => {
    const r = lanesRef.current!.getBoundingClientRect()
    return Math.min(duration, Math.max(0, ((clientX - r.left) / r.width) * duration))
  }

  const snapTime = (t: number, clipId: string, free: boolean) => {
    if (free) return round3(t)
    const cands = [0, duration, ...cues.map((c) => c.at), ...scene.timeline.clips.filter((c) => c.id !== clipId).flatMap((c) => [c.start, c.end])]
    let best = Math.round(t * 10) / 10
    let bd = SNAP_PX / pps
    for (const c of cands) {
      const d = Math.abs(c - t)
      if (d < bd) {
        bd = d
        best = c
      }
    }
    return round3(best)
  }

  const onClipDown = (e: PointerEvent, clip: Clip) => {
    if (e.button !== 0) return
    e.stopPropagation()
    ed.select({ clipId: clip.id, focus: 'clip' })
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const mode = e.clientX - r.left < EDGE_PX ? 'start' : r.right - e.clientX < EDGE_PX ? 'end' : 'move'
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    setDrag({ id: clip.id, mode, x0: e.clientX, y0: e.clientY, start: clip.start, end: clip.end, trackId: clip.trackId, moved: false })
  }

  const trackAtY = (clientY: number): Track | null => {
    const rows = lanesRef.current?.querySelectorAll<HTMLElement>('[data-lane]')
    if (!rows) return null
    for (const row of rows) {
      const r = row.getBoundingClientRect()
      if (clientY >= r.top && clientY < r.bottom) return tracks.find((t) => t.id === row.dataset.lane) ?? null
    }
    return null
  }

  const onClipMove = (e: PointerEvent) => {
    if (!drag) return
    if (!pressed(e)) return
    const dt = (e.clientX - drag.x0) / pps
    if (!drag.moved && Math.abs(e.clientX - drag.x0) < 3 && Math.abs(e.clientY - drag.y0) < 3) return
    drag.moved = true
    const len = drag.end - drag.start
    let start = drag.start
    let end = drag.end
    let trackId = drag.trackId
    if (drag.mode === 'move') {
      start = snapTime(Math.max(0, Math.min(duration - len, drag.start + dt)), drag.id, e.shiftKey)
      end = round3(start + len)
      // a clip moves to tracks of its own sort only: sound clips stay on sound tracks (§14)
      const over = trackAtY(e.clientY)
      const isSound = (id: string) => tracks.find((t) => t.id === id)?.target.kind === 'sound'
      trackId = over && (over.target.kind === 'sound') === isSound(drag.trackId) ? over.id : drag.trackId
    } else if (drag.mode === 'start') start = Math.min(drag.end - 0.1, snapTime(Math.max(0, drag.start + dt), drag.id, e.shiftKey))
    else end = Math.max(drag.start + 0.1, snapTime(Math.min(duration, drag.end + dt), drag.id, e.shiftKey))
    setOverride({ id: drag.id, start, end, trackId })
  }

  const scrubAt = (clientX: number) => {
    const r = scrubRef.current!.getBoundingClientRect()
    return Math.min(duration, Math.max(0, ((clientX - r.left) / r.width) * duration))
  }
  const onScrubDown = (e: PointerEvent) => {
    if (e.button !== 0) return
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    seek(scrubAt(e.clientX))
    setScrub(scrubAt(e.clientX))
  }
  const onScrubMove = (e: PointerEvent) => {
    if (scrub === null) return
    if (!pressed(e)) return
    setScrub(scrubAt(e.clientX))
    seek(scrubAt(e.clientX))
  }

  const onClipUp = () => {
    const d = drag
    const o = override
    setDrag(null)
    setOverride(null)
    if (!d || !d.moved || !o) return
    void ed.editing.edit((sc) => setClipTimes(sc, d.id, o.start, o.end, o.trackId))
  }

  const onLaneDrop = (e: DragEvent, track: Track) => {
    const data = e.dataTransfer.getData('text/plain')
    if (data.startsWith(SOUND_DRAG_PREFIX)) {
      e.preventDefault()
      const sha = data.slice(SOUND_DRAG_PREFIX.length)
      if (track.target.kind !== 'sound') {
        ed.toast('Drop sounds on a sound track: add one with + track.')
        return
      }
      addSoundAt(sha, timeAt(e.clientX), track.id)
      return
    }
    if (!data.startsWith('effect:')) return
    e.preventDefault()
    if (track.target.kind === 'sound') {
      ed.toast('A sound track plays sounds: drop one from the sounds library.')
      return
    }
    if (track.target.kind === 'layer') {
      ed.toast('A layer track takes reveal and sweep clips: use its ⋯ menu.')
      return
    }
    const effect = data.slice(7)
    const start = round3(Math.min(duration - 0.5, Math.round(timeAt(e.clientX) * 10) / 10))
    // (§20) a converge takes the light on air now (the underlay's mode while objects are on air) and needs no fades
    const converge = effect === 'converge' && ed.scene
    const clip: Clip = converge
      ? { id: newId('clp'), trackId: track.id, effect, start, end: round3(Math.min(duration, start + 2)), fadeIn: 0, fadeOut: 0, params: { source: convergeSource(ed.scene!) } }
      : effect === 'morph' || effect === 'shape'
        ? // (§21) a morph starts from the object and turns into a circle; a shape holds a circle
          { id: newId('clp'), trackId: track.id, effect, start, end: round3(Math.min(duration, start + 2)), fadeIn: 0, fadeOut: 0, params: effect === 'morph' ? { from: 'object', to: 'circle' } : { shape: 'circle' } }
        : { id: newId('clp'), trackId: track.id, effect, start, end: round3(Math.min(duration, start + 2)), fadeIn: 0.2, fadeOut: 0.2, params: {} }
    void ed.editing.edit(() => addClip(clip))
    ed.select({ clipId: clip.id, focus: 'clip' })
  }

  function addSoundAt(sha: string, at: number, trackId: string) {
    const snd = sounds.find((x) => x.sha === sha)
    const start = round3(Math.max(0, Math.min(duration - 0.5, Math.round(at * 10) / 10)))
    const len = snd?.duration && snd.duration > 0 ? snd.duration : 3
    const clip = soundClip(newId('clp'), trackId, sha, start, Math.min(duration, start + len))
    void ed.editing.edit((sc) => addSoundClip(sc, clip, newId('trk')))
    ed.select({ clipId: clip.id, focus: 'clip' })
  }

  const onRulerDown = (e: PointerEvent) => {
    if (e.button !== 0) return
    // a cue's menu lives in the ruler: let its items get their click
    if ((e.target as HTMLElement).closest(`.${s.cueWrap}`)) return
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    setScrub(timeAt(e.clientX))
  }
  const onRulerMove = (e: PointerEvent) => {
    if (scrub === null) return
    if (!pressed(e)) return
    setScrub(timeAt(e.clientX))
    seek(timeAt(e.clientX))
  }
  const onRulerUp = () => {
    if (scrub === null) return
    const t = round3(scrub)
    setScrub(null)
    seek(t)
  }

  const addCueHere = () => {
    const at = round3(ed.preview.t())
    void ed.editing.edit(() => addCue({ id: newId('cue'), at: Math.min(duration, at), label: `cue ${cues.length + 1}`, autoFollow: false }))
  }

  const sendToPhone = () => ed.sceneId && ed.command('show.activate', { sceneId: ed.sceneId }).then(() => ed.toast('The phone and the wall now play this scene.'))

  const ticks: number[] = []
  const step = duration <= 30 ? 2 : duration <= 120 ? 10 : 30
  for (let t = 0; t < duration; t += step) ticks.push(t)

  const layers = contentLayers(scene)
  const trackOptions = [
    { key: 'sound', label: 'sound (plays sound clips)', target: { kind: 'sound' as const, id: null }, name: 'sound' },
    { key: 'all', label: 'every surface', target: { kind: 'all' as const, id: null }, name: 'all' },
    ...scene.objects.map((o) => ({ key: o.id, label: o.name, target: { kind: 'object' as const, id: o.id }, name: o.name })),
    ...scene.objects.flatMap((o) => o.surfaces.map((x) => ({ key: x.id, label: `${o.name} · ${x.name}`, target: { kind: 'surface' as const, id: x.id }, name: `${o.name} · ${x.name}` }))),
    ...layers.map(({ layer, owner }) => ({ key: layer.id, label: `layer · ${owner} · ${layer.name}`, target: { kind: 'layer' as const, id: layer.id }, name: `${owner} · ${layer.name}` })),
  ]

  return (
    <section className={s.tl} aria-label="timeline" data-open={open} data-testid="timeline">
      <div className={s.tlh}>
        <Pill size="sm" icon="toStart" aria-label="to start (home)" title="to start (home)" onClick={() => seek(0)} />
        <Pill icon={playing ? 'pause' : 'play'} iconSize={14} on aria-label={playing ? 'pause the preview' : 'play the preview'} title="play or pause the editor preview (space); the wall keeps going" onClick={ed.preview.toggle} data-testid="play" />
        <Pill size="sm" icon="loop" aria-label="loop (L)" title="loop the preview (L)" on={ed.preview.loop} aria-pressed={ed.preview.loop} onClick={() => ed.preview.setLoop(!ed.preview.loop)} data-testid="loop" />
        <Pill
          size="sm"
          ghost={soundMuted}
          icon={soundMuted ? 'speakerOff' : 'speaker'}
          aria-label={soundMuted ? 'unmute the preview sound' : 'mute the preview sound'}
          aria-pressed={!soundMuted}
          title={soundMuted ? 'the preview plays the sound clips silently: click to hear them' : 'the preview plays the sound clips on this computer: click to mute them'}
          onClick={() => {
            setSoundMuted(!soundMuted)
            writeMuted(!soundMuted)
          }}
          data-testid="preview-sound"
        />
        <span className={s.tc}>
          <span ref={tcRef} data-testid="timecode">00:00.00</span> <span className={s.dim}>/ {formatTime(duration)}</span>
        </span>
        <div ref={scrubRef} className={s.scrub} onPointerDown={onScrubDown} onPointerMove={onScrubMove} onPointerUp={() => setScrub(null)} onPointerCancel={() => setScrub(null)} data-testid="scrub" title="drag to scrub the preview (J and K step a frame)">
          <span className={s.scrubTrack} />
          {cues.map((c) => (
            <i key={c.id} className={s.scrubCue} style={{ left: `${(c.at / duration) * 100}%` }} />
          ))}
          <i ref={scrubHead} className={s.scrubHead} />
        </div>
        {ed.solo && (
          <Pill size="sm" on icon="solo" onClick={ed.clearSolo} title="only the soloed surfaces show; click (or esc) to show everything" data-testid="solo-chip">
            solo · {ed.solo.length} {ed.solo.length === 1 ? 'surface' : 'surfaces'} · end
          </Pill>
        )}
        {open && (
          <>
            <Pill size="sm" icon="flag" iconSize={14} onClick={addCueHere} title="add a cue at the editor playhead">
              add cue
            </Pill>
            <Pill size="sm" ghost icon="phone" iconSize={14} onClick={sendToPhone} title="make this the active scene for the phone and the wall">
              play this scene on the wall
            </Pill>
          </>
        )}
        <Pill size="sm" ghost={!open} on={open} icon="chevronDown" onClick={() => ed.setTimelineOpen(!open)} aria-expanded={open} title={open ? 'fold the timeline away' : 'open the timeline: tracks, clips and cues'} data-testid="timeline-toggle">
          {open ? 'hide tracks' : `timeline · ${tracks.length} tracks`}
        </Pill>
      </div>
      {open && (
        <>
      <div className={s.corner}>
        <Menu
          width={260}
          trigger={({ toggle }) => (
            <Pill size="sm" ghost icon="plus" onClick={toggle}>
              track
            </Pill>
          )}
          items={trackOptions.map((o) => ({ key: o.key, label: o.label, onSelect: () => void ed.editing.edit(() => addTrack({ id: newId('trk'), name: o.name, target: o.target } as Track)) }))}
        />
      </div>
      <div className={s.rul} onPointerDown={onRulerDown} onPointerMove={onRulerMove} onPointerUp={onRulerUp} data-testid="ruler">
        {ticks.map((t) => (
          <span key={t} className={s.tick} style={{ left: `calc(${(t / duration) * 100}% + 3px)` }}>
            {t}s
          </span>
        ))}
        {cues.map((c) => (
          <Menu
            key={c.id}
            width={200}
            className={s.cueWrap}
            style={{ position: 'absolute', top: 1, left: `${(c.at / duration) * 100}%` }}
            trigger={({ toggle }) => (
              <button
                type="button"
                className={cx(s.cue, ed.sel.focus === 'cue' && ed.sel.cueId === c.id && s.cueSel)}
                title={`${c.label} · ${formatTime(c.at)}${c.sound?.sound ? ' · plays a sound on GO' : ''}`}
                data-testid={`cue-${c.id}`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={toggle}
              >
                Q{c.n}
              </button>
            )}
            items={[
              { key: 'l', caption: true, label: c.sound?.sound ? `${c.label} · plays a sound` : c.label },
              { key: 'go', label: 'jump here', icon: 'play', onSelect: () => seek(c.at) },
              { key: 'ed', label: c.sound?.sound ? 'edit cue and its sound' : 'edit cue (play a sound on GO)', icon: 'speaker', onSelect: () => ed.select({ cueId: c.id, clipId: null, focus: 'cue' }) },
              { key: 'af', label: c.autoFollow ? 'hold at the next cue' : 'follow on to the next cue', icon: 'next', onSelect: () => { const p = cuePath(scene, c.id, 'autoFollow'); if (p) ed.editing.setValue(p, !c.autoFollow, 'final') } },
              { key: 'mv', label: 'move to the playhead', icon: 'flag', onSelect: () => { const p = cuePath(scene, c.id, 'at'); if (p) ed.editing.setValue(p, round3(ed.preview.t()), 'final') } },
              { key: 'rm', label: 'delete cue', icon: 'trash', danger: true, onSelect: () => void ed.editing.edit((sc) => removeCue(sc, c.id)) },
            ]}
          />
        ))}
      </div>
      <div className={s.body}>
      <div className={s.tn}>
        {tracks.map((t) => (
          <TrackName key={t.id} scene={scene} track={t} sounds={sounds} onAddSound={(sha) => addSoundAt(sha, ed.preview.t(), t.id)} />
        ))}
      </div>
      <div className={s.lanes} ref={lanesRef}>
        {tracks.map((t) => (
          <div
            key={t.id}
            className={s.ln}
            data-lane={t.id}
            onDragOver={(e) => e.dataTransfer.types.includes('text/plain') && e.preventDefault()}
            onDrop={(e) => onLaneDrop(e, t)}
            onPointerDown={(e) => e.button === 0 && seek(timeAt(e.clientX))}
          >
            {scene.timeline.clips
              .filter((c) => (override?.id === c.id ? override.trackId : c.trackId) === t.id)
              .map((c) => {
                const o = override?.id === c.id ? override : null
                const start = o?.start ?? c.start
                const end = o?.end ?? c.end
                const def = ed.effects.find((d) => d.id === c.effect)
                const isSound = t.target.kind === 'sound'
                const snd = isSound ? sounds.find((x) => x.sha === soundClipParams(c).sound) : undefined
                const soundName = isSound ? (snd?.name ?? (sounds.length ? 'missing sound' : 'sound')) : ''
                // (§20) a held clip keeps its end state until the next clip of its effect on the track: a dashed tail
                // (§21) a step hold ends at the next cue
                const hm = clipHoldMode(c)
                const nextSame = Math.min(
                  scene.timeline.clips.filter((x) => x.trackId === t.id && x.effect === c.effect && x.id !== c.id && x.start > start).reduce((m, x) => Math.min(m, x.start), duration),
                  hm === 'step' ? stepEnd(start, stepBounds(scene)) : Infinity,
                )
                const tail = !isSound && hm !== 'off' && nextSame > end ? nextSame : 0
                return (
                  <Fragment key={c.id}>
                  {tail > 0 && <i className={s.holdTail} style={{ left: `${(end / duration) * 100}%`, width: `${((tail - end) / duration) * 100}%` }} title={`${def?.name ?? c.effect} holds its end${hm === 'step' ? ' to the next cue' : ''}`} aria-hidden="true" />}
                  <button
                    type="button"
                    data-align="content"
                    className={cx(s.clip, ed.sel.clipId === c.id && s.sel, ed.mutedTracks.has(t.id) && s.muted)}
                    style={{ left: `${(start / duration) * 100}%`, width: `calc(${((end - start) / duration) * 100}% - 4px)` }}
                    onPointerDown={(e) => onClipDown(e, c)}
                    onPointerMove={onClipMove}
                    onPointerUp={onClipUp}
                    onPointerCancel={onClipUp}
                    title={`${isSound ? soundName : def?.name ?? c.effect} · ${formatTime(start)} to ${formatTime(end)}`}
                    data-testid={`clip-${c.id}`}
                    data-sound={isSound ? 'true' : undefined}
                  >
                    {isSound && <Waveform className={s.clipWave} peaks={clipPeaks(snd, { ...c, start, end })} bars={48} height={20} />}
                    {c.fadeIn > 0 && <i className={s.fadeIn} style={{ width: `${Math.min(100, (c.fadeIn / Math.max(0.01, end - start)) * 100)}%` }} />}
                    {c.fadeOut > 0 && <i className={s.fadeOut} style={{ width: `${Math.min(100, (c.fadeOut / Math.max(0.01, end - start)) * 100)}%` }} />}
                    {(c.effect === 'converge' || c.effect === 'morph') && <Icon name="converge" size={12} className={s.clipIcon} />}
                    <span className={s.clipLabel}>{isSound ? soundName : (c.params as Record<string, unknown>).label ? String((c.params as Record<string, unknown>).label) : def?.name ?? c.effect}</span>
                  </button>
                  </Fragment>
                )
              })}
          </div>
        ))}
        {tracks.length === 0 && <div className={s.empty}>no tracks yet. add one with + track, then drop effects onto it.</div>}
      </div>
      </div>
      <div className={s.phLayer} aria-hidden="true">
        <i ref={phRef} className={s.phd} />
      </div>
        </>
      )}
    </section>
  )
}

function TrackName({ scene, track, sounds, onAddSound }: { scene: Scene; track: Track; sounds: Sound[]; onAddSound: (sha: string) => void }) {
  const ed = useEditor()
  const muted = ed.mutedTracks.has(track.id)
  const selClip = ed.sel.clipId ? scene.timeline.clips.find((c) => c.id === ed.sel.clipId) : null
  return (
    <div className={cx(s.tr, selClip?.trackId === track.id && s.trSel, muted && s.trMuted)}>
      <span className={s.k} title={track.name}>
        {track.name}
      </span>
      <Menu
        align="right"
        width={200}
        trigger={({ toggle }) => (
          <button type="button" className={s.trBtn} aria-label={`${track.name} options`} onClick={toggle}>
            <Icon name="more" size={13} />
          </button>
        )}
        items={[
          ...(track.target.kind === 'layer'
            ? (['reveal', 'sweep'] as const).map((effect) => ({
                key: effect,
                icon: effect === 'reveal' ? 'play' : 'gradient',
                label: effect === 'reveal' ? 'add a reveal clip here (wipes it on)' : 'add a sweep clip here (moves it across)',
                onSelect: () => {
                  const at = round3(Math.min(scene.timeline.duration - 0.5, ed.preview.t()))
                  const clip: Clip = { id: newId('clp'), trackId: track.id, effect, start: at, end: round3(Math.min(scene.timeline.duration, at + 3)), fadeIn: 0, fadeOut: 0, params: { ...LAYER_CLIP_DEFAULTS[effect] } }
                  void ed.editing.edit(() => addClip(clip))
                  ed.select({ clipId: clip.id, focus: 'clip' })
                },
              }))
            : []),
          ...(track.target.kind === 'sound'
            ? sounds.length
              ? [
                  { key: 'cap', caption: true, label: 'add at the playhead' },
                  ...sounds.slice(0, 16).map((snd) => ({ key: `snd-${snd.sha}`, icon: 'speaker', label: snd.name, onSelect: () => onAddSound(snd.sha) })),
                ]
              : [{ key: 'none', caption: true, label: 'upload sounds in the sounds library first' }]
            : []),
          { key: 'rm', label: 'delete track and its clips', icon: 'trash', danger: true, onSelect: () => void ed.editing.edit((sc) => removeTrack(sc, track.id)) },
        ]}
      />
      <button type="button" className={s.trBtn} aria-label={muted ? `unmute ${track.name}` : `mute ${track.name}`} onClick={() => ed.toggleTrack(track.id)}>
        <Icon name={muted ? 'eyeOff' : 'eye'} size={13} />
      </button>
    </div>
  )
}

