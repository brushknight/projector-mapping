import { useEffect, useState } from 'react'
import { Cap, OnAirDot, QrCode } from '../../../../shared/components'
import { pairingApi } from '../../api'
import { connectLink, type PairCode, type ServerInfo } from '../../types'
import s from './styles.module.css'

/**
 * The output's idle screen: the pairing code, a QR code with the projmap:// link, and the connection state.
 * Fetches a fresh code when the old one expires.
 */
export function PairingScreen({ connected, status }: { connected: boolean; status: string }) {
  const [code, setCode] = useState<PairCode | null>(null)
  const [info, setInfo] = useState<ServerInfo | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout>
    const load = async () => {
      try {
        const [c, i] = await Promise.all([pairingApi.code(), pairingApi.info().catch(() => null)])
        if (!alive) return
        setCode(c)
        setInfo(i)
        setFailed(false)
        const ms = Date.parse(c.expiresAt) - Date.now()
        timer = setTimeout(load, Number.isFinite(ms) ? Math.max(5000, Math.min(ms, 600_000)) : 60_000)
      } catch {
        if (!alive) return
        setFailed(true)
        timer = setTimeout(load, 3000)
      }
    }
    load()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [])

  const host = info?.hostname || location.hostname
  const port = info?.port ?? 7400
  const link = code ? connectLink(host, code.code, port) : null

  return (
    <div className={s.screen} data-testid="pairing">
      <div className={s.top}>
        <span className={s.wm}>projector map</span>
        <span className={s.state}>
          <OnAirDot off={!connected} />
          {connected ? status : 'connecting to the server'}
        </span>
      </div>
      <div className={s.card}>
        <div className={s.left}>
          <Cap>pair your iphone</Cap>
          <div className={s.code} aria-label="pairing code">
            {(code?.code ?? '····').split('').map((ch, i) => (
              <span key={i}>{ch}</span>
            ))}
          </div>
          <p className={s.help}>
            open projector map on the phone, then scan the code or type it in.
            <br />
            {failed ? 'the server does not answer yet, retrying' : `${host}:${port}`}
          </p>
        </div>
        <div className={s.qr}>{link ? <QrCode text={link} size={220} label="pairing QR code" /> : <div className={s.qrEmpty} />}</div>
      </div>
      <div className={s.waiting}>
        <span className={s.dots}>
          <i />
          <i />
          <i />
        </span>
        waiting for controller
      </div>
    </div>
  )
}
