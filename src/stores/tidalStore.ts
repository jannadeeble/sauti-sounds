import { create } from 'zustand'
import {
  getAppSession,
  getTidalLoginStatus,
  getTidalSession,
  loginApp,
  logoutApp,
  logoutTidal,
  startTidalLogin,
  type TidalUser,
} from '../lib/tidal'

interface TidalStoreState {
  backendAvailable: boolean
  backendAuthenticated: boolean
  tidalConnected: boolean
  tidalUser: TidalUser | null
  loading: boolean
  connecting: boolean
  initialize: () => Promise<void>
  refresh: () => Promise<void>
  loginToBackend: (password: string) => Promise<void>
  logoutFromBackend: () => Promise<void>
  connectTidal: () => Promise<void>
  disconnectTidal: () => Promise<void>
}

export const useTidalStore = create<TidalStoreState>((set, get) => ({
  backendAvailable: true,
  backendAuthenticated: false,
  tidalConnected: false,
  tidalUser: null,
  loading: false,
  connecting: false,

  initialize: async () => {
    set({ loading: true })
    try {
      const appSession = await getAppSession()
      if (!appSession.authenticated) {
        set({
          backendAvailable: true,
          backendAuthenticated: false,
          tidalConnected: false,
          tidalUser: null,
          loading: false,
        })
        return
      }

      const tidalSession = await getTidalSession()
      set({
        backendAvailable: true,
        backendAuthenticated: true,
        tidalConnected: tidalSession.connected,
        tidalUser: tidalSession.user,
        loading: false,
      })
    } catch {
      set({
        backendAvailable: false,
        backendAuthenticated: false,
        tidalConnected: false,
        tidalUser: null,
        loading: false,
      })
    }
  },

  refresh: async () => {
    await get().initialize()
  },

  loginToBackend: async (password) => {
    set({ loading: true })
    await loginApp(password)
    await get().initialize()
  },

  logoutFromBackend: async () => {
    await logoutApp()
    set({
      backendAuthenticated: false,
      tidalConnected: false,
      tidalUser: null,
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
            backendAuthenticated: true,
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
