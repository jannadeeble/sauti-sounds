import { create } from 'zustand'
import { db } from '../db'
import { addTidalFavoriteTrack, getTidalFavoriteTracks, removeTidalFavoriteTrack } from '../lib/tidal'
import { parseFile, parseFileBlob } from '../lib/metadata'
import type { Track } from '../types'
import { useTidalStore } from './tidalStore'

interface LibraryState {
  tracks: Track[]
  loading: boolean
  importing: boolean
  syncingFavorites: boolean
  importProgress: { current: number; total: number } | null
  loadTracks: () => Promise<void>
  importFiles: () => Promise<void>
  importFilesViaInput: (files: FileList) => Promise<void>
  addTrack: (track: Track) => Promise<void>
  cacheTidalTracks: (tracks: Track[]) => Promise<void>
  syncTidalFavorites: () => Promise<void>
  toggleTidalFavorite: (track: Track) => Promise<void>
  removeTrack: (id: string) => Promise<void>
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
      return
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

      set({ importing: true, importProgress: { current: 0, total: handles.length } })

      for (let i = 0; i < handles.length; i++) {
        const handle = handles[i]
        set({ importProgress: { current: i + 1, total: handles.length } })

        try {
          const track = await parseFile(handle)
          await db.tracks.put({ ...track, addedAt: Date.now() })
        } catch (err) {
          console.error(`Failed to import ${handle.name}:`, err)
        }
      }

      await get().loadTracks()
    } catch (err: unknown) {
      if (!(err instanceof DOMException) || err.name !== 'AbortError') {
        console.error('Import failed:', err)
      }
    } finally {
      set({ importing: false, importProgress: null })
    }
  },

  importFilesViaInput: async (files) => {
    try {
      set({ importing: true, importProgress: { current: 0, total: files.length } })

      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        set({ importProgress: { current: i + 1, total: files.length } })

        try {
          const track = await parseFileBlob(file)
          await db.tracks.put({ ...track, addedAt: Date.now() })
        } catch (err) {
          console.error(`Failed to import ${file.name}:`, err)
        }
      }

      await get().loadTracks()
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
    await db.tracks.delete(id)
    await get().loadTracks()
  },
}))
