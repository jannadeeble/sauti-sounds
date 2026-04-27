import { create } from 'zustand'
import type { RectLike } from '../lib/rect'
import type { PersistedPlaybackState, PersistedQueueItem, PlaybackContext, SelectedPlaylist, Track } from '../types'

export type { PlaybackContext, SelectedPlaylist } from '../types'

interface SyncedPlayerState {
  currentTrack: Track | null
  currentIndex: number
  isPlaying: boolean
  currentTime: number
  duration: number
}

interface PlaybackSessionState extends SyncedPlayerState {
  context: PlaybackContext
  loadingTrackId: string | null
  tracks: Track[]
  startIndex: number
  requestedTrackId: string | null
  sessionId: number
  playerOpen: boolean
  playerOpenOriginRect: RectLike | null
  selectedPlaylist?: SelectedPlaylist
  errorMessage: string | null
  playTracks: (tracks: Track[], context: PlaybackContext, startIndex?: number) => void
  playPlaylist: (kind: 'app' | 'tidal', id: string, tracks: Track[], startIndex?: number) => void
  appendTrack: (track: Track) => void
  reorderTracks: (from: number, to: number) => void
  removeQueuedTrack: (trackId: string) => void
  selectPlaylist: (playlist?: SelectedPlaylist) => void
  clearSession: () => void
  setPlayerOpen: (open: boolean, originRect?: RectLike | null) => void
  setErrorMessage: (message: string | null) => void
  restorePersistedSession: (snapshot: PersistedPlaybackState | null | undefined, libraryTracks: Track[]) => void
  syncPlayerState: (state: Partial<SyncedPlayerState>) => void
}

const initialSyncedState: SyncedPlayerState = {
  currentTrack: null,
  currentIndex: -1,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
}

function normalizeStartIndex(tracks: Track[], startIndex: number) {
  if (tracks.length === 0) return 0
  return Math.max(0, Math.min(startIndex, tracks.length - 1))
}

function serializeTrack(track: Track): PersistedQueueItem {
  const snapshot = Object.fromEntries(
    Object.entries(track).filter(([key]) => !['audioBlob', 'artworkBlob', 'fileHandle', 'waveformData'].includes(key)),
  ) as PersistedQueueItem['track']

  return {
    id: track.id,
    source: track.source,
    providerTrackId: track.providerTrackId,
    track: snapshot,
  }
}

function resolvePersistedTrack(item: PersistedQueueItem, libraryTracks: Track[]): Track | null {
  const match = libraryTracks.find((track) => {
    if (track.id === item.id) return true
    return Boolean(item.providerTrackId && track.providerTrackId === item.providerTrackId)
  })
  if (match) return match

  if (!item.track?.id || !item.track.title || !item.track.artist || !item.track.source) {
    return null
  }
  return {
    ...item.track,
    album: item.track.album ?? '',
    duration: item.track.duration ?? 0,
  }
}

export function buildPersistedPlaybackState(state: PlaybackSessionState): PersistedPlaybackState | null {
  if (state.tracks.length === 0) return null
  return {
    context: state.context,
    queue: state.tracks.map(serializeTrack),
    currentTrackId: state.currentTrack?.id ?? state.requestedTrackId ?? state.tracks[state.startIndex]?.id ?? null,
    currentIndex: state.currentIndex >= 0 ? state.currentIndex : state.startIndex,
    currentTime: Math.max(0, Math.floor(state.currentTime || 0)),
    duration: Math.max(0, Math.floor(state.duration || 0)),
    wasPlaying: state.isPlaying,
    selectedPlaylist: state.selectedPlaylist,
    updatedAt: Date.now(),
  }
}

