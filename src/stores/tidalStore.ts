import { create } from 'zustand'
import {
  getTidalLoginStatus,
  getTidalSession,
  logoutTidal,
  startTidalLogin,
  type TidalUser,
} from '../lib/tidal'
import { ApiError } from '../lib/api'

interface TidalStoreState {
  backendAvailable: boolean
  tidalConnected: boolean
  tidalUser: TidalUser | null
  loading: boolean
  connecting: boolean
  initialize: () => Promise<void>
  refresh: () => Promise<void>
  reset: () => void
  connectTidal: () => Promise<void>
  disconnectTidal: () => Promise<void>
}

export const useTidalStore = create<TidalStoreState>((set, get) => ({
  backendAvailable: true,
  tidalConnected: false,
  tidalUser: null,
  loading: false,
  connecting: false,

  initialize: async () => {
    set({ loading: true })
    try {
      const tidalSession = await getTidalSession()
      set({
        backendAvailable: true,
        tidalConnected: tidalSession.connected,
        tidalUser: tidalSession.user,
        loading: false,
      })
    } catch (error) {
      const backendAvailable = error instanceof ApiError ? error.status !== 0 : false
      set({
        backendAvailable,
        tidalConnected: false,
        tidalUser: null,
        loading: false,
      })
    }
  },

  refresh: async () => {
    await get().initialize()
  },

  reset: () => {
    set({
      backendAvailable: true,
      tidalConnected: false,
      tidalUser: null,
      loading: false,
      connecting: false,
    })
  },

  connectTidal: async () => {
    set({ connecting: true })
    try {
      const start = await startTidalLogin()
      const externalUrl = start.verificationUriComplete.startsWith('http')
        ? start.verificationUriComplete
        : `https://${start.verificationUriComplete.replace(/^\/+/, '')}`
      window.open(externalUrl, '_blank', 'noopener,noreferrer')

      let done = false
      while (!done) {
        await new Promise(resolve => setTimeout(resolve, Math.max(start.interval, 2) * 1000))
        const status = await getTidalLoginStatus(start.attemptId)
        if (status.status === 'connected' && status.connected) {
          done = true
          set({
            tidalConnected: true,
            tidalUser: status.user || null,
            backendAvailable: true,
            connecting: false,
          })
        } else if (status.status === 'error' || status.status === 'missing') {
          throw new Error(status.error || 'Failed to connect TIDAL')
        }
      }
    } finally {
      set({ connecting: false })
    }
  },

  disconnectTidal: async () => {
    await logoutTidal()
    set({ tidalConnected: false, tidalUser: null })
  },
}))
