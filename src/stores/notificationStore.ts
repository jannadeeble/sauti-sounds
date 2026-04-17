import { create } from 'zustand'

export type NotificationLevel = 'info' | 'success' | 'warning'

export interface Notification {
  id: string
  level: NotificationLevel
  title: string
  body?: string
  createdAt: number
  meta?: Record<string, unknown>
  read: boolean
}

interface NotificationState {
  notifications: Notification[]
  push: (input: Omit<Notification, 'id' | 'createdAt' | 'read'>) => void
  markAllRead: () => void
  dismiss: (id: string) => void
  clear: () => void
  unreadCount: () => number
}

function newId() {
  return `notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],
  push: (input) => {
    const notification: Notification = {
      ...input,
      id: newId(),
      createdAt: Date.now(),
      read: false,
    }
    set((state) => ({ notifications: [notification, ...state.notifications].slice(0, 50) }))
  },
  markAllRead: () => {
    set((state) => ({ notifications: state.notifications.map((n) => ({ ...n, read: true })) }))
  },
  dismiss: (id) => {
    set((state) => ({ notifications: state.notifications.filter((n) => n.id !== id) }))
  },
  clear: () => set({ notifications: [] }),
  unreadCount: () => get().notifications.filter((n) => !n.read).length,
}))
