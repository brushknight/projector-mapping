import { useEffect, useRef, useState } from 'react'
import { Cap, Dialog, EmptyState, Field, FillSlider, Icon, Menu, Pad, Pill, Switch, TextInput } from '../../../../shared/components'
import { cx } from '../../../../shared/lib/cx'
import { newId } from '../../../../shared/lib/ids'
import type { SceneEditing } from '../../../scene/editing'
import { addPad, padsOf, removePad, updatePad } from '../../../scene/ops'
import { PAD_COLORS, PAD_ICONS, type PadColor, type PadIcon, type Scene, type SoundPad } from '../../../scene/types'
import type { Sound, SoundPlayAck } from '../../types'
import { useSoundUpload } from '../soundLibrary'
import { formatDuration } from '../useSounds'
import s from './styles.module.css'

/** A pad colour as its theme token (§14 palette). */
export const padTone = (c: PadColor | undefined) => `var(--pad-${PAD_COLORS.includes(c as PadColor) ? c : 'ink'})`
const glyph = (i: PadIcon | undefined) => (i && i !== 'none' ? i : null)

/** The first letter of the name (or any letter, then digit) that no other pad uses. */
export function freeKey(pads: SoundPad[], name: string): string | undefined {
  const used = new Set(pads.map((p) => (p.key ?? '').toLowerCase()))
  const cand = [...name.toLowerCase().replace(/[^a-z0-9]/g, ''), ...'abcdefghijklmnopqrstuvwxyz0123456789']
  return cand.find((c) => !used.has(c))
}

/**
 * The soundboard of the scene on the wall (§14): pads in grid order; click or the pad's key plays it on the audio
 * output, a looping pad toggles and shows playing while the server lists it in `show.audio.loops`.
 */
export function Soundboard({
  scene,
  editing,
  sounds,
  loops,
  onPlay,
  onStopAll,
  toast,
  reloadSounds,
}: {
  scene: Scene
  editing: SceneEditing
  sounds: Sound[]
  loops: string[]
  onPlay: (padId: string) => Promise<SoundPlayAck | undefined>
  onStopAll: () => void
  toast: (msg: string, opts?: { bad?: boolean }) => void
  reloadSounds: () => void
}) {
  const pads = padsOf(scene)
  const [edit, setEdit] = useState<string | null>(null)
  const [flash, setFlash] = useState<Record<string, number>>({})
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  useEffect(() => () => timers.current.forEach(clearTimeout), [])
  const soundOf = (p: SoundPad) => sounds.find((x) => x.sha === p.sound)

  const press = async (p: SoundPad) => {
    const ack = await onPlay(p.id)
    if (!ack || p.loop || ack.stopped) return
    // a one-shot shows playing for its length
    const ms = Math.max(400, Math.min(30_000, (soundOf(p)?.duration ?? 1) * 1000))
    setFlash((f) => ({ ...f, [p.id]: Date.now() + ms }))
    clearTimeout(timers.current.get(p.id))
    timers.current.set(
      p.id,
      setTimeout(() => setFlash((f) => ({ ...f, [p.id]: 0 })), ms),
    )
  }
  // the parent's keyboard handler plays pads through this too
  useEffect(() => {
    const h = (e: Event) => {
      const p = pads.find((x) => x.id === (e as CustomEvent<string>).detail)
      if (p) void press(p)
    }
    window.addEventListener('pm:pad', h)
    return () => window.removeEventListener('pm:pad', h)
  })

  const add = async (snd: Sound) => {
    const pad: SoundPad = { id: newId('pad'), name: snd.name.slice(0, 40), sound: snd.sha, volume: 1, color: PAD_COLORS[(pads.length + 1) % PAD_COLORS.length], icon: 'none', loop: false }
    const k = freeKey(pads, snd.name)
    if (k) pad.key = k
    await editing.edit((sc) => addPad(sc, pad))
    setEdit(pad.id)
  }
  const up = useSoundUpload({
    onDone: (snd) => {
      reloadSounds()
      void add(snd)
    },
    onError: (m) => toast(m, { bad: true }),
  })
  const editing_ = pads.find((p) => p.id === edit) ?? null

  return (
    <div className={s.board} data-testid="soundboard">
      {pads.length === 0 && <EmptyState>no pads yet. add one and give it a key.</EmptyState>}
      <div className={s.grid}>
        {pads.map((p) => {
          const snd = soundOf(p)
          const playing = p.loop ? loops.includes(p.id) : (flash[p.id] ?? 0) > Date.now()
          return (
            <Pad
              key={p.id}
              label={p.name}
              icon={glyph(p.icon)}
              tone={padTone(p.color)}
              keyLabel={p.key}
              loop={!!p.loop}
              playing={playing}
              missing={sounds.length > 0 && !snd}
              meta={snd ? formatDuration(snd.duration) : undefined}
              onPress={() => void press(p)}
              onEdit={() => setEdit(p.id)}
              testId={`pad-${p.id}`}
            />
          )
        })}
        <Menu
          width={280}
          align="right"
          className={s.addWrap}
          trigger={({ toggle }) => (
            <button type="button" className={s.add} onClick={toggle} data-testid="pad-add">
              <Icon name="plus" size={18} />
              add pad
            </button>
          )}
          items={[
            { key: 'cap', caption: true, label: 'pick a sound' },
            ...sounds.map((snd) => ({ key: snd.sha, icon: 'speaker', label: snd.name, meta: formatDuration(snd.duration), onSelect: () => void add(snd) })),
            { key: 'up', icon: 'upload', label: 'upload a sound', onSelect: up.pick },
          ]}
        />
      </div>
      {up.input}
      <div className={s.foot}>
        <Pill size="sm" icon="stop" iconSize={12} onClick={onStopAll} title="stop every pad and cue sound (the timeline keeps playing)" data-testid="stop-all">
          stop all
        </Pill>
        <span className={s.hint}>keys play pads · enter = go</span>
      </div>
      {editing_ && <PadEditor pad={editing_} scene={scene} editing={editing} sounds={sounds} onClose={() => setEdit(null)} onUpload={up.pick} />}
    </div>
  )
}

