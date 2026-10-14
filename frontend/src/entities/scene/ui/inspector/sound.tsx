/**
 * Inspector parts for sound and video (protocol §14): a sound clip (sound, file offset, volume, fades), a cue (label,
 * follow on, the sound it plays on GO) and the extra notes of a video backdrop layer.
 */
import { Cap, FillSlider, Menu, NumField, Pill, Row, Section, Switch, TextInput, Waveform } from '../../../../shared/components'
import { soundClipParams } from '../../../sound/audioSchedule'
import { useSoundList } from '../../../sound/audioHooks'
import type { Sound } from '../../../sound/types'
import { useEditor } from '../../editor/context'
import { clipPath, cuePath, removeClip, removeCue, setClipParams, setCueSound, sortedCues } from '../../ops'
import type { Layer, Scene } from '../../types'
import s from './styles.module.css'

const r2 = (v: number) => Math.round(v * 100) / 100

function Head({ kind, title, menu }: { kind: string; title: string; menu: Array<{ key: string; label: string; icon?: string; danger?: boolean; onSelect: () => void }> }) {
  return (
    <div className={s.ph}>
      <span className={s.title}>
        <Cap>{kind}</Cap>
        <span className={s.name}>{title}</span>
      </span>
      <Menu align="right" width={220} trigger={({ toggle }) => <Pill size="sm" icon="more" aria-label="more" onClick={toggle} />} items={menu} />
    </div>
  )
}

/** Picks a library sound (the `sounds` channel); shows "missing sound" for a sha the library no longer has. */
export function SoundPicker({ sounds, value, onPick, emptyLabel = 'pick a sound' }: { sounds: Sound[]; value: string | null; onPick: (sha: string) => void; emptyLabel?: string }) {
  const cur = value ? sounds.find((x) => x.sha === value) : undefined
  const label = cur?.name ?? (value ? 'missing sound' : emptyLabel)
  return (
    <Menu
      width={260}
      trigger={({ toggle }) => (
        <Pill size="sm" icon="speaker" onClick={toggle} data-testid="sound-picker">
          {label}
        </Pill>
      )}
      items={
        sounds.length
          ? sounds.map((snd) => ({ key: snd.sha, label: snd.name, icon: 'speaker', on: snd.sha === value, meta: snd.duration ? `${snd.duration.toFixed(1)}s` : undefined, onSelect: () => onPick(snd.sha) }))
          : [{ key: 'none', caption: true, label: 'no sounds yet: upload some in the sounds library' }]
      }
    />
  )
}

/** A clip on a sound track: which sound, where in the file it starts, how loud, the fades. */
export function SoundClipInspector({ scene, clipId }: { scene: Scene; clipId: string }) {
  const ed = useEditor()
  const sounds = useSoundList(ed.hub)
  const clip = scene.timeline.clips.find((c) => c.id === clipId)!
  const p = soundClipParams(clip)
  const snd = sounds.find((x) => x.sha === p.sound)
  const cp = (...rest: Array<string | number>) => clipPath(scene, clipId, ...rest)!
  const setParams = (patch: Record<string, unknown>) => void ed.editing.edit((sc) => setClipParams(sc, clipId, patch))
  const len = clip.end - clip.start
  const fileLen = snd?.duration ?? 0
  return (
    <div className={s.insp} data-testid="sound-clip-inspector">
      <Head
        kind="sound clip"
        title={snd?.name ?? (p.sound ? 'missing sound' : 'no sound')}
        menu={[{ key: 'del', label: 'delete clip', icon: 'trash', danger: true, onSelect: () => {
          void ed.editing.edit((sc) => removeClip(sc, clipId))
          ed.select({ clipId: null, focus: null })
        } }]}
      />
      <Section tight>
        <Row>
          <span>sound</span>
          <SoundPicker sounds={sounds} value={p.sound || null} onPick={(sha) => setParams({ sound: sha })} />
        </Row>
        {snd?.peaks?.length ? <Waveform peaks={snd.peaks} progress={fileLen ? Math.min(1, (p.offset + len) / fileLen) : null} bars={64} height={28} /> : null}
        {fileLen > 0 && p.offset + len > fileLen + 0.01 && <span className={s.dim}>the file ends {r2(p.offset + len - fileLen)}s before the clip does: that part is silent.</span>}
        <FillSlider label="volume" value={p.volume} display={`${Math.round(p.volume * 100)}%`} onChange={(v, ph) => ed.editing.setValue(cp('params', 'volume'), r2(v), ph)} />
      </Section>
      <Section>
        <Cap>timing</Cap>
        <div className={s.two}>
          <NumField prefix="start" ariaLabel="start" value={clip.start} digits={2} step={0.1} min={0} onCommit={(v) => ed.editing.setValue(cp('start'), Math.min(v, clip.end - 0.05), 'final')} suffix="s" />
          <NumField prefix="end" ariaLabel="end" value={clip.end} digits={2} step={0.1} min={0} onCommit={(v) => ed.editing.setValue(cp('end'), Math.max(v, clip.start + 0.05), 'final')} suffix="s" />
          <NumField prefix="from" ariaLabel="file offset" value={p.offset} digits={2} step={0.1} min={0} onCommit={(v) => setParams({ offset: Math.max(0, r2(v)) })} suffix="s" />
          <span className={s.dim}>into the file</span>
          <NumField prefix="fade in" ariaLabel="fade in" value={clip.fadeIn} digits={2} step={0.1} min={0} onCommit={(v) => ed.editing.setValue(cp('fadeIn'), Math.max(0, v), 'final')} suffix="s" />
          <NumField prefix="fade out" ariaLabel="fade out" value={clip.fadeOut} digits={2} step={0.1} min={0} onCommit={(v) => ed.editing.setValue(cp('fadeOut'), Math.max(0, v), 'final')} suffix="s" />
        </div>
        {snd?.duration ? (
          <Pill size="sm" ghost onClick={() => ed.editing.setValue(cp('end'), r2(Math.min(scene.timeline.duration, clip.start + Math.max(0.1, snd.duration - p.offset))), 'final')}>
            fit the clip to the sound
          </Pill>
        ) : null}
        <span className={s.dim}>space plays it in the editor; the wall plays it from the audio output when the show plays.</span>
      </Section>
    </div>
  )
}

