/** The one fetch wrapper. Every HTTP call goes through an entity api.ts, then here. */
export class ApiError extends Error {
  status: number
  code: string
  body: unknown
  constructor(status: number, code: string, message: string, body: unknown) {
    super(message)
    this.status = status
    this.code = code
    this.body = body
  }
}

let token: string | null = null

/** Sets the device token sent as `Authorization: Bearer` (preview and paired clients; localhost needs none). */
export function setAuthToken(t: string | null) {
  token = t
}

export function authToken(): string | null {
  return token
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const form = body instanceof FormData
  const headers: Record<string, string> = {}
  if (body !== undefined && !form) headers['content-type'] = 'application/json'
  if (token) headers.authorization = `Bearer ${token}`
  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : form ? body : JSON.stringify(body),
  })
  if (res.status === 204) return undefined as T
  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  if (!res.ok) {
    const o = data && typeof data === 'object' ? (data as Record<string, unknown>) : {}
    const code = typeof o.code === 'string' ? o.code : `http_${res.status}`
    const msg = typeof o.message === 'string' ? o.message : typeof o.error === 'string' ? o.error : res.statusText || `HTTP ${res.status}`
    throw new ApiError(res.status, code, msg, data)
  }
  return data as T
}

export const http = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  put: <T>(url: string, body?: unknown) => request<T>('PUT', url, body),
  patch: <T>(url: string, body?: unknown) => request<T>('PATCH', url, body),
  del: <T = void>(url: string) => request<T>('DELETE', url),
  /** multipart/form-data POST (file uploads) */
  form: <T>(url: string, data: FormData) => request<T>('POST', url, data),
  /** multipart POST that reports upload progress (0…1) while the bytes go up (big sound and video files) */
  formProgress: <T>(url: string, data: FormData, onProgress?: (p: number) => void) => (onProgress ? upload<T>(url, data, onProgress) : request<T>('POST', url, data)),
}

function upload<T>(url: string, data: FormData, onProgress: (p: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest()
    x.open('POST', url)
    if (token) x.setRequestHeader('authorization', `Bearer ${token}`)
    x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total)
    x.onerror = () => reject(new ApiError(0, 'network', 'The upload failed: no connection to the server.', null))
    x.onload = () => {
      let body: unknown = null
      try {
        body = x.responseText ? JSON.parse(x.responseText) : null
      } catch {
        body = x.responseText
      }
      if (x.status >= 200 && x.status < 300) return resolve(body as T)
      const o = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
      reject(new ApiError(x.status, typeof o.code === 'string' ? o.code : `http_${x.status}`, typeof o.message === 'string' ? o.message : `HTTP ${x.status}`, body))
    }
    x.send(data)
  })
}

export function errMsg(e: unknown, fallback = 'Request failed'): string {
  return e instanceof Error ? e.message : fallback
}
