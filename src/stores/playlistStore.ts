import { create } from 'zustand'
import { db } from '../db'
import {
  addTracksToTidalPlaylist,
  createTidalPlaylist,
  getTidalPlaylist,
  getTidalPlaylists,
  removeTrackFromTidalPlaylist,
} from '../lib/tidal'
import type { Playlist, PlaylistFolder, PlaylistItem, PlaylistOrigin, Track } from '../types'
import { useLibraryStore } from './libraryStore'
import { useTidalStore } from './tidalStore'

interface PlaylistDetail {
  playlist: Playlist
  tracks: Track[]
}

interface CreateAppPlaylistOptions {
  folderId?: string
  generatedFromMixId?: string
  generatedPrompt?: string
  origin?: PlaylistOrigin
}

interface PlaylistState {
  appPlaylists: Playlist[]
  appPlaylistFolders: PlaylistFolder[]
  tidalPlaylists: Playlist[]
  tidalPlaylistDetails: Record<string, PlaylistDetail>
  loading: boolean
  loadPlaylists: () => Promise<void>
  loadTidalPlaylistDetail: (providerPlaylistId: string) => Promise<PlaylistDetail>
  createAppPlaylist: (name: string, description?: string, options?: CreateAppPlaylistOptions) => Promise<Playlist>
  renameAppPlaylist: (id: string, name: string, description?: string) => Promise<void>
  deleteAppPlaylist: (id: string) => Promise<void>
  addTrackToPlaylist: (playlist: Playlist, track: Track) => Promise<void>
  appendTracksToAppPlaylist: (playlistId: string, tracks: Track[]) => Promise<void>
  removeTrackFromPlaylist: (playlist: Playlist, item: PlaylistItem, index?: number) => Promise<void>
  moveAppPlaylistItem: (playlistId: string, fromIndex: number, toIndex: number) => Promise<void>
  createProviderPlaylist: (name: string, description?: string) => Promise<Playlist>
  bulkImportAppPlaylists: (
    playlists: Playlist[],
    mode: 'skip' | 'merge' | 'replace',
  ) => Promise<{ created: number; merged: number; replaced: number; skipped: number }>
}

function trackToPlaylistItem(track: Track): PlaylistItem {
  return track.source === 'tidal' && track.providerTrackId
    ? { source: 'tidal', providerTrackId: track.providerTrackId }
    : { source: 'local', trackId: track.id }
}

async function readAppPlaylists(): Promise<Playlist[]> {
  return db.playlists.where('kind').equals('app').sortBy('updatedAt')
}

