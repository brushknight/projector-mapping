export interface ServerInfo {
  name: string
  version: string
  port: number
  hostname: string
  pairingRequired: boolean
}

export interface PairCode {
  code: string
  expiresAt: string
}

/** The link the output's QR code carries; the phone app handles projmap:// links. */
export function connectLink(host: string, code: string, port = 7400): string {
  return `projmap://connect?server=${host}:${port}&code=${encodeURIComponent(code)}`
}
