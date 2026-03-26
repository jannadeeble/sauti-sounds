import { create } from 'zustand'
import { db } from '../db'
import type { Track } from '../types'
import { parseFile } from '../lib/metadata'

interface LibraryState {
  tracks: Track[]
  loading: boolean
  importing: boolean
  importProgress: { current: number; total: number } | null

  loadTracks: () => Promise<void>
  importFiles: () => Promise<void>
  addTrack: (track: Track) => Promise<void>
  removeTrack: (id: string) => Promise<void>
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  tracks: [],
  loading: false,
  importing: false,
  importProgress: null,

  loadTracks: async () => {
    set({ loading: true })
    try {
      const tracks = await db.tracks.toArray()
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
      const handles = await (window as any).showOpenFilePicker({
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
        const handle = handles[i] as FileSystemFileHandle
        set({ importProgress: { current: i + 1, total: handles.length } })

        try {
          const track = await parseFile(handle)
          await db.tracks.put(track)
        } catch (err) {
          console.error(`Failed to import ${handle.name}:`, err)
        }
      }

      await get().loadTracks()
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error('Import failed:', err)
      }
    } finally {
      set({ importing: false, importProgress: null })
    }
  },

  addTrack: async (track) => {
    await db.tracks.put(track)
    await get().loadTracks()
  },

  removeTrack: async (id) => {
    await db.tracks.delete(id)
    await get().loadTracks()
  },
}))
