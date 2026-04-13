import type { Playlist, Track } from '../types'
import { apiDelete, apiFetch, apiPost, toApiUrl } from './api'

export interface TidalUser {
  id: number
  username?: string
  email?: string
  name?: string
}

export interface TidalSessionResponse {
  connected: boolean
  user: TidalUser | null
}

export interface TidalLoginStartResponse {
  attemptId: string
  verificationUri: string
  verificationUriComplete: string
  expiresIn: number
  interval: number
}

export interface TidalLoginStatusResponse {
  status: 'pending' | 'connected' | 'error' | 'missing'
  connected: boolean
  user?: TidalUser | null
  error?: string
  verificationUri?: string
  verificationUriComplete?: string
}

export interface TidalSearchResult {
  tracks: Track[]
  totalResults: number
}

function normalizeTrack(track: Track): Track {
  return {
    ...track,
    audioUrl: track.audioUrl ? toApiUrl(track.audioUrl) : undefined,
  }
}

function normalizePlaylist(playlist: Playlist): Playlist {
  return { ...playlist }
}

export async function getTidalSession(): Promise<TidalSessionResponse> {
  return apiFetch<TidalSessionResponse>('/api/tidal/session')
}

export async function startTidalLogin(): Promise<TidalLoginStartResponse> {
  return apiPost<TidalLoginStartResponse>('/api/tidal/login/start')
}

export async function getTidalLoginStatus(attemptId: string): Promise<TidalLoginStatusResponse> {
  return apiFetch<TidalLoginStatusResponse>(`/api/tidal/login/status/${attemptId}`)
}

export async function logoutTidal(): Promise<{ connected: boolean }> {
  return apiPost<{ connected: boolean }>('/api/tidal/logout')
}

export async function searchTidal(query: string, limit = 20): Promise<TidalSearchResult> {
  const payload = await apiFetch<TidalSearchResult>(`/api/tidal/search?q=${encodeURIComponent(query)}&limit=${limit}`)
  return {
    tracks: payload.tracks.map(normalizeTrack),
    totalResults: payload.tracks.length,
  }
}

export async function getTidalTrack(trackId: string): Promise<Track> {
  const payload = await apiFetch<Track>(`/api/tidal/tracks/${trackId}`)
  return normalizeTrack(payload)
}

export async function getTidalFavoriteTracks(): Promise<Track[]> {
  const payload = await apiFetch<{ tracks: Track[] }>('/api/tidal/favorites/tracks')
  return payload.tracks.map(track => normalizeTrack({ ...track, isFavorite: true }))
}

export async function addTidalFavoriteTrack(trackId: string): Promise<void> {
  await apiPost<{ ok: boolean }>(`/api/tidal/favorites/tracks/${trackId}`)
}

export async function removeTidalFavoriteTrack(trackId: string): Promise<void> {
  await apiDelete<{ ok: boolean }>(`/api/tidal/favorites/tracks/${trackId}`)
}

export async function getTidalPlaylists(): Promise<Playlist[]> {
  const payload = await apiFetch<{ playlists: Playlist[] }>('/api/tidal/playlists')
  return payload.playlists.map(normalizePlaylist)
}

export async function createTidalPlaylist(name: string, description = ''): Promise<Playlist> {
  const payload = await apiPost<Playlist>('/api/tidal/playlists', { name, description })
  return normalizePlaylist(payload)
}

export async function getTidalPlaylist(providerPlaylistId: string): Promise<Playlist & { tracks: Track[] }> {
  const payload = await apiFetch<Playlist & { tracks: Track[] }>(`/api/tidal/playlists/${providerPlaylistId}`)
  return {
    ...normalizePlaylist(payload),
    tracks: payload.tracks.map(normalizeTrack),
  }
}

export async function addTracksToTidalPlaylist(providerPlaylistId: string, trackIds: string[]): Promise<Playlist & { tracks: Track[] }> {
  const payload = await apiPost<Playlist & { tracks: Track[] }>(
    `/api/tidal/playlists/${providerPlaylistId}/items`,
    { trackIds },
  )
  return {
    ...normalizePlaylist(payload),
    tracks: payload.tracks.map(normalizeTrack),
  }
}

export async function removeTrackFromTidalPlaylist(providerPlaylistId: string, trackId: string): Promise<Playlist & { tracks: Track[] }> {
  const payload = await apiDelete<Playlist & { tracks: Track[] }>(
    `/api/tidal/playlists/${providerPlaylistId}/items/${trackId}`,
  )
  return {
    ...normalizePlaylist(payload),
    tracks: payload.tracks.map(normalizeTrack),
  }
}

export async function searchTidalForMatch(artist: string, title: string): Promise<Track | null> {
  const results = await searchTidal(`${artist} ${title}`, 5)
  if (results.tracks.length === 0) return null

  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim()
  const targetArtist = normalize(artist)
  const targetTitle = normalize(title)

  let bestMatch: Track | null = null
  let bestScore = 0

  for (const track of results.tracks) {
    const artistName = normalize(track.artist)
    const trackTitle = normalize(track.title)
    let score = 0

    if (artistName.includes(targetArtist) || targetArtist.includes(artistName)) score += 2
    if (trackTitle.includes(targetTitle) || targetTitle.includes(trackTitle)) score += 2
    if (artistName === targetArtist) score += 3
    if (trackTitle === targetTitle) score += 3

    if (score > bestScore) {
      bestScore = score
      bestMatch = track
    }
  }

  return bestScore >= 2 ? bestMatch : null
}
