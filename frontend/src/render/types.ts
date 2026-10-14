/**
 * The render engine's public contract. Everything the engine draws is a pure function of RenderInput: no clocks,
 * no Math.random, no network inside render(). Textures (photos, references) load asynchronously; `ready()` resolves
 * when everything an input needs has loaded, so offscreen renders (render.frame) are exact.
 */
import type { Catalog } from '../entities/catalog/types'
import type { EffectDef } from '../entities/effect/types'
import type { Scene, SceneMode } from '../entities/scene/types'
import type { Setup } from '../entities/setup/types'

/** protocol §3 output.pattern / §7 */
export type OutputPattern =
  | { kind: 'gray'; axis: 'x' | 'y'; bit: number; inverse: boolean }
  | { kind: 'white' | 'black' | 'off' }

export interface OutlineFlash {
  surfaceIds: string[]
  /** #rrggbb */
  color: string
  /** scene pixels */
  width: number
}

export interface RenderInput {
  setup: Setup
  scene: Scene | null
  catalog: Catalog | null
  /** user and agent effects (kind glsl | js), looked up by id; built-ins come from the engine */
  effects?: EffectDef[]
  /** timeline playhead, seconds (clips, effects' u_time) */
  t: number
  /** ambient clock, seconds (backdrop animation, light fx); keeps running while the transport is stopped */
  clock: number
  /** 0 = on air, 1 = black. The caller animates the fade over setup.blackoutFadeMs */
  blackout: number
  /** calibration override, drawn in physical framebuffer pixels over everything (physical space only) */
  pattern?: OutputPattern | null
  outline?: OutlineFlash | null
  /** draws this mode instead of scene.mode (the editor previews objects mode while mapping); protocol §1 Scene.mode */
  mode?: SceneMode | null
  /** render only this backdrop layer, from any stack (preview mode=layer); mapping is skipped */
  layerOnly?: string | null
  /** skip the mapped surfaces (backdrop only) */
  hideMapping?: boolean
  /** skip the backdrop (mapping only) */
  hideBackdrop?: boolean
  /** timeline tracks muted locally (editor eye toggles) */
  mutedTracks?: ReadonlySet<string>
  /** surfaces hidden locally */
  hiddenSurfaces?: ReadonlySet<string>
  /**
   * overrides setup.testPattern (editor "test grid" preview). Callers pass the pattern that is really on, so an
   * expired `testPatternUntil` draws nothing (entities/setup activeTestPattern).
   */
  testPattern?: Setup['testPattern'] | null
  /**
   * draws only these surfaces (protocol §12 show.solo); `others` is how bright everything else stays (0 = hidden,
   * the editor dims to 0.15). The backdrop is skipped while a solo is on.
   */
  solo?: { surfaceIds: string[]; fill: 'content' | 'white' | 'grid'; others?: number } | null
  /**
   * (§14) the gain for video layers' own sound (`params.audio`): volume × master on the audio output client, 0 or
   * absent = every video stays muted. The page passes it only once the browser allows sound.
   */
  videoVolume?: number | null
}

export interface RendererOptions {
  /**
   * physical: the canvas is the projector framebuffer; orientation, flips and calibration patterns apply (/out).
   * scene: the canvas shows the authored frame as is (editor stage, previews).
   */
  space: 'physical' | 'scene'
  /** keep the last frame readable (editor loupe, tests) */
  preserveDrawingBuffer?: boolean
  /** caps the scene framebuffer's longest side (previews render smaller); default: the setup's size */
  maxSceneSize?: number
  /** resolves asset URLs: scenery ids → /catalog/assets/…, asset:<sha> → /a/<sha> */
  resolveUrl?: (ref: string) => string
  /**
   * (§14) a canvas with alpha, for pages that place a YouTube player behind it (/out, /preview, live previews). The
   * frame stays opaque (alpha 1) unless a YouTube layer shows, so nothing else changes.
   */
  transparent?: boolean
}

export interface EffectError {
  effectId: string
  message: string
}
