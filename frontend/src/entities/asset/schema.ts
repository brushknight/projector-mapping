import { lit, nullable, num, obj, str } from '../../shared/lib/guard'

export const assetShape = obj({ sha: str, mime: str, width: num, height: num, bytes: num, kind: lit('photo', 'reference', 'snapshot', 'calibration', 'thumb'), thumb: nullable(str) })
