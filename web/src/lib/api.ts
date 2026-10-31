const BASE = '/api/v1'
const TOKEN_KEY = 'le_admin_token'

export class ApiError extends Error {
  code: string
  status: number

  constructor(message: string, code = 'INTERNAL', status = 500) {
    super(message)
    this.code = code
    this.status = status
  }
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) ?? ''
}

export function setToken(token: string) {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

type Options = {
  method?: string
  body?: unknown
  auth?: boolean
  formData?: FormData
  signal?: AbortSignal
}

async function request<T>(path: string, options: Options = {}): Promise<T> {
  const headers: Record<string, string> = {}
  if (options.auth) {
    const token = getToken()
    if (token) headers.Authorization = `Bearer ${token}`
  }
  let body: BodyInit | undefined
  if (options.formData) {
    body = options.formData
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(options.body)
  }

  const res = await fetch(`${BASE}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body,
    signal: options.signal,
  })

  let payload: any = null
  const text = await res.text()
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    throw new ApiError('返回内容不是合法 JSON', 'INTERNAL', res.status)
  }

  if (!res.ok || payload?.ok === false) {
    const message = payload?.error?.message ?? `请求失败 (${res.status})`
    const code = payload?.error?.code ?? 'INTERNAL'
    if (res.status === 401 && options.auth) {
      setToken('')
      if (location.pathname.startsWith('/admin') && !location.pathname.endsWith('/login')) {
        location.href = '/admin/login'
      }
    }
    throw new ApiError(message, code, res.status)
  }
  return payload.data as T
}

export const api = {
  get: <T>(path: string, auth = false) => request<T>(path, { auth }),
  post: <T>(path: string, body?: unknown, auth = false) =>
    request<T>(path, { method: 'POST', body, auth }),
  put: <T>(path: string, body?: unknown, auth = false) =>
    request<T>(path, { method: 'PUT', body, auth }),
  del: <T>(path: string, auth = false) => request<T>(path, { method: 'DELETE', auth }),
  upload: <T>(path: string, formData: FormData, auth = true) =>
    request<T>(path, { method: 'POST', formData, auth }),
}

export function qs(params: Record<string, unknown>) {
  const search = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '' && v !== 'all') search.set(k, String(v))
  })
  const s = search.toString()
  return s ? `?${s}` : ''
}

export async function downloadFile(path: string, filename: string) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  })
  if (!res.ok) throw new ApiError('下载失败', 'INTERNAL', res.status)
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
