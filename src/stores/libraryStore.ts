import { create } from 'zustand'
import { db } from '../db'
import { hydrateLibrarySnapshotFromBackend, pushDexieLibrarySnapshot } from '../lib/librarySync'
import { getStorageStatus, uploadToR2 } from '../lib/r2Storage'
import { addTidalFavoriteTrack, getTidalFavoriteTracks, removeTidalFavoriteTrack } from '../lib/tidal'
import { findTidalDuplicates, type LocalDedupMatch } from '../lib/localDedup'
import { parseFile, parseFileBlob } from '../lib/metadata'
import type { Playlist, PlaylistFolder, Track } from '../types'
import { useNotificationStore } from './notificationStore'
import { useTidalStore } from './tidalStore'

interface ImportProgress {
  current: number
  total: number
  currentFile: string
}

export interface ImportResult {
  tracks: Track[]
  dedupeApplied: number
  dedupeUncertain: LocalDedupMatch[]
}

export interface FolderImportResult extends ImportResult {
  playlists: Playlist[]
  folders: PlaylistFolder[]
}

interface LibraryState {
  tracks: Track[]
  loading: boolean
  importing: boolean
  syncingFavorites: boolean
  importProgress: ImportProgress | null
  r2Available: boolean
  pendingLocalSwaps: LocalDedupMatch[]
  loadTracks: () => Promise<void>
  importFiles: () => Promise<ImportResult>
  importFilesViaInput: (files: FileList) => Promise<ImportResult>
  importFolder: (handle: FileSystemDirectoryHandle, basePath?: string) => Promise<FolderImportResult>
  applyLocalSwaps: (matches: LocalDedupMatch[]) => Promise<number>
  clearPendingLocalSwaps: () => void
  addTrack: (track: Track) => Promise<void>
  cacheTidalTracks: (tracks: Track[]) => Promise<void>
  syncTidalFavorites: () => Promise<void>
  toggleTidalFavorite: (track: Track) => Promise<void>
  removeTrack: (id: string) => Promise<void>
  checkR2Status: () => Promise<void>
}

let _r2Available = false

async function uploadTrackToR2(track: Track): Promise<Partial<Track> | null> {
  if (!_r2Available) return null
  const blob = track.audioBlob
  if (!blob) return null
  try {
    const filename = track.filePath || `${track.title}.mp3`
    const [audioResult] = await Promise.all([
      uploadToR2(blob, filename),
    ])
    const updates: Partial<Track> = {
      r2Key: audioResult.key,
    }
    if (track.artworkBlob) {
      try {
        const artworkResult = await uploadToR2(track.artworkBlob, `${track.title}-artwork.jpg`)
        updates.artworkR2Key = artworkResult.key
      } catch {
        // Artwork upload failure is non-critical
      }
    }
    return updates
  } catch (err) {
    console.error('R2 upload failed, keeping blob locally:', err)
    return null
  }
}

async function upsertTracks(tracks: Track[]) {
  if (tracks.length === 0) return
  await db.tracks.bulkPut(tracks.map(track => ({
    ...track,
    addedAt: track.addedAt || Date.now(),
  })))
}

/**
 * Rewrite every playlist that references the given Tidal tracks so the items
 * point at their local replacements instead. Then delete the Tidal rows and
 * carry any `isFavorite` flag onto the local track so the user doesn't lose
 * the heart state.
 */
