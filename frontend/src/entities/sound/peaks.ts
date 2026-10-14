/** (§14) The largest absolute sample per equal slice of the file, over every channel, rounded to 3 places. */
export function computePeaks(channels: ArrayLike<number>[], n = 128): number[] {
  const len = channels[0]?.length ?? 0
  if (!len) return []
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const a = Math.floor((i * len) / n)
    const b = Math.max(a + 1, Math.floor(((i + 1) * len) / n))
    let m = 0
    for (const ch of channels) for (let k = a; k < b && k < len; k++) m = Math.max(m, Math.abs(ch[k]))
    out.push(Math.round(Math.min(1, m) * 1000) / 1000)
  }
  return out
}

/** Accepted sound files (§14): WAV, MP3, M4A, AIFF, OGG. */
export const SOUND_ACCEPT = '.wav,.mp3,.m4a,.aif,.aiff,.ogg,.oga,.opus,audio/wav,audio/x-wav,audio/mpeg,audio/mp4,audio/x-m4a,audio/aiff,audio/x-aiff,audio/ogg'
export const isSoundFile = (f: { name: string }) => /\.(wav|mp3|m4a|aif|aiff|ogg|oga|opus)$/i.test(f.name)

/** A file name without its extension, as a library name. */
export const baseName = (name: string) => name.replace(/\.[^.]+$/, '').slice(0, 80) || 'sound'

/**
 * Decodes a sound file in the browser (Web Audio) for its duration and 128 peaks, so the server can keep them when it
 * cannot read the file itself. Resolves null when the browser can't decode it (the upload still goes ahead).
 */
export async function decodeSound(file: Blob): Promise<{ duration: number; peaks: number[] } | null> {
  const Ctx = (globalThis as unknown as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext
  if (!Ctx) return null
  try {
    const ctx = new Ctx(1, 1, 44100)
    const buf = await ctx.decodeAudioData(await file.arrayBuffer())
    const chans = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i))
    return { duration: Math.round(buf.duration * 1000) / 1000, peaks: computePeaks(chans, 128) }
  } catch {
    return null
  }
}
