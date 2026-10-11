import { http, setAuthToken } from '../../shared/lib/http'
import type { Device } from '../device/types'

const KEY = 'projmap:token'

export const authApi = {
  /** (backend §9) trades the one-time code from `projmap open` for an editor token */
  login: (code: string, name: string) => http.post<{ token: string; device: Device }>('/api/v1/login', { code, name }),
}

/** The token this browser keeps (editor on another machine); none on the Mac itself. */
export function storedToken(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function storeToken(token: string | null) {
  try {
    if (token) localStorage.setItem(KEY, token)
    else localStorage.removeItem(KEY)
  } catch {
    /* private mode */
  }
  setAuthToken(token)
}
