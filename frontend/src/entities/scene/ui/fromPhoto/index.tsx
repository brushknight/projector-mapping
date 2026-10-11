import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from 'react'
import { Cap, Dialog, Glass, Icon, Pill, Row, Segmented, Switch, TextArea, TextInput } from '../../../../shared/components'
import { cx } from '../../../../shared/lib/cx'
import { agentApi } from '../../../agent/api'
import { assetApi } from '../../../asset/api'
import { assetUrl, type Asset } from '../../../asset/types'
import { frameBlob, useCamera } from '../../../camera'
import { sceneApi } from '../../api'
import { useEditor } from '../../editor/context'
import type { Scene } from '../../types'
import s from './styles.module.css'

type Source = 'upload' | 'iphone' | 'camera'
type Position = 'lens' | 'anywhere'

/**
 * "New scene from photo": upload (drop, pick or paste), ask the iPhone for a still, or grab a frame from the live
 * camera; then POST /scenes/from-photo and optionally ask an agent to outline the objects.
 */
export function FromPhotoDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (scene: Scene, position: Position) => void }) {
  const ed = useEditor()
  const [source, setSource] = useState<Source>('upload')
  const [position, setPosition] = useState<Position>('lens')
  const [detect, setDetect] = useState(true)
  const [ask, setAsk] = useState(true)
  const [prompt, setPrompt] = useState('outline the objects you can see: faces, details and edges')
  const [name, setName] = useState('')
  const [asset, setAsset] = useState<Asset | null>(null)
  const [local, setLocal] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const file = useRef<HTMLInputElement>(null)
  const cam = useCamera(ed.hub, source === 'camera')

  useEffect(() => () => {
    if (local) URL.revokeObjectURL(local)
  }, [local])

  const upload = async (blob: Blob, filename: string) => {
    setBusy('uploading')
    if (local) URL.revokeObjectURL(local)
    setLocal(URL.createObjectURL(blob))
    try {
      const a = await assetApi.upload(blob, 'reference', filename)
      setAsset(a)
      if (!name) setName(filename.replace(/\.[^.]+$/, '').slice(0, 40))
    } catch (e) {
      ed.toast(e instanceof Error ? e.message : String(e), { bad: true })
    } finally {
      setBusy(null)
    }
  }

  const askPhone = async () => {
    setSource('iphone')
    setBusy('waiting for the iphone')
    try {
      const r = (await ed.hub.cmd('camera.capture', { purpose: 'scene' })) as { sha?: string } | undefined
      if (r?.sha) {
        setAsset({ sha: r.sha, mime: 'image/jpeg', width: 0, height: 0, bytes: 0, kind: 'reference' })
        setLocal(null)
      } else ed.toast('The phone took the photo; it shows up when the server sends it.')
    } catch (e) {
      ed.toast(`The server can't ask the phone for a photo yet (${e instanceof Error ? e.message : e}). Upload one instead.`, { bad: true })
      setSource('upload')
    } finally {
      setBusy(null)
    }
  }

  const grab = () => {
    if (!cam.frame) return ed.toast('No camera frame yet. Open auto map on the phone first.', { bad: true })
    void upload(frameBlob(cam.frame), `camera-${cam.frame.seq}.jpg`)
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    const f = e.dataTransfer.files?.[0]
    if (f && f.type.startsWith('image/')) void upload(f, f.name)
  }
  const onPaste = (e: ClipboardEvent) => {
    const f = [...e.clipboardData.files].find((x) => x.type.startsWith('image/'))
    if (f) void upload(f, f.name || 'pasted.png')
  }

  const create = async () => {
    if (!asset) return
    setBusy('creating the scene')
    try {
      const sc = await sceneApi.fromPhoto(asset.sha, position, name.trim() || 'from photo', { detect })
      if (ask && prompt.trim()) await agentApi.start('codex', prompt.trim(), sc.id).catch((e) => ed.toast(`The scene is ready, but the agent didn't start: ${e.message ?? e}`, { bad: true }))
      onCreated(sc, position)
    } catch (e) {
      ed.toast(e instanceof Error ? e.message : String(e), { bad: true })
    } finally {
      setBusy(null)
    }
  }

  const preview = local ?? (asset ? assetUrl(asset.sha) : null)
  const sources: Array<{ id: Source; icon: string; title: string; sub: string; onClick: () => void }> = [
    { id: 'upload', icon: 'upload', title: 'upload a photo', sub: 'drop a jpg or heic, or paste', onClick: () => { setSource('upload'); file.current?.click() } },
    { id: 'iphone', icon: 'phone', title: 'take with iphone', sub: 'the phone opens its camera', onClick: askPhone },
    { id: 'camera', icon: 'video', title: 'from live camera', sub: 'grab a frame from the stream', onClick: () => setSource('camera') },
  ]

  return (
    <Dialog title="new scene from photo" onClose={onClose}>
      <div className={s.sources} onPaste={onPaste}>
        {sources.map((x) => (
          <button key={x.id} type="button" className={cx(s.src, source === x.id && s.on)} onClick={x.onClick}>
            <Icon name={x.icon} size={22} />
            <span className={s.srcTitle}>{x.title}</span>
            <span className={s.srcSub}>{x.sub}</span>
          </button>
        ))}
      </div>
      <input
        ref={file}
        type="file"
        accept="image/*,.heic"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) void upload(f, f.name)
        }}
      />
      <div className={s.body}>
        <div className={s.feed} onDragOver={(e) => e.preventDefault()} onDrop={onDrop} onPaste={onPaste} tabIndex={0}>
          {source === 'camera' && !asset ? (
            cam.frame ? <img src={`data:image/jpeg;base64,${cam.frame.jpeg}`} alt="live camera" className={s.img} /> : <div className={s.empty}>no camera stream. open auto map on the phone.</div>
          ) : preview ? (
            <img src={preview} alt="the photo" className={s.img} />
          ) : (
            <div className={s.empty}>{busy ?? 'drop a photo here, paste one, or pick a source above.'}</div>
          )}
          <div className={s.fbar}>
            {asset ? <Glass>photo{asset.width ? ` · ${asset.width}×${asset.height}` : ''}</Glass> : <span />}
            {busy && <Glass>{busy}</Glass>}
          </div>
          {source === 'camera' && (
            <div className={s.grab}>
              <Pill icon="camera" on onClick={grab}>
                grab this frame
              </Pill>
            </div>
          )}
        </div>
        <div className={s.side}>
          <Cap>where was it taken</Cap>
          <Segmented<Position>
            ariaLabel="position"
            value={position}
            onChange={setPosition}
            options={[
              { value: 'lens', label: 'next to the lens' },
              { value: 'anywhere', label: 'anywhere' },
            ]}
          />
          <span className={s.note}>next to the lens: outlines drawn on the photo land on the object. anywhere: run a quick calibration first.</span>
          <TextInput placeholder="scene name" value={name} onChange={(e) => setName(e.target.value)} aria-label="scene name" />
          <Row>
            <span>find surfaces automatically</span>
            <Switch checked={detect} onChange={setDetect} ariaLabel="find surfaces automatically" />
          </Row>
          <Row>
            <span>ask codex to outline them</span>
            <Switch checked={ask} onChange={setAsk} ariaLabel="ask codex to outline them" />
          </Row>
          {ask && <TextArea value={prompt} onChange={setPrompt} placeholder="what should it outline" />}
          <span className={s.sp} />
          <Row>
            <Pill ghost onClick={onClose}>
              cancel
            </Pill>
            <Pill on size="lg" disabled={!asset || !!busy} onClick={create} data-testid="create-scene">
              create scene
            </Pill>
          </Row>
        </div>
      </div>
    </Dialog>
  )
}
