import { create } from 'zustand'
import { db } from '../db'
import { tagTrackContexts } from '../lib/listenContextRegistry'
import type { Mix, MixKind, MixStatus } from '../types'

interface MixState {
  mixes: Mix[]
  loading: boolean
  load: () => Promise<void>
  upsert: (mix: Mix) => Promise<void>
  setStatus: (id: string, status: MixStatus) => Promise<void>
  dismiss: (id: string) => Promise<void>
  markSaved: (id: string) => Promise<void>
  markStale: (kinds?: MixKind[]) => Promise<void>
  remove: (id: string) => Promise<void>
  freshByKind: (kind: MixKind) => Mix[]
}

export const useMixStore = create<MixState>((set, get) => ({
  mixes: [],
  loading: false,

  load: async () => {
    set({ loading: true })
    const all = await db.mixes.orderBy('generatedAt').reverse().toArray()
    for (const m of all) {
      if (m.status === 'fresh') {
        tagTrackContexts(m.trackIds, `suggestion:${m.id}` as const)
      }
    }
    set({ mixes: all, loading: false })
  },

  upsert: async (mix) => {
    await db.mixes.put(mix)
    tagTrackContexts(mix.trackIds, `suggestion:${mix.id}` as const)
    const existing = get().mixes.filter(m => m.id !== mix.id)
    set({ mixes: [mix, ...existing] })
  },

  setStatus: async (id, status) => {
    const existing = await db.mixes.get(id)
    if (!existing) return
    const updated: Mix = { ...existing, status }
    await db.mixes.put(updated)
    set({ mixes: get().mixes.map(m => m.id === id ? updated : m) })
  },

  dismiss: async (id) => {
    await get().setStatus(id, 'dismissed')
  },

  markSaved: async (id) => {
    await get().setStatus(id, 'saved')
  },

  markStale: async (kinds) => {
    const target = get().mixes.filter(
      m => m.status === 'fresh' && (!kinds || kinds.includes(m.kind)),
    )
    for (const m of target) {
      const updated = { ...m, status: 'stale' as MixStatus }
      await db.mixes.put(updated)
    }
    set({
      mixes: get().mixes.map(m =>
        target.find(t => t.id === m.id) ? { ...m, status: 'stale' } : m,
      ),
    })
  },

  remove: async (id) => {
    await db.mixes.delete(id)
    set({ mixes: get().mixes.filter(m => m.id !== id) })
  },

  freshByKind: (kind) => {
    return get().mixes.filter(m => m.kind === kind && m.status === 'fresh')
  },
}))
