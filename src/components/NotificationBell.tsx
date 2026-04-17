import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Bell, Check, CheckCircle2, Info, Trash2, XCircle } from 'lucide-react'
import { useNotificationStore } from '../stores/notificationStore'
import type { AppNotification, NotificationKind } from '../types'

function formatRelative(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

function kindIcon(kind: NotificationKind) {
  switch (kind) {
    case 'success': return <CheckCircle2 size={16} className="text-green-500" />
    case 'warning': return <AlertTriangle size={16} className="text-amber-500" />
    case 'error': return <XCircle size={16} className="text-red-500" />
    default: return <Info size={16} className="text-[#7a7b86]" />
  }
}

export default function NotificationBell() {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  const notifications = useNotificationStore(state => state.notifications)
  const loadNotifications = useNotificationStore(state => state.loadNotifications)
  const markRead = useNotificationStore(state => state.markRead)
  const markAllRead = useNotificationStore(state => state.markAllRead)
  const remove = useNotificationStore(state => state.remove)
  const clearAll = useNotificationStore(state => state.clearAll)

  useEffect(() => {
    void loadNotifications()
  }, [loadNotifications])

  useEffect(() => {
    if (!open) return
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  const unreadCount = notifications.filter(n => !n.readAt).length

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-label={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : 'Notifications'}
        title="Notifications"
        onClick={() => setOpen(value => !value)}
        className="relative inline-flex h-10 w-10 items-center justify-center rounded-full border border-black/8 bg-white text-[#111116] transition-colors hover:border-black/12 hover:bg-[#f8f8f9] sm:h-11 sm:w-11"
      >
        <Bell size={16} />
        {unreadCount > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-[#ef5466] px-1 text-[10px] font-semibold leading-none text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 z-50 mt-2 w-[20rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-black/8 bg-white shadow-[0_12px_40px_rgba(17,17,22,0.12)]">
          <div className="flex items-center justify-between border-b border-black/6 px-4 py-3">
            <p className="text-sm font-semibold text-[#111116]">Notifications</p>
            <div className="flex items-center gap-2">
              {unreadCount > 0 ? (
                <button
                  type="button"
                  onClick={() => void markAllRead()}
                  className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs text-[#7a7b86] transition-colors hover:bg-[#f4f4f6] hover:text-[#111116]"
                >
                  <Check size={12} /> Mark all read
                </button>
              ) : null}
              {notifications.length > 0 ? (
                <button
                  type="button"
                  aria-label="Clear all notifications"
                  title="Clear all"
                  onClick={() => void clearAll()}
                  className="inline-flex items-center justify-center rounded-full p-1 text-[#7a7b86] transition-colors hover:bg-[#f4f4f6] hover:text-[#111116]"
                >
                  <Trash2 size={12} />
                </button>
              ) : null}
            </div>
          </div>

          <div className="max-h-[60vh] overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-[#8c8d96]">You're all caught up.</div>
            ) : (
              <ul className="divide-y divide-black/6">
                {notifications.map(n => (
                  <NotificationItem
                    key={n.id}
                    notification={n}
                    onMarkRead={() => void markRead(n.id)}
                    onRemove={() => void remove(n.id)}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function NotificationItem({
  notification,
  onMarkRead,
  onRemove,
}: {
  notification: AppNotification
  onMarkRead: () => void
  onRemove: () => void
}) {
  const unread = !notification.readAt
  return (
    <li
      onClick={unread ? onMarkRead : undefined}
      className={`group flex gap-3 px-4 py-3 transition-colors ${
        unread ? 'cursor-pointer bg-[#fff4f6]/50 hover:bg-[#fff4f6]' : 'hover:bg-[#fafafb]'
      }`}
    >
      <div className="mt-0.5 shrink-0">{kindIcon(notification.kind)}</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className={`text-sm ${unread ? 'font-semibold text-[#111116]' : 'text-[#3f4049]'}`}>
            {notification.title}
          </p>
          <span className="shrink-0 text-[10px] text-[#9a9ba4]">
            {formatRelative(notification.createdAt)}
          </span>
        </div>
        {notification.body ? (
          <p className="mt-1 text-xs text-[#7a7b86]">{notification.body}</p>
        ) : null}
      </div>
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={(event) => {
          event.stopPropagation()
          onRemove()
        }}
        className="shrink-0 self-start rounded-full p-1 text-[#b4b6c0] opacity-0 transition-opacity hover:bg-[#f4f4f6] hover:text-[#111116] group-hover:opacity-100"
      >
        <XCircle size={14} />
      </button>
    </li>
  )
}
