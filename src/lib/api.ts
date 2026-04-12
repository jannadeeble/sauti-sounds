export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')

export function toApiUrl(path: string): string {
  if (!API_BASE_URL) return path
  return `${API_BASE_URL}${path}`
}

function mergeHeaders(headers?: HeadersInit): Headers {
  const merged = new Headers(headers)
  if (!merged.has('Accept')) merged.set('Accept', 'application/json')
  return merged
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(toApiUrl(path), {
    ...init,
    credentials: 'include',
    headers: mergeHeaders(init.headers),
  })

  if (!response.ok) {
    let message = response.statusText
    try {
      const payload = await response.json()
      message = payload.detail || payload.message || message
    } catch {
      // Ignore JSON parse failures for plain-text responses.
    }
    throw new ApiError(message, response.status)
  }

  if (response.status === 204) {
    return undefined as T
  }

  return response.json() as Promise<T>
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return apiFetch<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
}

export async function apiDelete<T>(path: string): Promise<T> {
  return apiFetch<T>(path, { method: 'DELETE' })
}
