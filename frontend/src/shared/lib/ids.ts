/**
 * Ids for sub-entities inside a scene document (points, surfaces, clips, cues…). The scene is edited by JSON Patch,
 * so an added element carries its id; the prefix matches the server's style. Not used for top-level entities.
 */
const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz'
export function newId(prefix: string): string {
  let s = ''
  const buf = new Uint8Array(8)
  crypto.getRandomValues(buf)
  for (const b of buf) s += alphabet[b % alphabet.length]
  return `${prefix}_${s}`
}
