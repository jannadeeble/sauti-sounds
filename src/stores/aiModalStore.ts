import { create } from 'zustand'
import type { RectLike } from '../lib/rect'
import type { Track } from '../types'

export type AIModalKind = 'setlist-seed' | 'playlist-from-track'

interface AIModalState {
  kind: AIModalKind | null
  seed: Track | null
  selection: Track[] | null
  originRect: RectLike | null
  open: (kind: AIModalKind, seed: Track, selection?: Track[], originRect?: RectLike | null) => void
  close: () => void
}

export const useAIModalStore = create<AIModalState>((set) => ({
  kind: null,
  seed: null,
  selection: null,
  originRect: null,
  open: (kind, seed, selection, originRect = null) => set({ kind, seed, selection: selection ?? null, originRect }),
  close: () => set({ kind: null, seed: null, selection: null, originRect: null }),
}))
