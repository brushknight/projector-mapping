import { any, arr, bool, int, lit, nullable, num, obj, oneOf, optional, record, str, tuple } from '../../shared/lib/guard'

export const lightShape = obj({
  intensity: num, softness: num, angle: num, scale: num, offsetX: num, offsetY: num,
  color: obj({ mode: lit('cct', 'hsi'), kelvin: num, tint: num, hue: num, sat: num }),
  fx: obj({ kind: lit('none', 'candle', 'fire', 'lightning', 'paparazzi', 'tv', 'breathe', 'strobe', 'police'), speed: num }),
})
const ptShape = obj({ x: num, y: num })
export const motionShape = obj({
  on: bool, preset: str, from: ptShape, via: nullable(ptShape), to: ptShape, duration: num,
  easing: lit('linear', 'in', 'out', 'inOut', 'sine'), loop: lit('once', 'loop', 'pingpong'),
  rotate: num, scaleFrom: num, scaleTo: num, kelvinFrom: num, kelvinTo: num, phase: num, startedAt: num,
})
export const layerShape = obj({
  id: str, kind: lit('gobo', 'procedural', 'gradient', 'photo', 'solid', 'video', 'generator'), ref: str, name: str, visible: bool,
  opacity: num, blend: lit('normal', 'multiply', 'screen', 'add'), light: nullable(lightShape), params: record(any), motion: nullable(motionShape),
})
export const stackLightShape = obj({
  intensity: num, focus: num,
  color: obj({ mode: lit('cct', 'hsi'), kelvin: num, tint: num, hue: num, sat: num }),
  fx: obj({ kind: lit('none', 'candle', 'fire', 'lightning', 'paparazzi', 'tv', 'breathe', 'strobe', 'police'), speed: num }),
  colorLayer: nullable(obj({ kind: lit('gradient', 'generator'), ref: str, params: record(any) })),
  fringe: num, vignette: num, haze: num, slide: ptShape, motion: nullable(motionShape),
})
export const attachmentShape = obj({
  id: str, gobo: str, name: str, visible: bool, opacity: num, rotation: num, offsetX: num, offsetY: num, scale: num, params: record(any), motion: nullable(motionShape),
})
export const stackShape = obj({ layers: arr(layerShape), light: nullable(stackLightShape), attachments: optional(arr(attachmentShape)) })
export const backdropShape = obj({ static: stackShape, live: stackShape, color: stackShape, scenery: stackShape })
export const sceneModeShape = lit('static', 'live', 'color', 'scenery', 'objects')
export const underlayShape = obj({ on: bool, from: lit('static', 'live', 'color', 'scenery'), level: num })
export const strokeShape = obj({
  tool: lit('pen', 'line', 'rect', 'ellipse', 'text', 'polygon', 'circle'), points: arr(tuple(num, num)), color: str, width: num,
  fill: optional(bool), text: optional(str), size: optional(num),
})
export const pointShape = obj({ id: str, x: num, y: num })
export const meshShape = obj({ cols: int, rows: int, bezier: bool, offsets: arr(tuple(num, num)) })
export const effectInstanceShape = obj({ id: str, name: optional(str), effect: str, enabled: bool, params: record(any) })
const stopShape = obj({ color: str, pos: num })
export const contentLayerShape = obj({
  id: str, kind: lit('media', 'gradient'), name: str, visible: bool, opacity: num, blend: lit('normal', 'multiply', 'screen', 'add'),
  x: num, y: num, scale: num, rotation: num, reveal: num, revealAngle: num,
  src: optional(str), media: optional(lit('image', 'video')), fit: optional(lit('fill', 'fit', 'stretch')), crop: optional(obj({ x: num, y: num, w: num, h: num })),
  stops: optional(arr(stopShape)), angle: optional(num), offset: optional(num), repeat: optional(bool),
})
export const atlasShape = obj({ width: num, height: num, faces: record(obj({ x: num, y: num, w: num, h: num, rotation: lit(0, 90, 180, 270) })) })
export const surfaceShape = obj({
  id: str, name: str, kind: lit('quad', 'tri', 'poly', 'circle', 'line', 'mask'), role: lit('face', 'edge', 'detail'),
  pointIds: arr(str), parentId: nullable(str), visible: bool, mesh: nullable(meshShape), effects: arr(effectInstanceShape),
  opacity: num, softEdge: num, layers: optional(arr(contentLayerShape)),
})
export const objectShape = obj({ id: str, name: str, tags: arr(str), visible: bool, surfaces: arr(surfaceShape), atlas: optional(atlasShape), layers: optional(arr(contentLayerShape)) })
export const trackShape = obj({
  id: str, name: str,
  target: oneOf(obj({ kind: lit('surface', 'object', 'layer'), id: str }), obj({ kind: lit('all', 'sound'), id: lit(null) })),
})
export const clipShape = obj({ id: str, trackId: str, effect: str, start: num, end: num, fadeIn: num, fadeOut: num, params: record(any) })
export const cueShape = obj({ id: str, at: num, label: str, autoFollow: bool, sound: optional(obj({ sound: str, volume: num })) })
export const padShape = obj({
  id: str, name: str, sound: str, volume: num, color: lit('ink', 'red', 'amber', 'green', 'teal', 'blue', 'violet', 'pink'),
  icon: optional(lit('none', 'bell', 'door', 'thunder', 'rain', 'wind', 'bird', 'music', 'voice', 'knock', 'spark', 'heart')), key: optional(str), loop: optional(bool),
})
export const soundsShape = obj({ pads: arr(padShape) })
export const timelineShape = obj({ duration: num, tracks: arr(trackShape), clips: arr(clipShape), cues: arr(cueShape) })
export const sceneShape = obj({
  id: str, setupId: str, name: str, version: int, mode: sceneModeShape, kind: optional(lit('static', 'live', 'color', 'scenery', 'mapping')), backdrop: backdropShape, underlay: optional(underlayShape), points: arr(pointShape), objects: arr(objectShape),
  sounds: optional(soundsShape), timeline: timelineShape,
})
export const sceneSummaryShape = obj({ id: str, name: str, setupId: str, version: int, kind: optional(lit('static', 'live', 'color', 'scenery', 'mapping')), mode: optional(sceneModeShape) })
export const patchOpShape = oneOf(
  obj({ op: lit('add', 'replace', 'test'), path: str, value: any }),
  obj({ op: lit('remove'), path: str }),
  obj({ op: lit('move', 'copy'), from: str, path: str }),
)
