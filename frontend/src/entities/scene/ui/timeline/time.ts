/** mm:ss.cc */
export function formatTime(t: number): string {
  const v = Math.max(0, t)
  const m = Math.floor(v / 60)
  const sec = v - m * 60
  return `${String(m).padStart(2, '0')}:${sec.toFixed(2).padStart(5, '0')}`
}
