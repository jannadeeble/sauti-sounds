import { db } from '../db'
import type { Playlist, PlaylistFolder, Track } from '../types'
import {
  clearLibrarySnapshot,
  getLibrarySnapshot,
  saveLibrarySnapshot,
  type LibrarySnapshot,
} from './libraryApi'

function isPersistentUrl(url?: string) {
  return Boolean(url && !url.startsWith('blob:'))
}

export function sanitizeTrackForPersistence(track: Track): Track {
  const { audioBlob, artworkBlob, fileHandle, ...rest } = track
  return {
    ...rest,
    artworkUrl: isPersistentUrl(rest.artworkUrl) ? rest.artworkUrl : undefined,
    addedAt: rest.addedAt || Date.now(),
  }
}

function sanitizePlaylistForPersistence(playlist: Playlist): Playlist {
  return {
    ...playlist,
    trackCount: playlist.trackCount ?? playlist.items.length,
  }
}

function sanitizeFolderForPersistence(folder: PlaylistFolder): PlaylistFolder {
  return {
    ...folder,
    updatedAt: folder.updatedAt || folder.createdAt || Date.now(),
  }
}

export async function readLibrarySnapshotFromDexie(): Promise<LibrarySnapshot> {
  const [tracks, playlists, folders] = await Promise.all([
    db.tracks.toArray(),
    db.playlists.where('kind').equals('app').toArray(),
    db.playlistFolders.toArray(),
  ])

  return {
    tracks: tracks.map(sanitizeTrackForPersistence),
    playlists: playlists.map(sanitizePlaylistForPersistence),
    folders: folders.map(sanitizeFolderForPersistence),
  }
}

export async function pushDexieLibrarySnapshot(): Promise<LibrarySnapshot> {
  const snapshot = await readLibrarySnapshotFromDexie()
  return saveLibrarySnapshot(snapshot)
}

export async function hydrateLibrarySnapshotFromBackend(): Promise<LibrarySnapshot> {
  const snapshot = await getLibrarySnapshot()
  const backendHasData =
    snapshot.tracks.length > 0 || snapshot.playlists.length > 0 || snapshot.folders.length > 0

  if (!backendHasData) {
    const localSnapshot = await readLibrarySnapshotFromDexie()
    const localHasData =
      localSnapshot.tracks.length > 0
      || localSnapshot.playlists.length > 0
      || localSnapshot.folders.length > 0

    if (localHasData) {
      return saveLibrarySnapshot(localSnapshot)
    }
  }

  await db.transaction('rw', db.tracks, db.playlists, db.playlistFolders, async () => {
    await db.tracks.clear()
    await db.playlists.clear()
    await db.playlistFolders.clear()

    if (snapshot.tracks.length > 0) {
      await db.tracks.bulkPut(snapshot.tracks)
    }
    if (snapshot.playlists.length > 0) {
      await db.playlists.bulkPut(snapshot.playlists)
    }
    if (snapshot.folders.length > 0) {
      await db.playlistFolders.bulkPut(snapshot.folders)
    }
  })

  return snapshot
}

export async function clearPersistedLibrary(): Promise<void> {
  await clearLibrarySnapshot()
  await db.transaction('rw', db.tracks, db.playlists, db.playlistFolders, async () => {
    await db.tracks.clear()
    await db.playlists.clear()
    await db.playlistFolders.clear()
  })
}
