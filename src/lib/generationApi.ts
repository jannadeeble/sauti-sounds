import { apiFetch, apiPost } from './api'
import type { Mix, Track } from '../types'

export type GenerationStatus = 'queued' | 'running' | 'succeeded' | 'failed'
export type GenerationPhase = 'recommendations' | 'resolving' | 'saving'
export type GenerationKind =
  | 'mood-playlist'
  | 'setlist-seed'
  | 'playlist-footer'
  | 'track-echo'
  | 'playlist-echo'
  | 'similar-artist'
  | 'cultural-bridge'
  | 'rediscovery'
  | 'auto-radio'

export interface GenerationCreateRequest {
  kind: GenerationKind
  prompt?: string
  count?: number
  titleOverride?: string
  useTaste?: boolean
  source?: 'playlist-generator' | 'ai-chat' | 'home' | 'home-feed' | 'modal' | 'playlist-footer' | 'auto-radio'
  seedTrackId?: string
  seedPlaylistId?: string
  seedArtist?: string
  focusPrompt?: string
}

export interface GenerationCreateResponse {
  runId: string
  status: GenerationStatus
  phase: GenerationPhase
}

export interface GenerationResult {
  playlistId?: string
  mixId?: string
  name?: string
  blurb?: string
  mix?: Mix
  trackIds?: string[]
  tracks?: Track[]
  trackCount: number
  unresolvedCount?: number
}

export interface GenerationStatusResponse {
  runId: string
  kind: GenerationKind
  status: GenerationStatus
  phase: GenerationPhase
  errorCode?: string | null
  errorMessage?: string | null
  result?: GenerationResult | null
}

export type PlaylistGenerationCreateRequest = Omit<GenerationCreateRequest, 'kind'> & {
  prompt: string
  count: number
  source?: 'playlist-generator' | 'ai-chat' | 'home'
}
export type PlaylistGenerationCreateResponse = GenerationCreateResponse
export type PlaylistGenerationResult = Required<Pick<GenerationResult, 'playlistId' | 'mixId' | 'name' | 'trackCount'>> & Pick<GenerationResult, 'blurb' | 'mix'>
export type PlaylistGenerationStatusResponse = Omit<GenerationStatusResponse, 'result'> & {
  result?: PlaylistGenerationResult | null
}

export async function createGeneration(
  payload: GenerationCreateRequest,
): Promise<GenerationCreateResponse> {
  return apiPost<GenerationCreateResponse>('/api/generations', payload)
}

export async function createPlaylistGeneration(
  payload: PlaylistGenerationCreateRequest,
): Promise<PlaylistGenerationCreateResponse> {
  return createGeneration({ ...payload, kind: 'mood-playlist' })
}

export async function getGenerationStatus(
  runId: string,
): Promise<GenerationStatusResponse> {
  return apiFetch<GenerationStatusResponse>(`/api/generations/${runId}`)
}

export async function getPlaylistGenerationStatus(
  runId: string,
): Promise<PlaylistGenerationStatusResponse> {
  return getGenerationStatus(runId) as Promise<PlaylistGenerationStatusResponse>
}
