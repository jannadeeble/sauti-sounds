import { create } from 'zustand'
import type { AppUser } from '../types'
import {
  getAuthSession,
  loginAuth,
  logoutAuth,
  registerAuth,
  type AuthLoginPayload,
  type AuthRegisterPayload,
} from '../lib/auth'

interface AuthStoreState {
  available: boolean
  loading: boolean
  submitting: boolean
  authenticated: boolean
  user: AppUser | null
  canRegister: boolean
  userCount: number
  maxUsers: number
  requiresInviteCode: boolean
  initialize: () => Promise<void>
  login: (payload: AuthLoginPayload) => Promise<void>
  register: (payload: AuthRegisterPayload) => Promise<void>
  logout: () => Promise<void>
}

function applySession(
  set: (partial: Partial<AuthStoreState>) => void,
  session: {
    authenticated: boolean
    user: AppUser | null
    canRegister: boolean
    userCount: number
    maxUsers: number
    requiresInviteCode: boolean
  },
) {
  set({
    available: true,
    authenticated: session.authenticated,
    user: session.user,
    canRegister: session.canRegister,
    userCount: session.userCount,
    maxUsers: session.maxUsers,
    requiresInviteCode: session.requiresInviteCode,
  })
}

export const useAuthStore = create<AuthStoreState>((set) => ({
  available: true,
  loading: false,
  submitting: false,
  authenticated: false,
  user: null,
  canRegister: false,
  userCount: 0,
  maxUsers: 2,
  requiresInviteCode: false,

  initialize: async () => {
    set({ loading: true })
    try {
      const session = await getAuthSession()
      applySession(set, session)
    } catch {
      set({
        available: false,
        authenticated: false,
        user: null,
      })
    } finally {
      set({ loading: false })
    }
  },

  login: async (payload) => {
    set({ submitting: true })
    try {
      const session = await loginAuth(payload)
      applySession(set, session)
    } finally {
      set({ submitting: false })
    }
  },

  register: async (payload) => {
    set({ submitting: true })
    try {
      const session = await registerAuth(payload)
      applySession(set, session)
    } finally {
      set({ submitting: false })
    }
  },

  logout: async () => {
    set({ submitting: true })
    try {
      const session = await logoutAuth()
      applySession(set, session)
    } finally {
      set({ submitting: false })
    }
  },
}))
