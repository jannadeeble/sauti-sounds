import { create } from 'zustand'
import { db } from '../db'
import { buildTasteProfile } from '../lib/llm'
import type { TasteProfile, TasteProfileRecord, Track } from '../types'

const REBUILD_THRESHOLD = 20

interface TasteState {
  profile: TasteProfile | null
  builtAt: number | null
  builtFromTrackCount: number | null
  loading: boolean
  rebuilding: boolean
  load: () => Promise<void>
  rebuild: (tracks: Track[]) => Promise<void>
  maybeAutoRebuild: (tracks: Track[]) => Promise<void>
}

export const useTasteStore = create<TasteState>((set, get) => ({
  profile: null,
  builtAt: null,
  builtFromTrackCount: null,
  loading: false,
  rebuilding: false,

  load: async () => {
    set({ loading: true })
    const record = await db.tasteProfile.get('current')
    if (record) {
      set({
        profile: record.profile,
        builtAt: record.builtAt,
        builtFromTrackCount: record.builtFromTrackCount,
      })
    }
    set({ loading: false })
  },

  rebuild: async (tracks) => {
    if (get().rebuilding) return
    set({ rebuilding: true })
    try {
      const tagged = tracks.filter(t => !!t.tags)
      const source = tagged.length >= 20 ? tagged : tracks
      if (source.length < 5) return
      const profile = await buildTasteProfile(source)
      const record: TasteProfileRecord = {
        id: 'current',
        profile,
        builtAt: Date.now(),
        builtFromTrackCount: source.length,
      }
      await db.tasteProfile.put(record)
      set({
        profile,
        builtAt: record.builtAt,
        builtFromTrackCount: record.builtFromTrackCount,
      })
    } finally {
      set({ rebuilding: false })
    }
  },

  maybeAutoRebuild: async (tracks) => {
    const state = get()
    const tagged = tracks.filter(t => !!t.tags)
    if (tagged.length < 20) return
    if (!state.profile) {
      await get().rebuild(tracks)
      return
    }
    const delta = tagged.length - (state.builtFromTrackCount ?? 0)
    if (delta >= REBUILD_THRESHOLD) {
      await get().rebuild(tracks)
    }
  },
}))
