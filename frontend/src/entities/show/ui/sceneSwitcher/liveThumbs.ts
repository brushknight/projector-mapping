import { useEffect, useRef } from 'react'
import { Renderer, type RenderInput } from '../../../../render'

/**
 * Live thumbnails (item 2, §15): small animated pictures of scenes, drawn by the real engine at the wall's clock. One
 * WebGL renderer serves every thumbnail on the page: each tick it renders the visible ones in turn and copies each
 * frame into its own 2D canvas. Thumbnails off screen are skipped, so a long list costs nothing.
 */
interface Sub {
  canvas: HTMLCanvasElement
  input: () => RenderInput | null
  visible: boolean
  fps: number
  last: number
}

const subs = new Set<Sub>()
let gl: { canvas: HTMLCanvasElement; r: Renderer } | null = null
let raf = 0
let idle: ReturnType<typeof setTimeout> | null = null

function tick(now: number) {
  raf = requestAnimationFrame(tick)
  for (const s of subs) {
    if (!s.visible || now - s.last < 1000 / s.fps) continue
    const input = s.input()
    if (!input) continue
    s.last = now
    try {
      if (!gl) {
        const canvas = document.createElement('canvas')
        gl = { canvas, r: new Renderer(canvas, { space: 'scene', preserveDrawingBuffer: true, maxSceneSize: 640 }) }
      }
      const w = s.canvas.width, h = s.canvas.height
      gl.r.setSize(w, h)
      gl.r.render(input)
      const ctx = s.canvas.getContext('2d')
      ctx?.drawImage(gl.canvas, 0, 0, w, h)
    } catch {
      /* no WebGL: the thumbnail stays as it is */
    }
  }
}

function start() {
  if (idle) {
    clearTimeout(idle)
    idle = null
  }
  if (!raf) raf = requestAnimationFrame(tick)
}

function stopSoon() {
  if (subs.size) return
  if (raf) cancelAnimationFrame(raf)
  raf = 0
  // keep the context a while: lists remount when menus open and close
  idle = setTimeout(() => {
    gl?.r.dispose(true)
    gl = null
  }, 5000)
}

/**
 * Draws `input()` into the canvas `fps` times a second while it is on screen. The canvas keeps its own size (set its
 * width and height attributes).
 */
export function useLiveThumb(canvas: React.RefObject<HTMLCanvasElement>, input: () => RenderInput | null, fps = 8) {
  const latest = useRef(input)
  latest.current = input
  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const sub: Sub = { canvas: el, input: () => latest.current(), visible: true, fps, last: 0 }
    subs.add(sub)
    start()
    const io = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver((es) => (sub.visible = es.some((e) => e.isIntersecting))) : null
    io?.observe(el)
    return () => {
      io?.disconnect()
      subs.delete(sub)
      stopSoon()
    }
  }, [canvas, fps])
}
