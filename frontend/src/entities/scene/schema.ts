import { any, arr, bool, int, lit, nullable, num, obj, oneOf, optional, record, str, tuple } from '../../shared/lib/guard'

export const lightShape = obj({
  intensity: num, softness: num, angle: num, scale: num, offsetX: num, offsetY: num,
  color: obj({ mode: lit('cct', 'hsi'), kelvin: num, tint: num, hue: num, sat: num }),
  fx: obj({ kind: lit('none', 'candle', 'fire', 'lightning', 'paparazzi', 'tv', 'breathe', 'strobe', 'police'), speed: num }),
})
export const layerShape = obj({
  id: str, kind: lit('gobo', 'procedural', 'gradient', 'photo', 'solid'), ref: str, name: str, visible: bool,
  opacity: num, blend: lit('normal', 'multiply', 'screen', 'add'), light: nullable(lightShape), params: record(any),
})
export const stackShape = obj({ layers: arr(layerShape) })
export const backdropShape = obj({ static: stackShape, live: stackShape, color: stackShape, scenery: stackShape })
export const sceneModeShape = lit('static', 'live', 'color', 'scenery', 'objects')
export const underlayShape = obj({ on: bool, from: lit('static', 'live', 'color', 'scenery'), level: num })
export const strokeShape = obj({
  tool: lit('pen', 'line', 'rect', 'ellipse', 'text'), points: arr(tuple(num, num)), color: str, width: num,
  fill: optional(bool), text: optional(str), size: optional(num),
})
export const pointShape = obj({ id: str, x: num, y: num })
export const meshShape = obj({ cols: int, rows: int, bezier: bool, offsets: arr(tuple(num, num)) })
export const effectInstanceShape = obj({ id: str, effect: str, enabled: bool, params: record(any) })
export const surfaceShape = obj({
  id: str, name: str, kind: lit('quad', 'tri', 'poly', 'circle', 'line', 'mask'), role: lit('face', 'edge', 'detail'),
  pointIds: arr(str), parentId: nullable(str), visible: bool, mesh: nullable(meshShape), effects: arr(effectInstanceShape),
  opacity: num, softEdge: num,
})
export const objectShape = obj({ id: str, name: str, tags: arr(str), visible: bool, surfaces: arr(surfaceShape) })
export const trackShape = obj({
  id: str, name: str,
  target: oneOf(obj({ kind: lit('surface', 'object'), id: str }), obj({ kind: lit('all'), id: lit(null) })),
})
export const clipShape = obj({ id: str, trackId: str, effect: str, start: num, end: num, fadeIn: num, fadeOut: num, params: record(any) })
export const cueShape = obj({ id: str, at: num, label: str, autoFollow: bool })
export const timelineShape = obj({ duration: num, tracks: arr(trackShape), clips: arr(clipShape), cues: arr(cueShape) })
export const sceneShape = obj({
  id: str, setupId: str, name: str, version: int, mode: sceneModeShape, backdrop: backdropShape, underlay: optional(underlayShape), points: arr(pointShape), objects: arr(objectShape),
  timeline: timelineShape,
})
export const patchOpShape = oneOf(
  obj({ op: lit('add', 'replace', 'test'), path: str, value: any }),
  obj({ op: lit('remove'), path: str }),
  obj({ op: lit('move', 'copy'), from: str, path: str }),
)