export const usePlaylistStore = create<PlaylistState>((set, get) => ({
  appPlaylists: [],
  appPlaylistFolders: [],
  tidalPlaylists: [],
  tidalPlaylistDetails: {},
  loading: false,

  loadPlaylists: async () => {
    set({ loading: true })
    try {
      const [appPlaylistsRaw, appPlaylistFolders] = await Promise.all([
        readAppPlaylists(),
        db.playlistFolders.orderBy('name').toArray(),
      ])
      const appPlaylists = appPlaylistsRaw.reverse()
      const tidalPlaylists = useTidalStore.getState().tidalConnected
        ? await getTidalPlaylists()
        : []
      set({ appPlaylists, appPlaylistFolders, tidalPlaylists, loading: false })
    } catch (err) {
      console.error('Failed to load playlists:', err)
      set({ loading: false })
    }
  },

  loadTidalPlaylistDetail: async (providerPlaylistId) => {
    const detail = await getTidalPlaylist(providerPlaylistId)
    await useLibraryStore.getState().cacheTidalTracks(detail.tracks)

    const resolved = {
      playlist: detail,
      tracks: detail.tracks,
    }

    set(state => ({
      tidalPlaylistDetails: {
        ...state.tidalPlaylistDetails,
        [providerPlaylistId]: resolved,
      },
    }))

    return resolved
  },

  createAppPlaylist: async (name, description = '', options = {}) => {
    const now = Date.now()
    const playlist: Playlist = {
      id: `app-${now}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      description,
      items: [],
      createdAt: now,
      updatedAt: now,
      kind: 'app',
      writable: true,
      trackCount: 0,
      folderId: options.folderId,
      origin: options.origin ?? 'manual',
      generatedFromMixId: options.generatedFromMixId,
      generatedPrompt: options.generatedPrompt,
    }
    await db.playlists.put(playlist)
    await get().loadPlaylists()
    return playlist
  },

  renameAppPlaylist: async (id, name, description = '') => {
    const playlist = await db.playlists.get(id)
    if (!playlist) return
    await db.playlists.put({
      ...playlist,
      name,
      description,
      updatedAt: Date.now(),
    })
    await get().loadPlaylists()
  },

  deleteAppPlaylist: async (id) => {
    await db.playlists.delete(id)
    await get().loadPlaylists()
  },

  addTrackToPlaylist: async (playlist, track) => {
    if (playlist.kind === 'tidal') {
      if (track.source !== 'tidal' || !track.providerTrackId || !playlist.providerPlaylistId) {
        throw new Error('Only TIDAL tracks can be added to TIDAL playlists')
      }
      const detail = await addTracksToTidalPlaylist(playlist.providerPlaylistId, [track.providerTrackId])
      await useLibraryStore.getState().cacheTidalTracks(detail.tracks)
      set(state => ({
        tidalPlaylistDetails: {
          ...state.tidalPlaylistDetails,
          [playlist.providerPlaylistId!]: { playlist: detail, tracks: detail.tracks },
        },
      }))
      await get().loadPlaylists()
      return
    }

    await get().appendTracksToAppPlaylist(playlist.id, [track])
  },

  appendTracksToAppPlaylist: async (playlistId, tracks) => {
    if (tracks.length === 0) return
    const existing = await db.playlists.get(playlistId)
    if (!existing || existing.kind !== 'app') return

    const nextItems = [...existing.items, ...tracks.map(trackToPlaylistItem)]
    const now = Date.now()

    await db.transaction('rw', db.playlists, db.tracks, async () => {
      await db.playlists.put({
        ...existing,
        items: nextItems,
        updatedAt: now,
        trackCount: nextItems.length,
      })

      await db.tracks.bulkPut(
        tracks.map((track) => ({
          ...track,
          addedAt: track.addedAt || now,
        })),
      )
    })

    await Promise.all([
      get().loadPlaylists(),
      useLibraryStore.getState().loadTracks(),
    ])
  },

  removeTrackFromPlaylist: async (playlist, item, index = 0) => {
    if (playlist.kind === 'tidal') {
      if (item.source !== 'tidal' || !playlist.providerPlaylistId) return
      const detail = await removeTrackFromTidalPlaylist(playlist.providerPlaylistId, item.providerTrackId)
      await useLibraryStore.getState().cacheTidalTracks(detail.tracks)
      set(state => ({
        tidalPlaylistDetails: {
          ...state.tidalPlaylistDetails,
          [playlist.providerPlaylistId!]: { playlist: detail, tracks: detail.tracks },
        },
      }))
      await get().loadPlaylists()
      return
    }

    const existing = await db.playlists.get(playlist.id)
    if (!existing) return
    const nextItems = existing.items.filter((_, itemIndex) => itemIndex !== index)
    await db.playlists.put({
      ...existing,
      items: nextItems,
      updatedAt: Date.now(),
      trackCount: nextItems.length,
    })
    await get().loadPlaylists()
  },

  moveAppPlaylistItem: async (playlistId, fromIndex, toIndex) => {
    const playlist = await db.playlists.get(playlistId)
    if (!playlist || playlist.kind !== 'app') return
    if (toIndex < 0 || toIndex >= playlist.items.length) return

    const items = [...playlist.items]
    const [moved] = items.splice(fromIndex, 1)
    items.splice(toIndex, 0, moved)

    await db.playlists.put({
      ...playlist,
      items,
      updatedAt: Date.now(),
    })
    await get().loadPlaylists()
  },

  createProviderPlaylist: async (name, description = '') => {
    const playlist = await createTidalPlaylist(name, description)
    await get().loadPlaylists()
    return playlist
  },

  bulkImportAppPlaylists: async (playlists, mode) => {
    const existingApp = await readAppPlaylists()
    const byName = new Map<string, Playlist>()
    for (const existing of existingApp) {
      byName.set(existing.name.toLowerCase(), existing)
    }

    const toPut: Playlist[] = []
    const toDelete: string[] = []
    let created = 0
    let merged = 0
    let replaced = 0
    let skipped = 0

    for (const incoming of playlists) {
      const existing = byName.get(incoming.name.toLowerCase())
      if (!existing) {
        toPut.push(incoming)
        created += 1
        continue
      }

      if (mode === 'skip') {
        skipped += 1
        continue
      }

      if (mode === 'replace') {
        toDelete.push(existing.id)
        toPut.push(incoming)
        replaced += 1
        continue
      }

      // merge: keep existing playlist id, append new items, dedupe
      const existingKeys = new Set(
        existing.items.map((item) =>
          item.source === 'tidal' ? `tidal:${item.providerTrackId}` : `local:${item.trackId}`,
        ),
      )
      const additions = incoming.items.filter((item) => {
        const key = item.source === 'tidal' ? `tidal:${item.providerTrackId}` : `local:${item.trackId}`
        if (existingKeys.has(key)) return false
        existingKeys.add(key)
        return true
      })
      if (additions.length === 0) {
        skipped += 1
        continue
      }
      const nextItems = [...existing.items, ...additions]
      toPut.push({
        ...existing,
        description: existing.description || incoming.description,
        items: nextItems,
        updatedAt: Date.now(),
        trackCount: nextItems.length,
      })
      merged += 1
    }

    if (toDelete.length > 0) {
      await db.playlists.bulkDelete(toDelete)
    }
    if (toPut.length > 0) {
      await db.playlists.bulkPut(toPut)
    }
    await get().loadPlaylists()
    return { created, merged, replaced, skipped }
  },
}))
