/**
 * (§16) The static gallery: trying an attachment or a background layer before it goes on air, and the small scenes its
 * tiles draw. The static stack reads bottom to top: background layers (colour, gradient, animated colour, effects)
 * colour the light, attachments block it on top. Pure: a trial is a local copy of the scene, never a patch.
 */
import type { Attachment, Layer, Scene } from '../scene/types'
import { defaultStackLight, newAttachment, newLayer, stackLightOf } from './layers'
import type { Catalog } from './types'

/** the id a trial layer or attachment carries (never sent to the server) */
export const STATIC_TRY_ID = 'try_static'

/** The background layer kinds the static stack takes (§16). */
export const BACKGROUND_KINDS = ['solid', 'gradient', 'generator', 'procedural'] as const
export type BackgroundKind = (typeof BACKGROUND_KINDS)[number]

/** One tile of the background gallery. */
export interface BackgroundItem {
  kind: BackgroundKind
  ref: string
  name: string
  /** the gallery group: colour, gradient, animated or effect */
  group: 'colour' | 'gradient' | 'animated' | 'effect'
  /** a solid's colour */
  color?: string
}

/** What is being tried in the static hero: a plate in front of the light, or a background layer under it. */
export type StaticTry = { kind: 'attachment'; gobo: string } | { kind: 'background'; item: BackgroundItem }

/** A few solid colours for the background (the light's own colour stays the default background). */
export const SOLIDS: Array<{ ref: string; name: string; color: string }> = [
  { ref: 'amber', name: 'amber', color: '#ffb347' },
  { ref: 'rose', name: 'rose', color: '#ff6f91' },
  { ref: 'teal', name: 'teal', color: '#2ec4b6' },
  { ref: 'night', name: 'night blue', color: '#2b3a8c' },
]

/** procedural categories that make sense as a background effect (the shadows belong to live) */
const EFFECT_CATEGORIES = new Set(['texture', 'light'])

/** Every background the static gallery offers: solids, gradients, animated colours and effects. */
export function backgroundItems(catalog: Catalog | null): BackgroundItem[] {
  return [
    ...SOLIDS.map((s): BackgroundItem => ({ kind: 'solid', ref: 'solid', name: s.name, group: 'colour', color: s.color })),
    ...(catalog?.gradients ?? []).map((g): BackgroundItem => ({ kind: 'gradient', ref: g.id, name: g.name, group: 'gradient' })),
    ...(catalog?.colorGenerators ?? []).map((g): BackgroundItem => ({ kind: 'generator', ref: g.id, name: g.name, group: 'animated' })),
    ...(catalog?.procedural ?? []).filter((p) => EFFECT_CATEGORIES.has(p.category ?? '')).map((p): BackgroundItem => ({ kind: 'procedural', ref: p.id, name: p.name, group: 'effect' })),
  ]
}

/** A stable key for a background item (solids share their ref, so the colour tells them apart). */
export const backgroundKey = (it: BackgroundItem) => `${it.kind}:${it.ref}${it.color ? `:${it.color}` : ''}`

/** The background layer of an item, with its catalog defaults (normal blend: it is the light's colour). */
export function backgroundLayer(catalog: Catalog | null, item: BackgroundItem, id: string): Layer {
  const l = newLayer(catalog, item.kind, item.ref, id)
  const params = item.kind === 'solid' ? { ...l.params, color: item.color ?? '#ffffff' } : l.params
  return { ...l, name: item.name, blend: 'normal', params }
}

/**
 * The scene with a trial on its static stack, in static mode. An attachment trial replaces the attachments and keeps
 * the place of the first one (as a pick does); a background trial goes on top of the background layers. The light,
 * its focus rings and lens, is kept. The scene itself is not touched.
 */
export function withStaticTrial(scene: Scene, catalog: Catalog | null, t: StaticTry): Scene {
  const st = scene.backdrop.static
  const light = st.light ? stackLightOf(st.light, catalog) : defaultStackLight(catalog)
  if (t.kind === 'attachment') {
    if (!catalog?.gobos.some((g) => g.id === t.gobo)) return scene
    const old = st.attachments?.[0]
    const fresh = newAttachment(catalog, t.gobo, STATIC_TRY_ID)
    const att: Attachment = old ? { ...fresh, rotation: old.rotation, scale: old.scale, offsetX: old.offsetX, offsetY: old.offsetY, opacity: old.opacity, motion: old.motion ?? null } : fresh
    return { ...scene, mode: 'static', backdrop: { ...scene.backdrop, static: { ...st, light, attachments: [att] } } }
  }
  const layer = backgroundLayer(catalog, t.item, STATIC_TRY_ID)
  return { ...scene, mode: 'static', backdrop: { ...scene.backdrop, static: { ...st, light, layers: [...st.layers.filter((l) => l.id !== STATIC_TRY_ID), layer], attachments: st.attachments ?? [] } } }
}

/** The scene a background tile draws: that background under a warm light, no attachments, slightly soft. */
export function backgroundScene(catalog: Catalog | null, item: BackgroundItem): Scene {
  const base = {
    id: `bg-${backgroundKey(item)}`, setupId: 'gallery', name: item.name, version: 1, mode: 'static', kind: 'static',
    backdrop: { static: { layers: [], light: defaultStackLight(catalog, { color: { mode: 'cct', kelvin: 3200, tint: 0, hue: 212, sat: 0.7 } }), attachments: [] }, live: { layers: [], light: null, attachments: [] }, color: { layers: [] }, scenery: { layers: [] } },
    points: [], objects: [], timeline: { duration: 1, tracks: [], clips: [], cues: [] },
  } as unknown as Scene
  return withStaticTrial(base, catalog, { kind: 'background', item })
}

/** The label a trial shows in the hero. */
export function staticTryName(catalog: Catalog | null, t: StaticTry): string {
  return t.kind === 'attachment' ? catalog?.gobos.find((g) => g.id === t.gobo)?.name ?? t.gobo : t.item.name
}
