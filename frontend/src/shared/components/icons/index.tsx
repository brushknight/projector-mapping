import { memo, type ReactNode } from 'react'

/** Line icons from the editor boards (24×24, stroke 1.75, round caps). */
const paths: Record<string, ReactNode> = {
  select: <path d="M5 3l14 7-6 2-2 6z" />,
  quad: <rect x="4" y="5" width="16" height="14" rx="1" />,
  tri: <path d="M12 4l9 16H3z" />,
  poly: <path d="M6 4h9l5 6-3 10H6l-3-8z" />,
  circle: <circle cx="12" cy="12" r="8" />,
  mesh: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="1" />
      <path d="M9.3 4v16M14.7 4v16M4 9.3h16M4 14.7h16" />
    </>
  ),
  line: (
    <>
      <path d="M4 20L20 4" />
      <circle cx="4" cy="20" r="1.6" fill="currentColor" />
      <circle cx="20" cy="4" r="1.6" fill="currentColor" />
    </>
  ),
  mask: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <circle cx="12" cy="12" r="4.5" fill="currentColor" />
    </>
  ),
  chevronDown: <path d="M6 9l6 6 6-6" />,
  chevronRight: <path d="M9 6l6 6-6 6" />,
  phone: (
    <>
      <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
      <path d="M11 18.5h2" />
    </>
  ),
  projector: (
    <>
      <rect x="2.5" y="7" width="19" height="10" rx="3" />
      <circle cx="16" cy="12" r="2.6" />
      <path d="M6 10.5h4M6 13.5h4M6 17v1.5M18 17v1.5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  folder: <path d="M3.5 7a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />,
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.8" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <path d="M4 20L20 4" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  link: <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />,
  more: (
    <>
      <circle cx="5" cy="12" r="1.3" fill="currentColor" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" />
      <circle cx="19" cy="12" r="1.3" fill="currentColor" />
    </>
  ),
  scan: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="M3 9h18M3 15h18M8 4v16" />
    </>
  ),
  sparkle: <path d="M12 3l1.8 5.4L19 10l-5.2 1.6L12 17l-1.8-5.4L5 10l5.2-1.6z" />,
  particles: (
    <>
      <circle cx="6" cy="6" r="1" fill="currentColor" />
      <circle cx="13" cy="5" r="1" fill="currentColor" />
      <circle cx="18" cy="9" r="1" fill="currentColor" />
      <circle cx="9" cy="11" r="1" fill="currentColor" />
      <circle cx="15" cy="14" r="1" fill="currentColor" />
      <circle cx="6" cy="17" r="1" fill="currentColor" />
      <circle cx="12" cy="19" r="1" fill="currentColor" />
      <circle cx="19" cy="18" r="1" fill="currentColor" />
    </>
  ),
  flag: <path d="M5 21V4h11l-2 4 2 4H5" />,
  pulse: <path d="M2.5 12h4l2.5-6 4 12 2.5-6h6" />,
  gobo: (
    <>
      <rect x="4" y="3.5" width="16" height="17" rx="2" />
      <path d="M12 3.5v17M4 12h16" />
    </>
  ),
  spin: (
    <>
      <circle cx="12" cy="12" r="8" strokeDasharray="3 3" />
      <path d="M12 4a8 8 0 0 1 8 8" />
    </>
  ),
  converge: (
    <>
      <circle cx="12" cy="12" r="9.5" strokeDasharray="2.4 2.6" />
      <path d="M12 7.2l4.2 2.4v4.8L12 16.8l-4.2-2.4V9.6z" />
      <path d="M12 12v4.8M12 12l4.2-2.4M12 12L7.8 9.6" />
    </>
  ),
  highlight: (
    <>
      <rect x="4" y="5" width="16" height="14" rx="1" />
      <rect x="7.5" y="8.5" width="9" height="7" rx="0.5" fill="currentColor" opacity=".35" />
    </>
  ),
  code: <path d="M8 7l-5 5 5 5M16 7l5 5-5 5M13.5 5l-3 14" />,
  toStart: (
    <>
      <path d="M6 5v14" />
      <path d="M18 5v14l-10-7z" fill="currentColor" />
    </>
  ),
  play: <path d="M7 4.5v15l12-7.5z" fill="currentColor" />,
  pause: <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" />,
  loop: (
    <>
      <path d="M17 3l3 3-3 3" />
      <path d="M4 11V9a3 3 0 0 1 3-3h13" />
      <path d="M7 21l-3-3 3-3" />
      <path d="M20 13v2a3 3 0 0 1-3 3H4" />
    </>
  ),
  next: <path d="M6 5l8 7-8 7zM17 5v14" />,
  prev: <path d="M18 5l-8 7 8 7zM7 5v14" />,
  send: <path d="M4 12l16-8-6 16-2.5-6.5z" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  camera: (
    <>
      <rect x="3" y="7" width="18" height="12.5" rx="2.5" />
      <circle cx="12" cy="13" r="3.2" />
      <path d="M9 7l1.2-2.5h3.6L15 7" />
    </>
  ),
  download: (
    <>
      <path d="M12 4v11M7.5 10.5L12 15l4.5-4.5" />
      <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </>
  ),
  solo: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
    </>
  ),
  edit: <path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" />,
  pip: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <rect x="12" y="11" width="7" height="6" rx="1" />
    </>
  ),
  upload: (
    <>
      <path d="M12 15V4M7.5 8.5L12 4l4.5 4.5" />
      <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </>
  ),
  video: (
    <>
      <rect x="3" y="6" width="13" height="12" rx="2.5" />
      <path d="M16 10.5l5-3v9l-5-3z" />
    </>
  ),
  fullscreen: <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />,
  fullscreenExit: <path d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5" />,
  viewer: (
    <>
      <rect x="3" y="5" width="18" height="12" rx="2" />
      <path d="M9 21h6M12 17v4" />
    </>
  ),
  motion: <path d="M3 17c4 0 5-10 9-10s5 10 9 10M17 4l4 3-4 3" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  target: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </>
  ),
  cube: (
    <>
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" />
      <path d="M4 7.5l8 4.5 8-4.5M12 12v9" />
    </>
  ),
  testGrid: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M4 12h16M12 4v16" />
    </>
  ),
  image: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M3.5 16l5-5 4 4 2.5-2.5 5 5" />
      <circle cx="15.5" cy="9" r="1.6" />
    </>
  ),
  magnet: (
    <>
      <path d="M6 4v8a6 6 0 0 0 12 0V4h-4v8a2 2 0 0 1-4 0V4z" />
      <path d="M6 8h4M14 8h4" />
    </>
  ),
  split: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M12 5v14" />
    </>
  ),
  trash: <path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10 11v6M14 11v6" />,
  undo: <path d="M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" />,
  redo: <path d="M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3" />,
  layers: <path d="M12 3l9 5-9 5-9-5zM3 13l9 5 9-5" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
    </>
  ),
  wave: <path d="M3 12c2.5-4 5.5-4 8 0s5.5 4 8 0" />,
  gradient: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="M4 15L15 4M9 20L20 9" />
    </>
  ),
  bolt: <path d="M13 3L5 13h6l-1 8 8-10h-6z" />,
  sparkles: <path d="M9 4l1.3 3.7L14 9l-3.7 1.3L9 14l-1.3-3.7L4 9l3.7-1.3zM17 13l.8 2.2L20 16l-2.2.8L17 19l-.8-2.2L14 16l2.2-.8z" />,
  history: (
    <>
      <path d="M4 12a8 8 0 1 0 2.3-5.6L4 8.7" />
      <path d="M4 4v4.7h4.7M12 8v4.5l3 2" />
    </>
  ),
  // ── show space: modes, sound and video (§14) ──
  modeStatic: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="M12 4v16M4 12h16" />
    </>
  ),
  modeLive: <path d="M3 8h9a2.5 2.5 0 1 0-2.5-2.5M3 12h14a3 3 0 1 1-3 3M3 16h6" />,
  modeColor: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" />
    </>
  ),
  speaker: (
    <>
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
      <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
    </>
  ),
  speakerOff: (
    <>
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
      <path d="M16 9.5l5 5M21 9.5l-5 5" />
    </>
  ),
  bell: (
    <>
      <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" />
      <path d="M10 20.5a2 2 0 0 0 4 0" />
    </>
  ),
  door: (
    <>
      <path d="M6 21V4h10v17M3.5 21h17" />
      <circle cx="13.2" cy="12.5" r="0.9" fill="currentColor" />
    </>
  ),
  thunder: (
    <>
      <path d="M7 15a4.5 4.5 0 1 1 1.2-8.8A5.5 5.5 0 0 1 18.5 8a3.5 3.5 0 0 1-.5 7" />
      <path d="M12.5 12l-2.5 4h3l-2 4" />
    </>
  ),
  rain: (
    <>
      <path d="M7 14a4.5 4.5 0 1 1 1.2-8.8A5.5 5.5 0 0 1 18.5 7a3.5 3.5 0 0 1-.5 7" />
      <path d="M8 17l-1 2.5M12 17l-1 2.5M16 17l-1 2.5" />
    </>
  ),
  wind: <path d="M3 9h11a2.5 2.5 0 1 0-2.5-2.5M3 13h15a2.5 2.5 0 1 1-2.5 2.5M3 17h7" />,
  bird: <path d="M3 9.5c3 0 4.5 1.5 6 4 1-4 3.5-6.5 7.5-6.5L21 5l-2 4c0 6-4.5 9-10 9-2.5 0-4.5-1-5.5-2.5 2.5 0 4-.5 5-1.5-3-1-4.5-2.5-5.5-4.5z" />,
  music: (
    <>
      <path d="M9 18V5.5l11-2V16" />
      <circle cx="6.5" cy="18" r="2.5" />
      <circle cx="17.5" cy="16" r="2.5" />
    </>
  ),
  voice: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
    </>
  ),
  knock: (
    <>
      <path d="M7 12V7.5a1.5 1.5 0 0 1 3 0V11M10 10V6a1.5 1.5 0 0 1 3 0v4M13 10V7a1.5 1.5 0 0 1 3 0v4M16 10.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-2.7L4.5 14a1.5 1.5 0 0 1 2.5-1.7L7 12" />
    </>
  ),
  spark: <path d="M12 3v5M12 16v5M3 12h5M16 12h5M5.6 5.6l3 3M15.4 15.4l3 3M5.6 18.4l3-3M15.4 8.6l3-3" />,
  heart: <path d="M12 20s-7.5-4.5-7.5-10A4.3 4.3 0 0 1 12 7.3 4.3 4.3 0 0 1 19.5 10c0 5.5-7.5 10-7.5 10z" />,
  youtube: (
    <>
      <rect x="2.5" y="5.5" width="19" height="13" rx="4" />
      <path d="M10 9.3v5.4l4.6-2.7z" fill="currentColor" />
    </>
  ),
  copy: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8" />
    </>
  ),
  arrowRight: <path d="M4 12h15M13 6l6 6-6 6" />,
  keyboard: (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
      <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" />
    </>
  ),
  pen: <path d="M4 20l1.2-4.8L15.5 4.9a2 2 0 0 1 2.8 0l.8.8a2 2 0 0 1 0 2.8L8.8 18.8zM13.5 7l3.5 3.5" />,
  text: <path d="M5 6.5V5h14v1.5M12 5v14M9 19h6" />,
  eraser: <path d="M8.5 19.5h11M4.6 14.6l8.8-8.8a2 2 0 0 1 2.8 0l2.5 2.5a2 2 0 0 1 0 2.8L11 18.8a2.4 2.4 0 0 1-3.4 0l-3-3a.8.8 0 0 1 0-1.2zM9 10.2l5.8 5.8" />,
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.6 9.4a2.5 2.5 0 0 1 4.9.6c0 1.7-2.5 2.2-2.5 3.8M12 17h.01" />
    </>
  ),
  window: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="M3 9h18M6.5 7h.01M9 7h.01" />
    </>
  ),
}

export type IconName = keyof typeof paths

export const ICON_NAMES = Object.keys(paths) as IconName[]

/** An inline line icon. `name` falls back to a dot when unknown, so data-driven icons never crash. */
export const Icon = memo(function Icon({ name, size = 15, strokeWidth = 1.75, className }: { name: IconName | string; size?: number; strokeWidth?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name] ?? <circle cx="12" cy="12" r="2" fill="currentColor" />}
    </svg>
  )
})
Icon.displayName = 'Icon'
