import { useLayoutEffect, useRef, useState, type DragEvent, type PointerEvent } from 'react'
import { Icon, Menu, Pill } from '../../../../shared/components'
import { cx } from '../../../../shared/lib/cx'
import { newId } from '../../../../shared/lib/ids'
import { useRaf } from '../../../../shared/lib/useRaf'
import { LAYER_CLIP_DEFAULTS } from '../../../../render/timeline'
import { useEditor } from '../../editor/context'
import { addClip, addCue, addTrack, cuePath, removeCue, removeTrack, round3, setClipTimes, sortedCues } from '../../ops'
import type { Clip, ContentLayer, Scene, Track } from '../../types'
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
      trackId = trackAtY(e.clientY)?.id ?? drag.trackId
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
    if (!data.startsWith('effect:')) return
    e.preventDefault()
    if (track.target.kind === 'layer') {
      ed.toast('A layer track takes reveal and sweep clips: use its ⋯ menu.')
      return
    }
    const effect = data.slice(7)
    const start = round3(Math.min(duration - 0.5, Math.round(timeAt(e.clientX) * 10) / 10))
    const clip: Clip = { id: newId('clp'), trackId: track.id, effect, start, end: round3(Math.min(duration, start + 2)), fadeIn: 0.2, fadeOut: 0.2, params: {} }
    void ed.editing.edit(() => addClip(clip))
    ed.select({ clipId: clip.id, focus: 'clip' })
  }

  const onRulerDown = (e: PointerEvent) => {
    if (e.button !== 0) return
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    setScrub(timeAt(e.clientX))
  }
  const onRulerMove = (e: PointerEvent) => {
    if (scrub === null) return
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
                className={s.cue}
                title={`${c.label} · ${formatTime(c.at)}`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={toggle}
              >
                Q{c.n}
              </button>
            )}
            items={[
              { key: 'l', caption: true, label: c.label },
              { key: 'go', label: 'jump here', icon: 'play', onSelect: () => seek(c.at) },
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
          <TrackName key={t.id} scene={scene} track={t} />
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
                return (
                  <button
                    key={c.id}
                    type="button"
                    data-align="content"
                    className={cx(s.clip, ed.sel.clipId === c.id && s.sel, ed.mutedTracks.has(t.id) && s.muted)}
                    style={{ left: `${(start / duration) * 100}%`, width: `calc(${((end - start) / duration) * 100}% - 4px)` }}
                    onPointerDown={(e) => onClipDown(e, c)}
                    onPointerMove={onClipMove}
                    onPointerUp={onClipUp}
                    onPointerCancel={onClipUp}
                    title={`${def?.name ?? c.effect} · ${formatTime(start)} to ${formatTime(end)}`}
                    data-testid={`clip-${c.id}`}
                  >
                    {c.fadeIn > 0 && <i className={s.fadeIn} style={{ width: `${Math.min(100, (c.fadeIn / Math.max(0.01, end - start)) * 100)}%` }} />}
                    {c.fadeOut > 0 && <i className={s.fadeOut} style={{ width: `${Math.min(100, (c.fadeOut / Math.max(0.01, end - start)) * 100)}%` }} />}
                    <span className={s.clipLabel}>{(c.params as Record<string, unknown>).label ? String((c.params as Record<string, unknown>).label) : def?.name ?? c.effect}</span>
                  </button>
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

function TrackName({ scene, track }: { scene: Scene; track: Track }) {
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
          { key: 'rm', label: 'delete track and its clips', icon: 'trash', danger: true, onSelect: () => void ed.editing.edit((sc) => removeTrack(sc, track.id)) },
        ]}
      />
      <button type="button" className={s.trBtn} aria-label={muted ? `unmute ${track.name}` : `mute ${track.name}`} onClick={() => ed.toggleTrack(track.id)}>
        <Icon name={muted ? 'eyeOff' : 'eye'} size={13} />
      </button>
    </div>
  )
}

