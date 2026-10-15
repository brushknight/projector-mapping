import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { youtubeCommand, youtubeEmbedUrl, youtubeLook, type YouTubeActive } from '../../render/youtube'
import type { SetupOutput } from '../setup/types'
import s from './youtube.module.css'

export interface YouTubeBackdropProps {
  /** the YouTube layer that shows (render/youtube.ts activeYouTube), or null for nothing */
  active: YouTubeActive | null
  /** the authored scene size (its aspect) */
  scene: { width: number; height: number }
  /**
   * physical output (/out): the frame turns and flips with the setup like the canvas does. Omit for scene-space views
   * (previews), which show the authored frame as is.
   */
  output?: Pick<SetupOutput, 'orientation' | 'flipH' | 'flipV'> | null
  /**
   * (§16) the player's volume 0..100 (render/youtube.ts youtubeVolume): above 0 the page is the audio output client
   * and the layer's sound is on, so the player is unmuted over the IFrame Player API. Absent or 0 keeps it muted.
   * Pass a number (even 0) on a page that can play sound, so its player loads with the API from the start.
   */
  volume?: number
  /** (§16) reports whether the browser blocked the unmuted player (no user gesture yet); retried when `retry` changes */
  onSoundBlocked?: (blocked: boolean) => void
  /** bump it after a click to try unmuting again */
  retry?: number
}

/**
 * (§14) The embedded YouTube player of a `youtube:` video layer, placed BEHIND a transparent WebGL canvas (Renderer
 * option `transparent`). It fills its positioned parent: put it first, then the canvas on top. Sized to cover the
 * frame (a 16:9 player scaled up), turned and flipped like the output, with the layer's blur, brightness, warmth tint
 * and opacity as CSS; master, blackout and the underlay level dim it through the canvas. Never takes pointer events.
 * Test hook: `data-testid="youtube-backdrop"` (with `data-video-id`).
 */
export function YouTubeBackdrop({ active, scene, output, volume, onSoundBlocked, retry = 0 }: YouTubeBackdropProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setBox({ width: el.clientWidth, height: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [!!active])
  const api = volume !== undefined
  const src = useMemo(
    () => (active ? youtubeEmbedUrl(active.videoId, active.start, active.end, api ? { origin: window.location.origin } : null) : null),
    [active?.videoId, active?.start, active?.end, api],
  )
  const frame = useRef<HTMLIFrameElement>(null)
  const sound = usePlayerSound(frame, api ? src : null, volume ?? 0, retry, onSoundBlocked)
  if (!active || !src) return null

  const portrait = !!output && output.orientation !== 'landscape'
  // the frame in the parent's pixels: a portrait output shows the scene turned by 90°
  const fw = portrait ? box.height : box.width
  const fh = portrait ? box.width : box.height
  const look = youtubeLook(active, Math.min(fw, fh) || Math.min(scene.width, scene.height))
  // cover the frame with a 16:9 player, plus a margin so the blur does not fade the edges
  const margin = look.blurPx * 3
  const wide = fw / Math.max(1, fh) > 16 / 9
  const pw = (wide ? fw : (fh * 16) / 9) + margin * 2
  const ph = (wide ? (fw * 9) / 16 : fh) + margin * 2
  const deg = !output || output.orientation === 'landscape' ? 0 : output.orientation === 'portrait-cw' ? 90 : -90
  const flip = `scale(${output?.flipH ? -1 : 1}, ${output?.flipV ? -1 : 1})`
  const tinted = look.tint.some((c) => c < 255)
  return (
    <div ref={ref} className={s.wrap} style={{ opacity: active.opacity }} data-testid="youtube-backdrop" data-video-id={active.videoId} aria-hidden="true">
      <div className={s.frame} style={{ width: fw, height: fh, transform: `translate(-50%, -50%) ${flip} rotate(${deg}deg)` }}>
        <iframe
          ref={frame}
          onLoad={sound.onLoad}
          data-volume={volume ?? 0}
          className={s.player}
          src={src}
          title="YouTube backdrop"
          allow="autoplay; encrypted-media; picture-in-picture"
          referrerPolicy="strict-origin-when-cross-origin"
          tabIndex={-1}
          style={{ width: pw, height: ph, filter: `blur(${look.blurPx}px) brightness(${look.brightness})` }}
        />
        {tinted && <div className={s.tint} style={{ backgroundColor: `rgb(${look.tint.join(', ')})` }} />}
      </div>
    </div>
  )
}

type PlayerInfo = { playerState?: number; muted?: boolean; volume?: number }

/**
 * (§16) Drives the player's sound over the IFrame Player API (postMessage, no script tag): it listens for the
 * player's `onReady` and `infoDelivery` events, then sends `unMute` + `setVolume` + `playVideo` while `volume` > 0 and
 * `mute` otherwise, again whenever the volume or `retry` changes. When the browser pauses the unmuted player (autoplay
 * with sound needs a user gesture), it mutes and plays it again and reports blocked, so the page can ask for a click.
 */
function usePlayerSound(frame: RefObject<HTMLIFrameElement | null>, src: string | null, volume: number, retry: number, onBlocked?: (b: boolean) => void) {
  const [ready, setReady] = useState(false)
  const info = useRef<PlayerInfo>({})
  const blockedCb = useRef(onBlocked)
  blockedCb.current = onBlocked
  const post = (msg: string) => frame.current?.contentWindow?.postMessage(msg, 'https://www.youtube-nocookie.com')

  // a new video: wait for its player again
  useEffect(() => {
    setReady(false)
    info.current = {}
  }, [src])

  useEffect(() => {
    if (!src) return
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || typeof e.data !== 'string') return
      let m: { event?: string; info?: PlayerInfo }
      try {
        m = JSON.parse(e.data)
      } catch {
        return
      }
      if (m.event === 'onReady' || m.event === 'initialDelivery') setReady(true)
      if (m.info && typeof m.info === 'object') {
        info.current = { ...info.current, ...m.info }
        setReady(true)
      }
    }
    window.addEventListener('message', onMessage)
    // the player only talks after it hears "listening"; say it until it answers
    const hello = setInterval(() => post(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' })), 500)
    return () => {
      window.removeEventListener('message', onMessage)
      clearInterval(hello)
    }
  }, [src])

  useEffect(() => {
    if (!src || !ready) return
    if (volume <= 0) {
      post(youtubeCommand('mute'))
      blockedCb.current?.(false)
      return
    }
    post(youtubeCommand('unMute'))
    post(youtubeCommand('setVolume', [volume]))
    post(youtubeCommand('playVideo'))
    // a browser that wants a gesture first pauses the unmuted player (state 2) or keeps it muted
    const check = setTimeout(() => {
      const i = info.current
      const blocked = i.playerState === 2 || i.muted === true
      if (blocked) {
        post(youtubeCommand('mute'))
        post(youtubeCommand('playVideo'))
      }
      blockedCb.current?.(blocked)
    }, 1500)
    return () => clearTimeout(check)
  }, [src, ready, volume, retry])

  return {
    onLoad: () => {
      if (src) post(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }))
    },
  }
}
