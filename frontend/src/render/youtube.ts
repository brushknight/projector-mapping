/**
 * YouTube video layers (protocol §14): the engine draws nothing for a `youtube:<id>` layer; the page places an
 * embedded player behind the canvas. Pure helpers shared by the engine (when to clear transparent) and the pages.
 */
import { onAirPlan, allLayers } from '../entities/scene/lib'
import { photoGain } from './photoLook'
import type { Layer, Scene, SceneMode } from '../entities/scene/types'

/** The YouTube layer that shows: what the iframe plays and how it looks. */
export interface YouTubeActive {
  layerId: string
  videoId: string
  /** loop window in seconds (end 0 = to the end of the video) */
  start: number
  end: number
  /** the photo controls: blur 0..1, brightness 0..1, warmth −1..1 */
  blur: number
  brightness: number
  warmth: number
  opacity: number
  /** (§14, §16) the layer's own sound: `params.audio` (shown as "sound") and `params.volume` 0..1 */
  audio: boolean
  volume: number
  /** the underlay's brightness level in objects mode (1 in a backdrop mode); the canvas dims the player by it */
  level: number
}

const YT_ID = /^[A-Za-z0-9_-]{11}$/

/** `youtube:<id>` → the id (11 characters `[A-Za-z0-9_-]`), anything else → null. */
export function youtubeIdOfRef(ref: string): string | null {
  if (!ref.startsWith('youtube:')) return null
  const id = ref.slice(8)
  return YT_ID.test(id) ? id : null
}

export const isYouTubeLayer = (l: Pick<Layer, 'kind' | 'ref'>) => l.kind === 'video' && youtubeIdOfRef(l.ref) !== null

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)

/**
 * The YouTube layer the frame shows, or null: the lowest visible YouTube layer of the drawn stack (also as the
 * underlay in objects mode). Nothing while a solo is on or the backdrop is hidden.
 */
export function activeYouTube(
  scene: Scene | null | undefined,
  opts: { mode?: SceneMode | null; layerOnly?: string | null; solo?: { surfaceIds: string[] } | null; hideBackdrop?: boolean } = {},
): YouTubeActive | null {
  if (!scene || opts.hideBackdrop || (opts.solo && opts.solo.surfaceIds.length)) return null
  let layers: Layer[]
  let level = 1
  if (opts.layerOnly) layers = allLayers(scene).filter((l) => l.id === opts.layerOnly)
  else {
    const plan = onAirPlan(scene, opts.mode ?? scene.mode ?? 'static')
    layers = plan.layers
    level = plan.objects ? plan.level : 1
  }
  for (const l of layers) {
    if (!opts.layerOnly && !l.visible) continue
    if (l.opacity <= 0) continue
    const videoId = l.kind === 'video' ? youtubeIdOfRef(l.ref) : null
    if (!videoId) continue
    const p = (l.params ?? {}) as Record<string, unknown>
    return {
      layerId: l.id,
      videoId,
      start: Math.max(0, num(p.start, 0)),
      end: Math.max(0, num(p.end, 0)),
      blur: Math.max(0, Math.min(1, num(p.blur, 0.2))),
      brightness: Math.max(0, Math.min(1, num(p.brightness, 0.9))),
      warmth: Math.max(-1, Math.min(1, num(p.warmth, 0))),
      opacity: Math.max(0, Math.min(1, l.opacity)),
      audio: p.audio === true,
      volume: Math.max(0, Math.min(1, num(p.volume, 1))),
      level: Math.max(0, Math.min(1, level)),
    }
  }
  return null
}

/**
 * The embed URL (§14, §16): it always starts muted (muted autoplay is never blocked), looping, no controls, from
 * `start`, to `end` when set. With `api` (the page is the audio output client) it also enables the IFrame Player API
 * (`enablejsapi=1` and the page's `origin`), so the page can unmute it and set its volume over postMessage.
 */
export function youtubeEmbedUrl(videoId: string, start = 0, end = 0, api: { origin: string } | null = null): string {
  const q = new URLSearchParams({
    autoplay: '1',
    mute: '1',
    loop: '1',
    playlist: videoId,
    controls: '0',
    start: String(Math.floor(Math.max(0, start))),
  })
  if (end > start) q.set('end', String(Math.ceil(end)))
  for (const [k, v] of [['playsinline', '1'], ['modestbranding', '1'], ['rel', '0'], ['iv_load_policy', '3'], ['disablekb', '1']]) q.set(k, v)
  if (api) {
    q.set('enablejsapi', '1')
    q.set('origin', api.origin)
  }
  return `https://www.youtube-nocookie.com/embed/${videoId}?${q.toString()}`
}

/**
 * The YouTube player's volume 0..100 (§16): the layer's volume × the client's gain (show.audio volume × master on the
 * audio output client, 0 while muted, inactive or locked; the viewer's own toggle on /view). 0 keeps it muted: the
 * layer's sound is off, or this client plays no sound.
 */
export function youtubeVolume(a: Pick<YouTubeActive, 'audio' | 'volume'> | null, gain: number): number {
  if (!a || !a.audio || !(gain > 0)) return 0
  return Math.round(Math.max(0, Math.min(1, a.volume * gain)) * 100)
}

/** One IFrame Player API command, as the player expects it over postMessage. */
export function youtubeCommand(func: 'mute' | 'unMute' | 'setVolume' | 'playVideo', args: unknown[] = []): string {
  return JSON.stringify({ event: 'command', func, args, id: 1, channel: 'widget' })
}

/**
 * How the photo controls look in CSS for a frame `minSidePx` on its short side (§16): brightness 1 is the original
 * picture, warmth a multiply tint normalised so no channel goes above its original value (render/photoLook.ts, the
 * same math as the shader), the blur radius a CSS blur. Master, blackout and the underlay level dim the player
 * through the canvas above it (its alpha), not here.
 */
export function youtubeLook(a: Pick<YouTubeActive, 'blur' | 'brightness' | 'warmth'>, minSidePx: number) {
  const k = photoGain(1, a.warmth)
  return {
    blurPx: Math.round(a.blur * 30 * (minSidePx / 1080) * 10) / 10,
    brightness: Math.round(Math.max(0, Math.min(1, a.brightness)) * 1000) / 1000,
    /** multiply tint 0..255 per channel (white = none) */
    tint: k.map((g) => Math.round(g * 255)) as [number, number, number],
  }
}
