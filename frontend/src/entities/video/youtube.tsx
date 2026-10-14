import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { youtubeEmbedUrl, youtubeLook, type YouTubeActive } from '../../render/youtube'
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
}

/**
 * (§14) The embedded YouTube player of a `youtube:` video layer, placed BEHIND a transparent WebGL canvas (Renderer
 * option `transparent`). It fills its positioned parent: put it first, then the canvas on top. Sized to cover the
 * frame (a 16:9 player scaled up), turned and flipped like the output, with the layer's blur, brightness, warmth tint
 * and opacity as CSS; master, blackout and the underlay level dim it through the canvas. Never takes pointer events.
 * Test hook: `data-testid="youtube-backdrop"` (with `data-video-id`).
 */
export function YouTubeBackdrop({ active, scene, output }: YouTubeBackdropProps) {
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
  const src = useMemo(() => (active ? youtubeEmbedUrl(active.videoId, active.start, active.end) : null), [active?.videoId, active?.start, active?.end])
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
