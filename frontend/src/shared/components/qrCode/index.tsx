import qrcode from 'qrcode-generator'
import { useMemo } from 'react'
import s from './styles.module.css'

/** A QR code drawn as SVG, dark on white so any camera reads it. */
export function QrCode({ text, size = 200, label }: { text: string; size?: number; label: string }) {
  const { n, path } = useMemo(() => {
    const q = qrcode(0, 'M')
    q.addData(text)
    q.make()
    const n = q.getModuleCount()
    let d = ''
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`
    return { n, path: d }
  }, [text])
  return (
    <svg className={s.qr} width={size} height={size} viewBox={`-2 -2 ${n + 4} ${n + 4}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect className={s.paper} x="-2" y="-2" width={n + 4} height={n + 4} rx="1.2" />
      <path className={s.ink} d={path} />
    </svg>
  )
}
