import { X } from 'lucide-react'
import type { ReactNode } from 'react'

interface BottomSheetProps {
  open: boolean
  title: string
  description?: string
  onClose: () => void
  children: ReactNode
  maxHeightClassName?: string
}

export default function BottomSheet({
  open,
  title,
  description,
  onClose,
  children,
  maxHeightClassName = 'max-h-[82vh]',
}: BottomSheetProps) {
  if (!open) return null

  return (
    <>
      <button
        type="button"
        aria-label={`Close ${title}`}
        className="fixed inset-0 z-40 bg-black/35"
        onClick={onClose}
      />
      <section
        className={`fixed inset-x-0 bottom-0 z-50 overflow-hidden rounded-t-[2.25rem] border-t border-black/8 bg-white shadow-[0_-8px_40px_rgba(17,17,22,0.12)] ${maxHeightClassName}`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-black/6 px-5 py-4">
          <div>
            <h2 className="deezer-display text-[1.9rem] leading-none text-[#111116]">{title}</h2>
            {description ? <p className="mt-2 text-sm text-[#7a7b86]">{description}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-[#8c8d96] transition-colors hover:bg-black/4 hover:text-[#111116]"
          >
            <X size={18} />
          </button>
        </div>
        <div className="overflow-y-auto px-5 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-4">
          {children}
        </div>
      </section>
    </>
  )
}
