/**
 * YouTube video layers (protocol §14): the engine draws nothing for a `youtube:<id>` layer; the page places an
 * embedded player behind the canvas. Pure helpers shared by the engine (when to clear transparent) and the pages.
 */
import { onAirPlan, allLayers } from '../entities/scene/lib'
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
      brightness: Math.max(0, Math.min(1, num(p.brightness, 0.8))),
      warmth: Math.max(-1, Math.min(1, num(p.warmth, 0))),
      opacity: Math.max(0, Math.min(1, l.opacity)),
      level: Math.max(0, Math.min(1, level)),
    }
  }
  return null
}

/** The embed URL (§14): muted, looping, no controls, from `start`, to `end` when set. */
export function youtubeEmbedUrl(videoId: string, start = 0, end = 0): string {
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
  return `https://www.youtube-nocookie.com/embed/${videoId}?${q.toString()}`
}

/**
 * How the photo controls look in CSS for a frame `minSidePx` on its short side: the shader's brightness (× 1.4) and
 * warmth (per-channel gains) become a CSS brightness and a multiply tint, the blur radius a CSS blur. Master, blackout
 * and the underlay level dim the player through the canvas above it (its alpha), not here.
 */
export function youtubeLook(a: Pick<YouTubeActive, 'blur' | 'brightness' | 'warmth'>, minSidePx: number) {
  const gains = [1 + 0.22 * a.warmth, 1 + 0.04 * a.warmth, 1 - 0.22 * a.warmth]
  const top = Math.max(...gains)
  return {
    blurPx: Math.round(a.blur * 30 * (minSidePx / 1080) * 10) / 10,
    brightness: Math.round(a.brightness * 1.4 * top * 1000) / 1000,
    /** multiply tint 0..255 per channel (white = none) */
    tint: gains.map((g) => Math.round((g / top) * 255)) as [number, number, number],
  }
}
