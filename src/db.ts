import Dexie, { type EntityTable } from 'dexie'
import type {
  AppNotification,
  HistoryEntry,
  ListenEvent,
  Mix,
  Playlist,
  PlaylistFolder,
  TasteProfileRecord,
  Track,
} from './types'

const db = new Dexie('SautiSoundsDB') as Dexie & {
  tracks: EntityTable<Track, 'id'>
  playlists: EntityTable<Playlist, 'id'>
  playlistFolders: EntityTable<PlaylistFolder, 'id'>
  notifications: EntityTable<AppNotification, 'id'>
  history: EntityTable<HistoryEntry, 'id'>
  listenEvents: EntityTable<ListenEvent, 'id'>
  mixes: EntityTable<Mix, 'id'>
  tasteProfile: EntityTable<TasteProfileRecord, 'id'>
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
  playlists: 'id, name, kind, createdAt, updatedAt, providerPlaylistId, folderId',
  playlistFolders: 'id, name, parentId, createdAt, updatedAt',
  notifications: 'id, createdAt, readAt, kind',
})

db.version(5).stores({
  tracks: 'id, title, artist, album, source, genre, bpm, energy, providerTrackId, isFavorite, addedAt, r2Key, artworkR2Key',
  playlists: 'id, name, kind, createdAt, updatedAt, providerPlaylistId, folderId',
  playlistFolders: 'id, name, parentId, createdAt, updatedAt',
  notifications: 'id, createdAt, readAt, kind',
  history: 'id, trackId, playedAt, source',
})

db.version(6).stores({
  tracks: 'id, title, artist, album, source, genre, bpm, energy, providerTrackId, isFavorite, addedAt, r2Key, artworkR2Key',
  playlists: 'id, name, kind, createdAt, updatedAt, providerPlaylistId, folderId',
  playlistFolders: 'id, name, parentId, createdAt, updatedAt',
  notifications: 'id, createdAt, readAt, kind',
  history: 'id, trackId, playedAt, source',
  listenEvents: 'id, trackId, startedAt, context',
  mixes: 'id, kind, status, generatedAt, expiresAt',
  tasteProfile: 'id',
}).upgrade(async tx => {
  // v5 stored Track.tags as string[]. The new shape is TrackTags. Drop the
  // legacy value so the tagger can repopulate without reading garbage.
  await tx.table('tracks').toCollection().modify((track: Record<string, unknown>) => {
    if (Array.isArray(track.tags)) {
      delete track.tags
    }
  })
})

export { db }
