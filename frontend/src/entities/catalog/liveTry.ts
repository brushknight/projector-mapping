/**
 * (§16) The live gallery: trying a live layer before it goes on air, and the small scenes the gallery tiles, the
 * phone's anim strips and `/preview?try=<id>` draw. Pure: a trial is a local copy of the scene, never a patch.
 */
import type { Layer, Scene } from '../scene/types'
import { defaultStackLight, newLayer } from './layers'
import type { Catalog } from './types'

/** the id a trial layer carries (never sent to the server) */
export const TRY_LAYER_ID = 'lay_try'

/** A procedural id from a `try` query param, or null when it is missing or malformed. */
export function parseTry(v: unknown): string | null {
  return typeof v === 'string' && /^[a-z0-9][a-z0-9-]{0,47}$/.test(v) ? v : null
}

/** The trial layer of a procedural item (catalog defaults and blend), or null for an unknown id. */
export function trialLayer(catalog: Catalog | null, ref: string, id = TRY_LAYER_ID): Layer | null {
  if (!catalog?.procedural.some((p) => p.id === ref)) return null
  return newLayer(catalog, 'procedural', ref, id)
}

/**
 * The scene with a trial layer on top of its live stack, in live mode, with the default stack light when the live
 * stack has none (a mask needs light to block). The scene itself is not touched.
 */
export function withTrialLayer(scene: Scene, catalog: Catalog | null, ref: string): Scene {
  const layer = trialLayer(catalog, ref)
  if (!layer) return scene
  const live = scene.backdrop.live
  const needsLight = layer.blend === 'multiply' && !live.light
  return {
    ...scene,
    mode: 'live',
    backdrop: {
      ...scene.backdrop,
      live: { ...live, layers: [...live.layers.filter((l) => l.id !== TRY_LAYER_ID), layer], light: needsLight ? defaultStackLight(catalog, { color: { mode: 'cct', kelvin: 3200, tint: 0, hue: 212, sat: 0.7 } }) : live.light, attachments: live.attachments ?? [] },
    },
  }
}

/**
 * The scene a gallery tile (and an anim strip) shows: one live layer. A shadow (multiply) blocks a warm 3200 K light
 * that fills the frame; a light effect (day cycle, sun drift, candle, lightning) draws its own light over black.
 */
export function galleryScene(catalog: Catalog | null, ref: string): Scene {
  const base = {
    id: `gallery-${ref}`, setupId: 'gallery', name: ref, version: 1, mode: 'live', kind: 'live',
    backdrop: { static: { layers: [] }, live: { layers: [], light: null, attachments: [] }, color: { layers: [] }, scenery: { layers: [] } },
    points: [], objects: [], timeline: { duration: 1, tracks: [], clips: [], cues: [] },
  } as unknown as Scene
  const s = withTrialLayer(base, catalog, ref)
  const light = s.backdrop.live.light
  if (light) s.backdrop.live.light = { ...light, color: { ...light.color, kelvin: 3200 }, focus: 0.75, vignette: 0.35 }
  return s
}

/**
 * The procedural items for the gallery, shadows first (they block the light like attachments), then the light
 * effects, each group in catalog order.
 */
export function galleryItems(catalog: Catalog | null) {
  const items = catalog?.procedural ?? []
  const mask = (id: string) => (trialLayer(catalog, id)?.blend ?? 'normal') === 'multiply'
  return [...items.filter((p) => mask(p.id)), ...items.filter((p) => !mask(p.id))]
}
