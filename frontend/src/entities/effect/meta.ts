/** Library icons for effects (by id; user effects get the code icon). */
const ICONS: Record<string, string> = {
  'grid-build': 'mesh',
  trace: 'line',
  scan: 'scan',
  glitch: 'sparkle',
  fill: 'quad',
  particles: 'particles',
  label: 'flag',
  pulse: 'pulse',
  highlight: 'highlight',
  spin: 'spin',
  converge: 'converge',
}

export function effectIcon(id: string, kind?: string): string {
  return ICONS[id] ?? (kind === 'glsl' || kind === 'js' ? 'code' : 'sparkle')
}
