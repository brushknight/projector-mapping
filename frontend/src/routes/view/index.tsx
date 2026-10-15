import { useSearch } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { LivePreview, useWallDocs } from '../../entities/output'
import { sceneSize } from '../../entities/setup'
import { showAudio } from '../../entities/show'
import { unlockAudio } from '../../entities/sound/audio'
import { useLocalWallAudio } from '../../entities/sound/audioHooks'
import { Icon, OnAirDot } from '../../shared/components'
import { setAuthToken } from '../../shared/lib/http'
import { useHubStatus, useOwnHub } from '../../shared/lib/useHub'
import { Hub } from '../../shared/lib/ws'
import s from './styles.module.css'

const MODE_LABEL: Record<string, string> = { static: 'static light', live: 'live', color: 'colour', scenery: 'scenery', objects: 'objects' }
const IDLE_MS = 2200

/**
 * The viewer (protocol §15): exactly what the projector shows, in its own window, read only. Same engine and clock as
 * /out (test pattern, solo, video and YouTube, live animation), letterboxed in the window. It is never the output and
 * never an audio client; its sound toggle plays the video layers' sound and the timeline's sound clips locally. A
 * small bar shows on hover: the scene, the mode, sound, fullscreen and close.
 */
export function ViewPage() {
  const { token } = useSearch({ from: '/view' })
  const hub = useOwnHub(() => {
    if (token) setAuthToken(token)
    return new Hub({ role: 'remote', name: 'viewer', caps: [], token: token ?? null })
  })
  const status = useHubStatus(hub)
  const { show, scene, setup, previewing } = useWallDocs(hub)
  const [sound, setSound] = useState(false)
  const [bar, setBar] = useState(true)
  const [full, setFull] = useState(false)
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null)
  useLocalWallAudio(hub, show, scene, sound)
  const audio = showAudio(show)
  const videoVolume = sound && !audio.muted ? audio.volume : 0

  const wake = useCallback(() => {
    setBar(true)
    if (idle.current) clearTimeout(idle.current)
    idle.current = setTimeout(() => setBar(false), IDLE_MS)
  }, [])
  useEffect(() => {
    wake()
    const onFull = () => setFull(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFull)
    return () => {
      document.removeEventListener('fullscreenchange', onFull)
      if (idle.current) clearTimeout(idle.current)
    }
  }, [wake])
  useEffect(() => {
    document.title = scene ? `${scene.name} · viewer` : 'viewer'
  }, [scene])

  const size = setup ? sceneSize(setup.output) : { width: 1920, height: 1080 }
  const mode = previewing ? 'objects' : scene?.mode ?? 'static'
  const onAir = show?.onAir !== false
  const toggleFull = () => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void document.documentElement.requestFullscreen?.().catch(() => {})
  }
  const toggleSound = () => {
    if (!sound) void unlockAudio()
    setSound((v) => !v)
  }

  return (
    <main className={s.view} onPointerMove={wake} onPointerDown={wake} data-idle={!bar} data-testid="viewer">
      <div className={s.stage}>
        <div className={s.frame} style={{ aspectRatio: `${size.width} / ${size.height}`, ['--ar' as string]: String(size.width / size.height) }}>
          <LivePreview hub={hub} maxWidth={2560} fps={60} videoVolume={videoVolume} className={s.preview} data-testid="viewer-preview" />
        </div>
      </div>
      {status !== 'open' && <div className={s.status}>{status === 'connecting' ? 'connecting to the server…' : 'not connected. it retries on its own.'}</div>}
      <div className={s.bar} data-visible={bar} onPointerEnter={() => setBar(true)} data-testid="viewer-bar">
        <span className={s.name}>
          <OnAirDot off={!onAir} />
          <span data-testid="viewer-scene">{scene?.name ?? 'no scene on the wall'}</span>
        </span>
        <span className={s.mode} data-testid="viewer-mode">
          {onAir ? MODE_LABEL[mode] ?? mode : 'blackout'}
        </span>
        <span className={s.sp} />
        <button type="button" className={s.btn} onClick={toggleSound} aria-pressed={sound} title={sound ? 'stop playing sound here' : 'play the video and timeline sound here'}>
          <Icon name={sound ? 'speaker' : 'speakerOff'} size={15} />
          {sound ? 'sound on' : 'sound off'}
        </button>
        <button type="button" className={s.btn} onClick={toggleFull} title={full ? 'leave fullscreen' : 'fill the screen'}>
          <Icon name={full ? 'fullscreenExit' : 'fullscreen'} size={15} />
          {full ? 'exit fullscreen' : 'fullscreen'}
        </button>
        <button type="button" className={s.btn} onClick={() => window.close()} title="close the viewer">
          <Icon name="close" size={15} />
          close
        </button>
      </div>
    </main>
  )
}