/** A cue: its label, whether playback follows on, and the sound GO plays. */
export function CueInspector({ scene, cueId }: { scene: Scene; cueId: string }) {
  const ed = useEditor()
  const sounds = useSoundList(ed.hub)
  const cue = sortedCues(scene).find((c) => c.id === cueId)!
  const path = (...rest: string[]) => cuePath(scene, cueId, ...rest)!
  const vol = cue.sound?.volume ?? 1
  return (
    <div className={s.insp} data-testid="cue-inspector">
      <Head
        kind={`cue Q${cue.n}`}
        title={cue.label}
        menu={[{ key: 'del', label: 'delete cue', icon: 'trash', danger: true, onSelect: () => {
          void ed.editing.edit((sc) => removeCue(sc, cueId))
          ed.select({ cueId: null, focus: null })
        } }]}
      />
      <Section tight>
        <TextInput defaultValue={cue.label} key={cue.label} aria-label="cue label" onBlur={(e) => e.target.value.trim() && e.target.value !== cue.label && ed.editing.setValue(path('label'), e.target.value.trim(), 'final')} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
        <div className={s.two}>
          <NumField prefix="at" ariaLabel="cue time" value={cue.at} digits={2} step={0.1} min={0} max={scene.timeline.duration} onCommit={(v) => ed.editing.setValue(path('at'), Math.max(0, Math.min(scene.timeline.duration, r2(v))), 'final')} suffix="s" />
        </div>
        <Row>
          <span>follow on to the next cue</span>
          <Switch checked={cue.autoFollow} onChange={(v) => ed.editing.setValue(path('autoFollow'), v, 'final')} ariaLabel="follow on" />
        </Row>
      </Section>
      <Section>
        <Cap>play a sound on GO</Cap>
        <Row>
          <SoundPicker sounds={sounds} value={cue.sound?.sound ?? null} emptyLabel="no sound" onPick={(sha) => void ed.editing.edit((sc) => setCueSound(sc, cueId, { sound: sha, volume: vol }))} />
          {cue.sound && (
            <Pill size="sm" ghost icon="close" aria-label="remove the cue sound" onClick={() => void ed.editing.edit((sc) => setCueSound(sc, cueId, null))}>
              clear
            </Pill>
          )}
        </Row>
        {cue.sound && <FillSlider label="volume" value={vol} display={`${Math.round(vol * 100)}%`} onChange={(v, ph) => ed.editing.setValue(path('sound', 'volume'), r2(v), ph)} />}
        <span className={s.dim}>GO on the wall (or playback passing a follow-on cue) plays it once on the audio output; seek and back do not.</span>
      </Section>
    </div>
  )
}

/** What a video layer is (an uploaded video or a YouTube player) and what its controls do. */
export function VideoLayerNote({ layer }: { layer: Layer }) {
  const yt = layer.ref.startsWith('youtube:')
  return (
    <Section>
      <Cap>video</Cap>
      <Row>
        <span className={s.dim}>{yt ? `YouTube ${layer.ref.slice(8)}` : 'video file'}</span>
      </Row>
      <span className={s.dim}>
        {yt
          ? 'plays in an embedded YouTube player behind the picture (it needs the internet), always at the bottom of the stack. drift does not apply; install yt-dlp (brew install yt-dlp) for offline loops you can fully blur.'
          : 'loops from "loop from" to "loop to" (0 = the end), drawn like a photo. "play its sound" sends its sound to the projector when it is the audio output.'}
      </span>
    </Section>
  )
}
