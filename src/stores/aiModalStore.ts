import { create } from 'zustand'
import type { Track } from '../types'

export type AIModalKind = 'setlist-seed' | 'playlist-from-track'

interface AIModalState {
  kind: AIModalKind | null
  seed: Track | null
  selection: Track[] | null
  open: (kind: AIModalKind, seed: Track, selection?: Track[]) => void
  close: () => void
}

export const useAIModalStore = create<AIModalState>((set) => ({
  kind: null,
  seed: null,
  selection: null,
  open: (kind, seed, selection) => set({ kind, seed, selection: selection ?? null }),
  close: () => set({ kind: null, seed: null, selection: null }),
}))
