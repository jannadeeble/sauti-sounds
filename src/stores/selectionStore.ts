import { create } from 'zustand'

interface SelectionState {
  selecting: boolean
  selectedIds: Set<string>
  enter: (initialId?: string) => void
  toggle: (id: string) => void
  setMany: (ids: string[]) => void
  clear: () => void
  exit: () => void
}

export const useSelectionStore = create<SelectionState>((set) => ({
  selecting: false,
  selectedIds: new Set<string>(),

  enter: (initialId) => {
    set(() => ({
      selecting: true,
      selectedIds: initialId ? new Set([initialId]) : new Set<string>(),
    }))
  },

  toggle: (id) => {
    set((state) => {
      const next = new Set(state.selectedIds)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { selectedIds: next }
    })
  },

  setMany: (ids) => {
    set(() => ({ selectedIds: new Set(ids) }))
  },

  clear: () => {
    set(() => ({ selectedIds: new Set<string>() }))
  },

  exit: () => {
    set(() => ({ selecting: false, selectedIds: new Set<string>() }))
  },
}))
