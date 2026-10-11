/** Protocol §5: the phone's preview as JPEG frames on the `camera` channel. */
export interface CameraFrame {
  seq: number
  width: number
  height: number
  /** base64 JPEG */
  jpeg: string
}

export interface CameraStatus {
  streaming: boolean
  fps: number
  width: number
  height: number
  steady: boolean
  level: number
}

export const frameDataUrl = (f: CameraFrame) => `data:image/jpeg;base64,${f.jpeg}`

/** Decodes a frame's base64 into a JPEG blob, for uploading it as an asset. */
export function frameBlob(f: CameraFrame): Blob {
  const bin = atob(f.jpeg)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: 'image/jpeg' })
}
