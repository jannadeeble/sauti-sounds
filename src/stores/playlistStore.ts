import { create } from 'zustand'
import { db } from '../db'
import {
  addTracksToTidalPlaylist,
  createTidalPlaylist,
  getTidalPlaylist,
  getTidalPlaylists,
  removeTrackFromTidalPlaylist,
} from '../lib/tidal'
import type { Playlist, PlaylistItem, Track } from '../types'
import { useLibraryStore } from './libraryStore'
import { useTidalStore } from './tidalStore'

interface PlaylistDetail {
  playlist: Playlist
  tracks: Track[]
}

interface PlaylistState {
  appPlaylists: Playlist[]
  tidalPlaylists: Playlist[]
  tidalPlaylistDetails: Record<string, PlaylistDetail>
  loading: boolean
  loadPlaylists: () => Promise<void>
  loadTidalPlaylistDetail: (providerPlaylistId: string) => Promise<PlaylistDetail>
  createAppPlaylist: (name: string, description?: string) => Promise<Playlist>
  renameAppPlaylist: (id: string, name: string, description?: string) => Promise<void>
  deleteAppPlaylist: (id: string) => Promise<void>
  addTrackToPlaylist: (playlist: Playlist, track: Track) => Promise<void>
  appendItemsToPlaylist: (playlistId: string, tracks: Track[]) => Promise<void>
  removeTrackFromPlaylist: (playlist: Playlist, item: PlaylistItem, index?: number) => Promise<void>
  moveAppPlaylistItem: (playlistId: string, fromIndex: number, toIndex: number) => Promise<void>
  createProviderPlaylist: (name: string, description?: string) => Promise<Playlist>
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
  tidalPlaylists: [],
  tidalPlaylistDetails: {},
  loading: false,

  loadPlaylists: async () => {
    set({ loading: true })
    try {
      const appPlaylists = (await readAppPlaylists()).reverse()
      const tidalPlaylists = useTidalStore.getState().tidalConnected
        ? await getTidalPlaylists()
        : []
      set({ appPlaylists, tidalPlaylists, loading: false })
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

  createAppPlaylist: async (name, description = '') => {
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

    const existing = await db.playlists.get(playlist.id)
    if (!existing) return
    const nextItems = [...existing.items, trackToPlaylistItem(track)]
    await db.playlists.put({
      ...existing,
      items: nextItems,
      updatedAt: Date.now(),
      trackCount: nextItems.length,
    })
    await useLibraryStore.getState().addTrack(track)
    await get().loadPlaylists()
  },

  appendItemsToPlaylist: async (playlistId, tracks) => {
    if (tracks.length === 0) return
    const playlist = await db.playlists.get(playlistId)
    if (!playlist) return

    if (playlist.kind === 'tidal' && playlist.providerPlaylistId) {
      const tidalTrackIds = tracks
        .filter((track) => track.source === 'tidal' && track.providerTrackId)
        .map((track) => track.providerTrackId as string)
      if (tidalTrackIds.length === 0) return
      const detail = await addTracksToTidalPlaylist(playlist.providerPlaylistId, tidalTrackIds)
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

    const tidalTracks = tracks.filter((t) => t.source === 'tidal')
    if (tidalTracks.length > 0) {
      await useLibraryStore.getState().cacheTidalTracks(tidalTracks)
    }

    const items = [...playlist.items, ...tracks.map(trackToPlaylistItem)]
    await db.playlists.put({
      ...playlist,
      items,
      updatedAt: Date.now(),
      trackCount: items.length,
    })
    await get().loadPlaylists()
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
}))
