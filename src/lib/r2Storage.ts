import { apiFetch, API_BASE_URL } from './api'

export interface StorageUploadResult {
  key: string
  url: string | null
}

export interface StorageStatus {
  r2Configured: boolean
}

export async function getStorageStatus(): Promise<StorageStatus> {
  return apiFetch<StorageStatus>('/api/storage/status')
}

export async function uploadToR2(file: File | Blob, filename?: string): Promise<StorageUploadResult> {
  const form = new FormData()
  const name = filename || (file instanceof File ? file.name : 'upload')
  form.append('file', file, name)

  return apiFetch<StorageUploadResult>('/api/storage/upload', {
    method: 'POST',
    credentials: 'include',
    body: form,
  })
}

export async function getPresignedUrl(key: string): Promise<string> {
  const result = await apiFetch<{ key: string; url: string }>(`/api/storage/${key}/url`)
  return result.url
}

export async function deleteFromR2(key: string): Promise<void> {
  await apiFetch<void>(`/api/storage/${key}`, { method: 'DELETE' })
}

export function r2AudioUrl(key: string): string {
  const base = API_BASE_URL || ''
  return `${base}/api/storage/${key}/url`
}
