import { create } from 'zustand'
import { db } from '../db'
import { getStorageStatus, uploadToR2 } from '../lib/r2Storage'
import { addTidalFavoriteTrack, getTidalFavoriteTracks, removeTidalFavoriteTrack } from '../lib/tidal'
import { parseFile, parseFileBlob } from '../lib/metadata'
import type { Playlist, Track } from '../types'
import { useTidalStore } from './tidalStore'

interface ImportProgress {
  current: number
  total: number
  currentFile: string
}

interface LibraryState {
  tracks: Track[]
  loading: boolean
  importing: boolean
  syncingFavorites: boolean
  importProgress: ImportProgress | null
  r2Available: boolean
  loadTracks: () => Promise<void>
  importFiles: () => Promise<Track[]>
  importFilesViaInput: (files: FileList) => Promise<Track[]>
  importFolder: (handle: FileSystemDirectoryHandle, basePath?: string) => Promise<{ tracks: Track[]; playlists: Playlist[] }>
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

export const useLibraryStore = create<LibraryState>((set, get) => ({
  tracks: [],
  loading: false,
  importing: false,
  syncingFavorites: false,
  importProgress: null,
  r2Available: false,

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
      const tracks = await db.tracks.orderBy('addedAt').reverse().toArray()
      set({ tracks })
    } finally {
      set({ loading: false })
    }
  },

  importFiles: async () => {
    if (!('showOpenFilePicker' in window)) {
      alert('Your browser does not support the File System Access API. Please use Chrome on Android or desktop.')
      return []
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

      await get().loadTracks()
      return importedTracks
    } catch (err: unknown) {
      if (!(err instanceof DOMException) || err.name !== 'AbortError') {
        console.error('Import failed:', err)
      }
      return []
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

      await get().loadTracks()
      return importedTracks
    } finally {
      set({ importing: false, importProgress: null })
    }
  },

  importFolder: async (handle, basePath = '') => {
    const audioExtensions = ['.mp3', '.flac', '.wav', '.aac', '.ogg', '.m4a']

    async function hasAudioFiles(dirHandle: FileSystemDirectoryHandle): Promise<boolean> {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const entries = (dirHandle as any).entries()
      for await (const entry of entries) {
        if (entry[1].kind === 'directory') {
          try {
            const subDir = await dirHandle.getDirectoryHandle(entry[0])
            if (await hasAudioFiles(subDir)) return true
          } catch {
            // Skip
          }
        } else if (entry[1].kind === 'file') {
          const name = entry[0] as string
          const ext = name.toLowerCase().slice(name.lastIndexOf('.'))
          if (audioExtensions.includes(ext)) return true
        }
      }
      return false
    }

    async function collectTracksAndPlaylists(
      dirHandle: FileSystemDirectoryHandle
    ): Promise<{ tracks: Track[]; folderPlaylistMap: Map<string, Playlist> }> {
      const tracks: Track[] = []
      const folderPlaylistMap = new Map<string, Playlist>()

      async function processFolder(
        folderHandle: FileSystemDirectoryHandle,
        currentPath: string
      ): Promise<void> {
        const audioFiles: { file: File; name: string }[] = []
        const subfolders: { handle: FileSystemDirectoryHandle; name: string }[] = []

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const entries = (folderHandle as any).entries()
        for await (const entry of entries) {
          const name = entry[0] as string
          const item = entry[1]

          if (item.kind === 'directory') {
            try {
              const subDir = await folderHandle.getDirectoryHandle(name)
              if (await hasAudioFiles(subDir)) {
                subfolders.push({ handle: subDir, name })
              }
            } catch {
              // Skip
            }
          } else if (item.kind === 'file') {
            const ext = name.toLowerCase().slice(name.lastIndexOf('.'))
            if (audioExtensions.includes(ext)) {
              try {
                const file = await item.getFile()
                audioFiles.push({ file, name })
              } catch {
                // Skip
              }
            }
          }
        }

        for (const { handle: subDir, name: subName } of subfolders) {
          await processFolder(subDir, `${currentPath}/${subName}`)
        }

        if (audioFiles.length > 0) {
          const now = Date.now()
          const folderName = currentPath.split('/').pop() || 'Unknown'
          const playlist: Playlist = {
            id: `folder-${now}-${Math.random().toString(36).slice(2, 8)}`,
            name: folderName,
            description: `Folder: ${currentPath}`,
            items: [],
            createdAt: now,
            updatedAt: now,
            kind: 'app',
            writable: true,
            trackCount: 0,
          }
          folderPlaylistMap.set(currentPath, playlist)

          for (const { file } of audioFiles) {
            try {
              const track = await parseFileBlob(file)
              track.folderPath = currentPath
              const r2Updates = await uploadTrackToR2(track)
              const importedTrack: Track = {
                ...track,
                ...(r2Updates || {}),
                addedAt: now,
              }
              tracks.push(importedTrack)
              playlist.items.push({ source: 'local', trackId: importedTrack.id })
              playlist.trackCount = playlist.items.length
            } catch (err) {
              console.error(`Failed to import ${file.name}:`, err)
            }
          }
        }
      }

      await processFolder(dirHandle, basePath || handle.name)
      return { tracks, folderPlaylistMap }
    }

    try {
      if (!(await hasAudioFiles(handle))) {
        return { tracks: [], playlists: [] }
      }

      const { tracks, folderPlaylistMap } = await collectTracksAndPlaylists(handle)
      const totalFiles = tracks.length

      if (totalFiles === 0) {
        return { tracks: [], playlists: [] }
      }

      set({ importing: true, importProgress: { current: 0, total: totalFiles, currentFile: '' } })

      for (let i = 0; i < tracks.length; i++) {
        set({
          importProgress: {
            current: i + 1,
            total: totalFiles,
            currentFile: tracks[i].title || 'Unknown',
          }
        })

        await db.tracks.put(tracks[i])
      }

      const playlists = Array.from(folderPlaylistMap.values())
      if (playlists.length > 0) {
        await db.playlists.bulkPut(playlists)
      }

      await get().loadTracks()
      return { tracks, playlists }
    } finally {
      set({ importing: false, importProgress: null })
    }
  },

  addTrack: async (track) => {
    await db.tracks.put({ ...track, addedAt: track.addedAt || Date.now() })
    await get().loadTracks()
  },

  cacheTidalTracks: async (tracks) => {
    await upsertTracks(tracks)
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
    await get().loadTracks()
  },
}))