export const usePlaybackSessionStore = create<PlaybackSessionState>((set) => ({
  ...initialSyncedState,
  context: 'library',
  loadingTrackId: null,
  tracks: [],
  startIndex: 0,
  requestedTrackId: null,
  sessionId: 0,
  playerOpen: false,
  playerOpenOriginRect: null,
  selectedPlaylist: undefined,
  errorMessage: null,

  playTracks: (tracks, context, startIndex = 0) => {
    const nextIndex = normalizeStartIndex(tracks, startIndex)
    set((state) => ({
      context,
      loadingTrackId: tracks[nextIndex]?.id ?? null,
      tracks,
      startIndex: nextIndex,
      requestedTrackId: tracks[nextIndex]?.id ?? null,
      sessionId: state.sessionId + 1,
      errorMessage: null,
      ...initialSyncedState,
      isPlaying: true,
    }))
  },

  playPlaylist: (kind, id, tracks, startIndex = 0) => {
    const nextIndex = normalizeStartIndex(tracks, startIndex)
    set((state) => ({
      selectedPlaylist: { kind, id },
      context: kind === 'app' ? 'app-playlist' : 'tidal-playlist',
      loadingTrackId: tracks[nextIndex]?.id ?? null,
      tracks,
      startIndex: nextIndex,
      requestedTrackId: tracks[nextIndex]?.id ?? null,
      sessionId: state.sessionId + 1,
      errorMessage: null,
      ...initialSyncedState,
      isPlaying: true,
    }))
  },

  appendTrack: (track) => {
    set((state) => {
      if (state.tracks.some((queuedTrack) => queuedTrack.id === track.id)) {
        return state
      }

      return {
        tracks: [...state.tracks, track],
      }
    })
  },

  reorderTracks: (from, to) => {
    set((state) => {
      if (from === to || from < 0 || to < 0 || from >= state.tracks.length || to >= state.tracks.length) {
        return state
      }
      const next = [...state.tracks]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      const currentId = state.currentTrack?.id
      const nextIndex = currentId ? next.findIndex((track) => track.id === currentId) : state.currentIndex
      return {
        tracks: next,
        currentIndex: nextIndex >= 0 ? nextIndex : state.currentIndex,
      }
    })
  },

  removeQueuedTrack: (trackId) => {
    set((state) => {
      const next = state.tracks.filter((track) => track.id !== trackId)
      if (next.length === state.tracks.length) return state
      const currentId = state.currentTrack?.id
      const nextIndex = currentId ? next.findIndex((track) => track.id === currentId) : state.currentIndex
      return {
        tracks: next,
        currentIndex: nextIndex >= 0 ? nextIndex : state.currentIndex,
      }
    })
  },

  selectPlaylist: (selectedPlaylist) => {
    set({ selectedPlaylist })
  },

  clearSession: () => {
    set({
      ...initialSyncedState,
      tracks: [],
      loadingTrackId: null,
      startIndex: 0,
      requestedTrackId: null,
      errorMessage: null,
    })
  },

  setPlayerOpen: (playerOpen, originRect = null) => {
    set({
      playerOpen,
      playerOpenOriginRect: playerOpen ? originRect : null,
    })
  },

  setErrorMessage: (errorMessage) => {
    set({
      errorMessage,
      ...(errorMessage ? { loadingTrackId: null } : {}),
    })
  },

  restorePersistedSession: (snapshot, libraryTracks) => {
    if (!snapshot?.queue?.length) return
    set((state) => {
      if (state.tracks.length > 0) return state

      const tracks = snapshot.queue
        .map((item) => resolvePersistedTrack(item, libraryTracks))
        .filter((track): track is Track => Boolean(track))
      if (tracks.length === 0) return state

      const persistedIndex = Math.max(0, Math.min(snapshot.currentIndex, tracks.length - 1))
      const currentIndex = snapshot.currentTrackId
        ? Math.max(0, tracks.findIndex((track) => track.id === snapshot.currentTrackId))
        : persistedIndex
      const startIndex = currentIndex >= 0 ? currentIndex : persistedIndex
      const currentTrack = tracks[startIndex] ?? null

      return {
        context: snapshot.context,
        currentTrack,
        currentIndex: startIndex,
        currentTime: snapshot.currentTime,
        duration: snapshot.duration,
        isPlaying: false,
        loadingTrackId: currentTrack?.id ?? null,
        tracks,
        startIndex,
        requestedTrackId: currentTrack?.id ?? null,
        sessionId: state.sessionId + 1,
        selectedPlaylist: snapshot.selectedPlaylist,
        errorMessage: null,
      }
    })
  },

  syncPlayerState: (state) => {
    set((current) => ({
      currentTrack: state.currentTrack ?? current.currentTrack,
      currentIndex: state.currentIndex ?? current.currentIndex,
      isPlaying: state.isPlaying ?? current.isPlaying,
      currentTime: state.currentTime ?? current.currentTime,
      duration: state.duration ?? current.duration,
      loadingTrackId: state.currentTrack?.id === current.loadingTrackId ? null : current.loadingTrackId,
    }))
  },
}))
