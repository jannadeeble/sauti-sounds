import { apiFetch, apiPost } from './api'

export type GenerationStatus = 'queued' | 'running' | 'succeeded' | 'failed'
export type GenerationPhase = 'recommendations' | 'resolving' | 'saving'

export interface PlaylistGenerationCreateRequest {
  prompt: string
  count: number
  titleOverride?: string
  useTaste?: boolean
  source?: 'playlist-generator' | 'ai-chat' | 'home'
}

export interface PlaylistGenerationCreateResponse {
  runId: string
  status: GenerationStatus
  phase: GenerationPhase
}

export interface PlaylistGenerationResult {
  playlistId: string
  mixId: string
  name: string
  blurb?: string
  trackCount: number
}

export interface PlaylistGenerationStatusResponse {
  runId: string
  kind: string
  status: GenerationStatus
  phase: GenerationPhase
  errorCode?: string | null
  errorMessage?: string | null
  result?: PlaylistGenerationResult | null
}

export async function createPlaylistGeneration(
  payload: PlaylistGenerationCreateRequest,
): Promise<PlaylistGenerationCreateResponse> {
  return apiPost<PlaylistGenerationCreateResponse>('/api/generations/playlists', payload)
}

export async function getPlaylistGenerationStatus(
  runId: string,
): Promise<PlaylistGenerationStatusResponse> {
  return apiFetch<PlaylistGenerationStatusResponse>(`/api/generations/${runId}`)
}
