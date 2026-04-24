import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Bell, Check, CheckCircle2, Info, Trash2, XCircle } from 'lucide-react'
import { rectFromElement } from '../lib/rect'
import { useNotificationStore } from '../stores/notificationStore'
import type { AppNotification, NotificationKind } from '../types'
import MorphSurface from './MorphSurface'

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

export default function NotificationBell({
  buttonClassName = 'sauti-glass-button relative sm:h-11 sm:w-11',
}: {
  buttonClassName?: string
} = {}) {
  const [open, setOpen] = useState(false)
  const [originRect, setOriginRect] = useState<ReturnType<typeof rectFromElement>>(null)
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

  const unreadCount = notifications.filter(n => !n.readAt).length

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-label={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : 'Notifications'}
        title="Notifications"
        onClick={(event) => {
          setOriginRect(rectFromElement(event.currentTarget))
          setOpen(true)
        }}
        className={buttonClassName}
      >
        <Bell size={16} />
        {unreadCount > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-none text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        ) : null}
      </button>

      <MorphSurface
        open={open}
        onClose={() => setOpen(false)}
        title="Notifications"
        description={unreadCount > 0 ? `${unreadCount} unread` : "You're all caught up."}
        originRect={originRect}
        variant="light"
        size="sm"
        align="top-right"
        bodyClassName="!pt-3"
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {unreadCount > 0 ? (
              <button
                type="button"
                onClick={() => void markAllRead()}
                className="sauti-modal-secondary-button px-3 py-1.5 text-xs"
              >
                <Check size={12} /> Mark all read
              </button>
            ) : null}
          </div>
          {notifications.length > 0 ? (
            <button
              type="button"
              aria-label="Clear all notifications"
              title="Clear all"
              onClick={() => void clearAll()}
              className="sauti-modal-icon-button"
            >
              <Trash2 size={13} />
            </button>
          ) : null}
        </div>

        <div className="sauti-modal-card max-h-[60vh] overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-[#7a7b86]">You're all caught up.</div>
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
      </MorphSurface>
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
        unread ? 'cursor-pointer bg-[var(--sauti-accent-wash)] hover:bg-[var(--sauti-accent-wash-strong)]' : 'hover:bg-[var(--sauti-panel-hover)]'
      }`}
    >
      <div className="mt-0.5 shrink-0">{kindIcon(notification.kind)}</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className={`text-sm ${unread ? 'font-semibold text-[#111116]' : 'text-[#2a2b33]'}`}>
            {notification.title}
          </p>
          <span className="shrink-0 text-[10px] text-[#9a9ba3]">
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
        className="shrink-0 self-start rounded-full p-1 text-[#b0b2bc] opacity-0 transition-opacity hover:bg-[var(--sauti-panel-muted)] hover:text-[#111116] group-hover:opacity-100"
      >
        <XCircle size={14} />
      </button>
    </li>
  )
}