async function applySwaps(matches: LocalDedupMatch[]): Promise<number> {
  if (matches.length === 0) return 0

  const byProviderTrackId = new Map<string, LocalDedupMatch>()
  for (const m of matches) {
    if (m.tidal.providerTrackId) byProviderTrackId.set(m.tidal.providerTrackId, m)
  }
  if (byProviderTrackId.size === 0) return 0

  // 1. Rewrite playlist items pointing at the Tidal versions.
  const playlists = await db.playlists.toArray()
  const now = Date.now()
  const updates: Playlist[] = []
  for (const playlist of playlists) {
    let changed = false
    const nextItems = playlist.items.map(item => {
      if (item.source !== 'tidal') return item
      const match = byProviderTrackId.get(item.providerTrackId)
      if (!match) return item
      changed = true
      return { source: 'local' as const, trackId: match.local.id }
    })
    if (changed) {
      updates.push({
        ...playlist,
        items: nextItems,
        trackCount: nextItems.length,
        updatedAt: now,
      })
    }
  }
  if (updates.length > 0) {
    await db.playlists.bulkPut(updates)
  }

  // 2. Carry isFavorite onto the local row; drop the Tidal row.
  const tidalIdsToDelete: string[] = []
  for (const match of matches) {
    const tidal = await db.tracks.get(match.tidal.id)
    if (!tidal) continue
    if (tidal.isFavorite) {
      const local = await db.tracks.get(match.local.id)
      if (local) {
        await db.tracks.put({ ...local, isFavorite: true })
      }
    }
    tidalIdsToDelete.push(match.tidal.id)
  }
  if (tidalIdsToDelete.length > 0) {
    await db.tracks.bulkDelete(tidalIdsToDelete)
  }

  return matches.length
}

async function runAutoDedupe(importedTracks: Track[]): Promise<{
  applied: number
  uncertain: LocalDedupMatch[]
}> {
  if (importedTracks.length === 0) return { applied: 0, uncertain: [] }
  const tidalPool = await db.tracks.where('source').equals('tidal').toArray()
  if (tidalPool.length === 0) return { applied: 0, uncertain: [] }
  const { confident, uncertain } = findTidalDuplicates(importedTracks, tidalPool)
  const applied = await applySwaps(confident)
  return { applied, uncertain }
}

