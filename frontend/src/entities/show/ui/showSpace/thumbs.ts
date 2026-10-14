import { useEffect, useState } from 'react'
import { Renderer } from '../../../../render'
import { newLayer, type Catalog } from '../../../catalog'
import type { LayerKind, Scene } from '../../../scene/types'
import type { Setup } from '../../../setup/types'

/**
 * Small pictures of gobos and live layers for the Show tiles, drawn once by the real engine on an offscreen canvas
 * (a warm light on black, like the phone's tiles) and kept for the session.
 */
const cache = new Map<string, string>()
let queue: Promise<void> = Promise.resolve()

const SETUP: Setup = {
  id: 'thumb', name: 'thumb', output: { width: 320, height: 320, orientation: 'landscape', flipH: false, flipV: false },
  master: 1, blackoutFadeMs: 0, testPattern: 'off', testPatternUntil: null, referenceAsset: null, calibrationId: null,
} as Setup

let shared: { canvas: HTMLCanvasElement; r: Renderer } | null = null
let idle: ReturnType<typeof setTimeout> | null = null

function draw(catalog: Catalog, kind: LayerKind, ref: string): string | null {
  try {
    if (!shared) {
      const canvas = document.createElement('canvas')
      canvas.width = 160
      canvas.height = 160
      shared = { canvas, r: new Renderer(canvas, { space: 'scene', preserveDrawingBuffer: true, maxSceneSize: 320 }) }
      shared.r.setSize(160, 160)
    }
    const { canvas, r } = shared
    const layer = newLayer(catalog, kind, ref, 'lay_thumb')
    if (layer.light) layer.light = { ...layer.light, intensity: 0.9, softness: 0.25, scale: kind === 'gobo' ? 1.15 : 1 }
    const layers = kind === 'procedural' && layer.blend === 'multiply' ? [{ ...newLayer(catalog, 'gobo', 'spot', 'lay_base'), light: { ...newLayer(catalog, 'gobo', 'spot', 'x').light!, scale: 3, softness: 0.6 } }, layer] : [layer]
    const scene = {
      id: 'thumb', setupId: 'thumb', name: 'thumb', version: 1, mode: 'live',
      backdrop: { static: { layers: [] }, live: { layers }, color: { layers: [] }, scenery: { layers: [] } },
      points: [], objects: [], timeline: { duration: 1, tracks: [], clips: [], cues: [] },
    } as unknown as Scene
    r.render({ setup: SETUP, scene, catalog, t: 0, clock: 7.5, blackout: 0 })
    return canvas.toDataURL('image/png')
  } catch {
    return null
  } finally {
    // one GL context for every thumbnail, let go a while after the last one
    if (idle) clearTimeout(idle)
    idle = setTimeout(() => {
      shared?.r.dispose(true)
      shared = null
    }, 4000)
  }
}

/** The thumbnail URL of a gobo or procedural layer, or undefined until it is drawn. */
export function useLayerThumb(catalog: Catalog | null, kind: LayerKind, ref: string): string | undefined {
  const key = `${kind}:${ref}`
  const [url, setUrl] = useState(() => cache.get(key))
  useEffect(() => {
    if (!catalog || cache.has(key)) {
      setUrl(cache.get(key))
      return
    }
    let alive = true
    queue = queue.then(
      () =>
        new Promise<void>((res) => {
          setTimeout(() => {
            if (!cache.has(key)) {
              const u = draw(catalog, kind, ref)
              if (u) cache.set(key, u)
            }
            if (alive) setUrl(cache.get(key))
            res()
          }, 0)
        }),
    )
    return () => {
      alive = false
    }
  }, [catalog, key, kind, ref])
  return url
}
