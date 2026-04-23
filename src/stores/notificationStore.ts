import { create } from 'zustand'
import { db } from '../db'
import { hydrateAppStateFromBackend, pushAppStateSnapshot } from '../lib/appStateSync'
import type { AppNotification, NotificationKind } from '../types'

interface NotificationInput {
  kind?: NotificationKind
  title: string
  body?: string
}

interface NotificationState {
  notifications: AppNotification[]
  loadNotifications: () => Promise<void>
  push: (input: NotificationInput) => Promise<AppNotification>
  markRead: (id: string) => Promise<void>
  markAllRead: () => Promise<void>
  remove: (id: string) => Promise<void>
  clearAll: () => Promise<void>
}

async function readAll(): Promise<AppNotification[]> {
  return db.notifications.orderBy('createdAt').reverse().toArray()
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],

  loadNotifications: async () => {
    await hydrateAppStateFromBackend()
    const notifications = await readAll()
    set({ notifications })
  },

  push: async (input) => {
    const now = Date.now()
    const notification: AppNotification = {
      id: `notif-${now}-${Math.random().toString(36).slice(2, 8)}`,
      kind: input.kind ?? 'info',
      title: input.title,
      body: input.body,
      createdAt: now,
    }
    await db.notifications.put(notification)
    await pushAppStateSnapshot()
    set({ notifications: [notification, ...get().notifications] })
    return notification
  },

  markRead: async (id) => {
    const existing = await db.notifications.get(id)
    if (!existing || existing.readAt) return
    const updated = { ...existing, readAt: Date.now() }
    await db.notifications.put(updated)
    await pushAppStateSnapshot()
    set({
      notifications: get().notifications.map(n => n.id === id ? updated : n),
    })
  },

  markAllRead: async () => {
    const now = Date.now()
    const unread = get().notifications.filter(n => !n.readAt)
    if (unread.length === 0) return
    const updated = unread.map(n => ({ ...n, readAt: now }))
    await db.notifications.bulkPut(updated)
    await pushAppStateSnapshot()
    set({
      notifications: get().notifications.map(n => n.readAt ? n : { ...n, readAt: now }),
    })
  },

  remove: async (id) => {
    await db.notifications.delete(id)
    await pushAppStateSnapshot()
    set({ notifications: get().notifications.filter(n => n.id !== id) })
  },

  clearAll: async () => {
    await db.notifications.clear()
    await pushAppStateSnapshot()
    set({ notifications: [] })
  },
}))
