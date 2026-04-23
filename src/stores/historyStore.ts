import { create } from 'zustand'
import { db } from '../db'
import { hydrateAppStateFromBackend, pushAppStateSnapshot } from '../lib/appStateSync'
import type { HistoryEntry, Track } from '../types'

const MAX_HISTORY = 500
const MIN_GAP_MS = 30_000

interface HistoryState {
  entries: HistoryEntry[]
  loaded: boolean
  loadHistory: () => Promise<void>
  recordPlay: (track: Track) => Promise<void>
  clear: () => Promise<void>
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  entries: [],
  loaded: false,

  loadHistory: async () => {
    await hydrateAppStateFromBackend()
    const entries = await db.history.orderBy('playedAt').reverse().limit(MAX_HISTORY).toArray()
    set({ entries, loaded: true })
  },

  recordPlay: async (track) => {
    const now = Date.now()
    const last = get().entries[0]
    if (last && last.trackId === track.id && now - last.playedAt < MIN_GAP_MS) return

    const entry: HistoryEntry = {
      id: `${track.id}-${now}`,
      trackId: track.id,
      playedAt: now,
      source: track.source,
      title: track.title,
      artist: track.artist,
      album: track.album,
      duration: track.duration,
      providerTrackId: track.providerTrackId,
      artworkUrl: track.artworkUrl,
    }

    await db.history.put(entry)

    const total = await db.history.count()
    if (total > MAX_HISTORY) {
      const excess = await db.history.orderBy('playedAt').limit(total - MAX_HISTORY).primaryKeys()
      await db.history.bulkDelete(excess)
    }

    await pushAppStateSnapshot()
    await get().loadHistory()
  },

  clear: async () => {
    await db.history.clear()
    await pushAppStateSnapshot()
    set({ entries: [] })
  },
}))