async function syncLibraryStateToBackend() {
  await pushDexieLibrarySnapshot()
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  tracks: [],
  loading: false,
  importing: false,
  syncingFavorites: false,
  importProgress: null,
  r2Available: false,
  pendingLocalSwaps: [],

  checkR2Status: async () => {
    try {
      const status = await getStorageStatus()
      _r2Available = status.r2Configured
      set({ r2Available: status.r2Configured })
    } catch {
      _r2Available = false
      set({ r2Available: false })
    }
  },

  loadTracks: async () => {
    set({ loading: true })
    try {
      const snapshot = await hydrateLibrarySnapshotFromBackend()
      const tracks = [...snapshot.tracks].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0))
      set({ tracks })
    } finally {
      set({ loading: false })
    }
  },

  importFiles: async () => {
    if (!('showOpenFilePicker' in window)) {
      alert('Your browser does not support the File System Access API. Please use Chrome on Android or desktop.')
      return { tracks: [], dedupeApplied: 0, dedupeUncertain: [] }
    }

    try {
      const handles = await (window as typeof window & { showOpenFilePicker: (options: object) => Promise<FileSystemFileHandle[]> }).showOpenFilePicker({
        multiple: true,
        types: [
          {
            description: 'Audio files',
            accept: {
              'audio/*': ['.mp3', '.flac', '.wav', '.aac', '.ogg', '.m4a'],
            },
          },
        ],
      })

      set({ importing: true, importProgress: { current: 0, total: handles.length, currentFile: '' } })
      const importedTracks: Track[] = []
      const importBaseTime = Date.now() + handles.length

      for (let i = 0; i < handles.length; i++) {
        const handle = handles[i]
        set({ importProgress: { current: i + 1, total: handles.length, currentFile: handle.name } })

        try {
          const track = await parseFile(handle)
          const r2Updates = await uploadTrackToR2(track)
          const importedTrack = {
            ...track,
            ...(r2Updates || {}),
            addedAt: importBaseTime - i,
          }
          await db.tracks.put(importedTrack)
          importedTracks.push(importedTrack)
        } catch (err) {
          console.error(`Failed to import ${handle.name}:`, err)
        }
      }

      const { applied, uncertain } = await runAutoDedupe(importedTracks)
      if (uncertain.length > 0) {
        set(state => ({ pendingLocalSwaps: [...state.pendingLocalSwaps, ...uncertain] }))
      }
      await syncLibraryStateToBackend()
      await get().loadTracks()
      return { tracks: importedTracks, dedupeApplied: applied, dedupeUncertain: uncertain }
    } catch (err: unknown) {
      if (!(err instanceof DOMException) || err.name !== 'AbortError') {
        console.error('Import failed:', err)
      }
      return { tracks: [], dedupeApplied: 0, dedupeUncertain: [] }
    } finally {
      set({ importing: false, importProgress: null })
    }
  },

  importFilesViaInput: async (files) => {
    try {
      set({ importing: true, importProgress: { current: 0, total: files.length, currentFile: '' } })
      const importedTracks: Track[] = []
      const importBaseTime = Date.now() + files.length

      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        set({ importProgress: { current: i + 1, total: files.length, currentFile: file.name } })

        try {
          const track = await parseFileBlob(file)
          const r2Updates = await uploadTrackToR2(track)
          const importedTrack = {
            ...track,
            ...(r2Updates || {}),
            addedAt: importBaseTime - i,
          }
          await db.tracks.put(importedTrack)
          importedTracks.push(importedTrack)
        } catch (err) {
          console.error(`Failed to import ${file.name}:`, err)
        }
      }

      const { applied, uncertain } = await runAutoDedupe(importedTracks)
      if (uncertain.length > 0) {
        set(state => ({ pendingLocalSwaps: [...state.pendingLocalSwaps, ...uncertain] }))
      }
      await syncLibraryStateToBackend()
      await get().loadTracks()
      return { tracks: importedTracks, dedupeApplied: applied, dedupeUncertain: uncertain }
    } finally {
      set({ importing: false, importProgress: null })
    }
  },

  applyLocalSwaps: async (matches) => {
    const count = await applySwaps(matches)
    const consumedIds = new Set(matches.map(m => m.local.id + '|' + m.tidal.id))
    set(state => ({
      pendingLocalSwaps: state.pendingLocalSwaps.filter(
        m => !consumedIds.has(m.local.id + '|' + m.tidal.id),
      ),
    }))
    await syncLibraryStateToBackend()
    await get().loadTracks()
    return count
  },

  clearPendingLocalSwaps: () => {
    set({ pendingLocalSwaps: [] })
  },

  importFolder: async (handle, basePath = '') => {
    const audioExtensions = ['.mp3', '.flac', '.wav', '.aac', '.ogg', '.m4a']

    type ScannedNode = {
      name: string
      path: string
      handle: FileSystemDirectoryHandle
      audioFiles: { file: File; name: string }[]
      children: ScannedNode[]
    }

    async function scanDirectory(
      dirHandle: FileSystemDirectoryHandle,
      name: string,
      path: string
    ): Promise<ScannedNode | null> {
      const audioFiles: { file: File; name: string }[] = []
      const children: ScannedNode[] = []

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const entries = (dirHandle as any).entries()
      for await (const entry of entries) {
        const entryName = entry[0] as string
        const item = entry[1]

        if (item.kind === 'directory') {
          try {
            const subDir = await dirHandle.getDirectoryHandle(entryName)
            const child = await scanDirectory(subDir, entryName, `${path}/${entryName}`)
            if (child) children.push(child)
          } catch {
            // Skip unreadable subdirectories
          }
        } else if (item.kind === 'file') {
          const ext = entryName.toLowerCase().slice(entryName.lastIndexOf('.'))
          if (audioExtensions.includes(ext)) {
            try {
              const file = await item.getFile()
              audioFiles.push({ file, name: entryName })
            } catch {
              // Skip unreadable files
            }
          }
        }
      }

      if (audioFiles.length === 0 && children.length === 0) return null
      return { name, path, handle: dirHandle, audioFiles, children }
    }

    type PlannedPlaylist = {
      playlist: Playlist
      files: { file: File; name: string }[]
      sourcePath: string
    }

    const folders: PlaylistFolder[] = []
    const plannedPlaylists: PlannedPlaylist[] = []
    const looseTracksFolderNames: string[] = []

    function makeId(prefix: string) {
      return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    }

    function planNode(node: ScannedNode, parentFolderId: string | undefined, now: number) {
      const hasAudio = node.audioFiles.length > 0
      const hasChildren = node.children.length > 0

      if (hasAudio && !hasChildren) {
        // Leaf with audio → single playlist (no folder needed unless we have a parent)
        plannedPlaylists.push({
          playlist: {
            id: makeId('pl'),
            name: node.name,
            description: `Folder: ${node.path}`,
            items: [],
            createdAt: now,
            updatedAt: now,
            kind: 'app',
            writable: true,
            trackCount: 0,
            folderId: parentFolderId,
            origin: 'imported',
          },
          files: node.audioFiles,
          sourcePath: node.path,
        })
        return
      }

      if (!hasAudio && hasChildren) {
        // Branch → folder, recurse
        const folder: PlaylistFolder = {
          id: makeId('plfld'),
          name: node.name,
          parentId: parentFolderId,
          createdAt: now,
          updatedAt: now,
        }
        folders.push(folder)
        for (const child of node.children) planNode(child, folder.id, now)
        return
      }

      if (hasAudio && hasChildren) {
        // Mixed → folder + sibling "(loose tracks)" playlist for the direct audio files
        const folder: PlaylistFolder = {
          id: makeId('plfld'),
          name: node.name,
          parentId: parentFolderId,
          createdAt: now,
          updatedAt: now,
        }
        folders.push(folder)
        const loosePlaylistName = `${node.name} (loose tracks)`
        plannedPlaylists.push({
          playlist: {
            id: makeId('pl'),
            name: loosePlaylistName,
            description: `Loose tracks from folder: ${node.path}`,
            items: [],
            createdAt: now,
            updatedAt: now,
            kind: 'app',
            writable: true,
            trackCount: 0,
            folderId: folder.id,
            origin: 'imported',
          },
          files: node.audioFiles,
          sourcePath: node.path,
        })
        looseTracksFolderNames.push(node.path)
        for (const child of node.children) planNode(child, folder.id, now)
      }
    }

    try {
      const rootName = basePath || handle.name
      const root = await scanDirectory(handle, rootName, rootName)
      if (!root) {
        return { tracks: [], playlists: [], folders: [], dedupeApplied: 0, dedupeUncertain: [] }
      }

      const now = Date.now()
      planNode(root, undefined, now)

      const totalFiles = plannedPlaylists.reduce((sum, p) => sum + p.files.length, 0)
      if (totalFiles === 0) {
        return { tracks: [], playlists: [], folders: [], dedupeApplied: 0, dedupeUncertain: [] }
      }

      set({ importing: true, importProgress: { current: 0, total: totalFiles, currentFile: '' } })

      const importedTracks: Track[] = []
      let processed = 0

      for (const planned of plannedPlaylists) {
        for (const { file } of planned.files) {
          processed += 1
          set({
            importProgress: {
              current: processed,
              total: totalFiles,
              currentFile: file.name,
            },
          })
          try {
            const parsed = await parseFileBlob(file)
            parsed.folderPath = planned.sourcePath
            const r2Updates = await uploadTrackToR2(parsed)
            const importedTrack: Track = {
              ...parsed,
              ...(r2Updates || {}),
              addedAt: now,
            }
            await db.tracks.put(importedTrack)
            importedTracks.push(importedTrack)
            planned.playlist.items.push({ source: 'local', trackId: importedTrack.id })
            planned.playlist.trackCount = planned.playlist.items.length
          } catch (err) {
            console.error(`Failed to import ${file.name}:`, err)
          }
        }
      }

      const playlists = plannedPlaylists
        .map(p => p.playlist)
        .filter(p => p.items.length > 0)

      if (folders.length > 0) {
        await db.playlistFolders.bulkPut(folders)
      }
      if (playlists.length > 0) {
        await db.playlists.bulkPut(playlists)
      }

      const { applied, uncertain } = await runAutoDedupe(importedTracks)
      if (uncertain.length > 0) {
        set(state => ({ pendingLocalSwaps: [...state.pendingLocalSwaps, ...uncertain] }))
      }
      await syncLibraryStateToBackend()
      await get().loadTracks()

      if (importedTracks.length > 0) {
        const looseCount = looseTracksFolderNames.length
        const folderCount = folders.length
        const parts: string[] = [
          `${importedTracks.length} track${importedTracks.length === 1 ? '' : 's'} imported`,
          `${playlists.length} playlist${playlists.length === 1 ? '' : 's'}`,
        ]
        if (folderCount > 0) parts.push(`${folderCount} folder${folderCount === 1 ? '' : 's'}`)
        if (applied > 0) parts.push(`${applied} TIDAL duplicate${applied === 1 ? '' : 's'} replaced`)
        const title = `Imported "${rootName}"`
        const body = looseCount > 0
          ? `${parts.join(', ')}. Loose tracks in ${looseCount} folder${looseCount === 1 ? '' : 's'} were placed in sibling "(loose tracks)" playlists: ${looseTracksFolderNames.join(', ')}.`
          : parts.join(', ') + '.'
        void useNotificationStore.getState().push({
          kind: looseCount > 0 ? 'warning' : 'success',
          title,
          body,
        })
      }

      return { tracks: importedTracks, playlists, folders, dedupeApplied: applied, dedupeUncertain: uncertain }
    } finally {
      set({ importing: false, importProgress: null })
    }
  },

  addTrack: async (track) => {
    await db.tracks.put({ ...track, addedAt: track.addedAt || Date.now() })
    await syncLibraryStateToBackend()
    await get().loadTracks()
  },

  cacheTidalTracks: async (tracks) => {
    await upsertTracks(tracks)
    await syncLibraryStateToBackend()
    await get().loadTracks()
  },

  syncTidalFavorites: async () => {
    if (!useTidalStore.getState().tidalConnected) return

    set({ syncingFavorites: true })
    try {
      const favorites = await getTidalFavoriteTracks()
      const favoriteIds = new Set(favorites.map(track => track.providerTrackId))
      const existingTidalTracks = await db.tracks.where('source').equals('tidal').toArray()

      for (const track of existingTidalTracks) {
        await db.tracks.put({
          ...track,
          isFavorite: favoriteIds.has(track.providerTrackId),
          addedAt: track.addedAt || Date.now(),
        })
      }

      await upsertTracks(favorites.map(track => ({ ...track, isFavorite: true })))
      await syncLibraryStateToBackend()
      await get().loadTracks()
    } finally {
      set({ syncingFavorites: false })
    }
  },

  toggleTidalFavorite: async (track) => {
    if (track.source !== 'tidal' || !track.providerTrackId) return

    if (track.isFavorite) {
      await removeTidalFavoriteTrack(track.providerTrackId)
      await db.tracks.put({ ...track, isFavorite: false, addedAt: track.addedAt || Date.now() })
    } else {
      await addTidalFavoriteTrack(track.providerTrackId)
      await db.tracks.put({ ...track, isFavorite: true, addedAt: track.addedAt || Date.now() })
    }

    await syncLibraryStateToBackend()
    await get().loadTracks()
  },

  removeTrack: async (id) => {
    const track = await db.tracks.get(id)
    if (track) {
      const keysToDelete = [track.r2Key, track.artworkR2Key].filter(Boolean) as string[]
      for (const key of keysToDelete) {
        try {
          const { deleteFromR2 } = await import('../lib/r2Storage')
          await deleteFromR2(key)
        } catch {
          // R2 delete failure is non-critical
        }
      }
    }
    await db.tracks.delete(id)
    await syncLibraryStateToBackend()
    await get().loadTracks()
  },
}))