/** Edit one pad: name, sound, volume, colour, icon, key and loop, written at once; delete removes it. */
function PadEditor({ pad, scene, editing, sounds, onClose, onUpload }: { pad: SoundPad; scene: Scene; editing: SceneEditing; sounds: Sound[]; onClose: () => void; onUpload: () => void }) {
  const set = (patch: Partial<SoundPad>) => void editing.edit((sc) => updatePad(sc, pad.id, patch))
  const [key, setKey] = useState(pad.key ?? '')
  useEffect(() => setKey(pad.key ?? ''), [pad.key])
  const clash = key ? padsOf(scene).find((p) => p.id !== pad.id && (p.key ?? '').toLowerCase() === key.toLowerCase()) : null
  const snd = sounds.find((x) => x.sha === pad.sound)
  return (
    <Dialog title={`pad · ${pad.name}`} onClose={onClose} width={520}>
      <div className={s.ed} data-testid="pad-editor">
        <div className={s.two}>
          <Field label="name">
            <TextInput defaultValue={pad.name} maxLength={40} onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== pad.name && set({ name: e.target.value.trim() })} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} data-testid="pad-name" />
          </Field>
          <Field label="key">
            <TextInput
              value={key}
              maxLength={1}
              placeholder="none"
              data-testid="pad-key"
              onChange={(e) => {
                const v = e.target.value.toLowerCase().slice(-1)
                if (v && !/^[a-z0-9]$/.test(v)) return
                setKey(v)
                set({ key: v || null })
              }}
            />
          </Field>
        </div>
        {clash && <p className={s.warn}>{clash.name} uses {key.toUpperCase()} too; the first pad plays.</p>}
        <Field label="sound">
          <Menu
            width={460}
            trigger={({ toggle }) => (
              <Pill size="sm" icon="speaker" onClick={toggle} className={s.soundPick} data-testid="pad-sound">
                {snd ? `${snd.name} · ${formatDuration(snd.duration)}` : 'missing sound: pick one'}
                <Icon name="chevronDown" size={13} />
              </Pill>
            )}
            items={[...sounds.map((x) => ({ key: x.sha, label: x.name, meta: formatDuration(x.duration), on: x.sha === pad.sound, onSelect: () => set({ sound: x.sha }) })), { key: 'up', icon: 'upload', label: 'upload a sound', onSelect: onUpload }]}
          />
        </Field>
        <FillSlider label="volume" value={pad.volume} display={`${Math.round(pad.volume * 100)}%`} onChange={(v, ph) => ph === 'final' && set({ volume: Math.round(v * 100) / 100 })} />
        <Cap>color</Cap>
        <div className={s.swatches} role="radiogroup" aria-label="color">
          {PAD_COLORS.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={pad.color === c} aria-label={c} title={c} className={cx(s.swatch, pad.color === c && s.on)} style={{ background: padTone(c) }} onClick={() => set({ color: c })} />
          ))}
        </div>
        <Cap>icon</Cap>
        <div className={s.icons} role="radiogroup" aria-label="icon">
          {PAD_ICONS.map((i) => (
            <button key={i} type="button" role="radio" aria-checked={(pad.icon ?? 'none') === i} aria-label={i} title={i === 'none' ? 'no icon: the name shows' : i} className={cx(s.iconBtn, (pad.icon ?? 'none') === i && s.on)} onClick={() => set({ icon: i })}>
              {i === 'none' ? <span className={s.aa}>aa</span> : <Icon name={i} size={18} />}
            </button>
          ))}
        </div>
        <div className={s.row}>
          <span>loop until pressed again</span>
          <Switch checked={!!pad.loop} onChange={(v) => set({ loop: v })} ariaLabel="loop" />
        </div>
        <div className={s.actions}>
          <Pill
            ghost
            icon="trash"
            onClick={() => {
              void editing.edit((sc) => removePad(sc, pad.id))
              onClose()
            }}
            data-testid="pad-delete"
          >
            delete pad
          </Pill>
          <Pill on onClick={onClose} data-testid="pad-done">
            done
          </Pill>
        </div>
      </div>
    </Dialog>
  )
}
