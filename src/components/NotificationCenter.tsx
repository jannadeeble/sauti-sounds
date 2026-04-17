import { useMemo } from 'react'
import { Bell, Check, X } from 'lucide-react'
import BottomSheet from './BottomSheet'
import { useNotificationStore } from '../stores/notificationStore'

interface NotificationCenterProps {
  open: boolean
  onClose: () => void
}

export default function NotificationCenter({ open, onClose }: NotificationCenterProps) {
  const notifications = useNotificationStore((state) => state.notifications)
  const markAllRead = useNotificationStore((state) => state.markAllRead)
  const dismiss = useNotificationStore((state) => state.dismiss)
  const clear = useNotificationStore((state) => state.clear)

  const sorted = useMemo(() => [...notifications].sort((a, b) => b.createdAt - a.createdAt), [notifications])

  return (
    <BottomSheet
      open={open}
      title="Notifications"
      description="Vetoed suggestions, background task results, and alerts."
      onClose={onClose}
      maxHeightClassName="max-h-[80vh]"
    >
      <div className="space-y-3">
        {sorted.length === 0 ? (
          <div className="rounded-2xl border border-black/6 bg-[#f8f8f9] px-5 py-8 text-center text-sm text-[#686973]">
            <Bell size={18} className="mx-auto mb-2 text-[#a2a3ad]" />
            Nothing here yet.
          </div>
        ) : (
          <>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={markAllRead}
                className="inline-flex items-center gap-1.5 rounded-full border border-black/8 bg-white px-3 py-1.5 text-xs text-[#111116] hover:bg-[#f8f8f9]"
              >
                <Check size={12} /> Mark all read
              </button>
              <button
                type="button"
                onClick={clear}
                className="inline-flex items-center gap-1.5 rounded-full border border-black/8 bg-white px-3 py-1.5 text-xs text-[#111116] hover:bg-[#f8f8f9]"
              >
                Clear
              </button>
            </div>

            <ul className="divide-y divide-black/6 overflow-hidden rounded-[22px] border border-black/8">
              {sorted.map((notification) => (
                <li key={notification.id} className="flex items-start gap-3 bg-white px-4 py-3">
                  <span
                    className={`mt-1 inline-block h-2 w-2 shrink-0 rounded-full ${
                      notification.level === 'warning'
                        ? 'bg-rose-500'
                        : notification.level === 'success'
                          ? 'bg-emerald-500'
                          : 'bg-sky-500'
                    } ${notification.read ? 'opacity-30' : ''}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-[#111116]">{notification.title}</p>
                    {notification.body ? (
                      <pre className="mt-1 whitespace-pre-wrap font-sans text-xs text-[#7a7b86]">
                        {notification.body}
                      </pre>
                    ) : null}
                    <p className="mt-1 text-[10px] uppercase tracking-wide text-[#a2a3ad]">
                      {new Date(notification.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => dismiss(notification.id)}
                    className="rounded-full p-1 text-[#a2a3ad] hover:bg-black/4 hover:text-[#111116]"
                    aria-label="Dismiss"
                  >
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </BottomSheet>
  )
}
