import type { Playlist, PlaylistFolder, Track } from '../types'
import { apiDelete, apiFetch, toApiUrl } from './api'

export interface LibrarySnapshot {
  tracks: Track[]
  playlists: Playlist[]
  folders: PlaylistFolder[]
}

function normalizeTrack(track: Track): Track {
  return {
    ...track,
    audioUrl: track.audioUrl
      ? (/^https?:\/\//.test(track.audioUrl) ? track.audioUrl : toApiUrl(track.audioUrl))
      : undefined,
  }
}

export async function getLibrarySnapshot(): Promise<LibrarySnapshot> {
  const payload = await apiFetch<LibrarySnapshot>('/api/library/snapshot')
  return {
    tracks: payload.tracks.map(normalizeTrack),
    playlists: payload.playlists,
    folders: payload.folders,
  }
}

export async function saveLibrarySnapshot(snapshot: LibrarySnapshot): Promise<LibrarySnapshot> {
  const payload = await apiFetch<LibrarySnapshot>('/api/library/snapshot', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(snapshot),
  })
  return {
    tracks: payload.tracks.map(normalizeTrack),
    playlists: payload.playlists,
    folders: payload.folders,
  }
}

export async function clearLibrarySnapshot(): Promise<void> {
  await apiDelete('/api/library/snapshot')
}
