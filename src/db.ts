import Dexie, { type EntityTable } from 'dexie'
import type { Playlist, Track } from './types'

export type ListenContext =
  | 'library'
  | 'search-local'
  | 'search-tidal'
  | 'app-playlist'
  | 'tidal-playlist'
  | 'suggestion-setlist'
  | 'suggestion-playlist-footer'
  | 'suggestion-home'
  | 'unknown'

export interface ListenEvent {
  id: string
  trackId: string
  source: 'local' | 'tidal'
  providerTrackId?: string
  startedAt: number
  endedAt: number
  msListened: number
  trackDurationMs?: number
  completed: boolean
  skipped: boolean
  context: ListenContext
  suggestionId?: string
}

export type SuggestionKind =
  | 'setlist'
  | 'playlist-footer'
  | 'home-rediscovery'
  | 'home-similar-playlist'
  | 'home-similar-artist'
  | 'home-cultural-bridge'

export interface SuggestionCacheEntry {
  id: string
  kind: SuggestionKind
  sourceKey: string
  createdAt: number
  expiresAt: number
  payload: string
}

const db = new Dexie('SautiSoundsDB') as Dexie & {
  tracks: EntityTable<Track, 'id'>
  playlists: EntityTable<Playlist, 'id'>
  listens: EntityTable<ListenEvent, 'id'>
  suggestions: EntityTable<SuggestionCacheEntry, 'id'>
}

db.version(1).stores({
  tracks: 'id, title, artist, album, source, genre, bpm, energy',
  playlists: 'id, name, createdAt',
})

db.version(2).stores({
  tracks: 'id, title, artist, album, source, genre, bpm, energy, providerTrackId, isFavorite, addedAt',
  playlists: 'id, name, kind, createdAt, updatedAt, providerPlaylistId',
}).upgrade(async tx => {
  await tx.table('tracks').toCollection().modify((track: Record<string, unknown>) => {
    if (track.source === 'tidal') {
      const legacyId = typeof track.id === 'string' ? track.id.replace(/^tidal-/, '') : undefined
      const legacyProvider = typeof track.tidalId === 'number' ? String(track.tidalId) : legacyId
      track.providerTrackId ||= legacyProvider
      track.providerUrl ||= track.tidalUrl
    }
    track.addedAt ||= Date.now()
    delete track.tidalId
    delete track.tidalUrl
  })

  await tx.table('playlists').toCollection().modify((playlist: Record<string, unknown>) => {
    const legacyTrackIds = Array.isArray(playlist.trackIds) ? playlist.trackIds as string[] : []
    if (!Array.isArray(playlist.items)) {
      playlist.items = legacyTrackIds.map(trackId =>
        trackId.startsWith('tidal-')
          ? { source: 'tidal', providerTrackId: trackId.replace(/^tidal-/, '') }
          : { source: 'local', trackId }
      )
    }
    playlist.kind ||= 'app'
    playlist.updatedAt ||= playlist.createdAt || Date.now()
    delete playlist.trackIds
  })
})

db.version(3).stores({
  tracks: 'id, title, artist, album, source, genre, bpm, energy, providerTrackId, isFavorite, addedAt, r2Key, artworkR2Key',
  playlists: 'id, name, kind, createdAt, updatedAt, providerPlaylistId',
})

db.version(4).stores({
  tracks: 'id, title, artist, album, source, genre, bpm, energy, providerTrackId, isFavorite, addedAt, r2Key, artworkR2Key',
  playlists: 'id, name, kind, createdAt, updatedAt, providerPlaylistId',
  listens: 'id, trackId, startedAt, completed, skipped, context',
  suggestions: 'id, kind, sourceKey, createdAt, expiresAt, [kind+sourceKey]',
})

export { db }
