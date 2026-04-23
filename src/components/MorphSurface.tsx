import { type CSSProperties, type ReactNode, useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import type { RectLike } from '../lib/rect'
import { rectCenter } from '../lib/rect'

interface MorphSurfaceProps {
  open: boolean
  onClose: () => void
  title?: string
  description?: string
  children: ReactNode
  originRect?: RectLike | null
  variant?: 'dark' | 'light'
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full'
  align?: 'bottom' | 'center' | 'top-right'
  showCloseButton?: boolean
  header?: ReactNode
  bodyClassName?: string
}

const EXIT_MS = 260

function surfaceWidth(size: MorphSurfaceProps['size']) {
  switch (size) {
    case 'sm':
      return 440
    case 'md':
      return 560
    case 'lg':
      return 760
    case 'xl':
      return 980
    case 'full':
      return 1440
    default:
      return 760
  }
}

export default function MorphSurface({
  open,
  onClose,
  title,
  description,
  children,
  originRect,
  size = 'lg',
  align = 'bottom',
  showCloseButton = true,
  header,
  bodyClassName = '',
}: MorphSurfaceProps) {
  const [mounted, setMounted] = useState(open)
  const [visible, setVisible] = useState(open)
  const [viewportWidth, setViewportWidth] = useState(
    typeof window === 'undefined' ? 1280 : window.innerWidth,
  )
  const [viewportHeight, setViewportHeight] = useState(
    typeof window === 'undefined' ? 900 : window.innerHeight,
  )

  useEffect(() => {
    if (!open && !mounted) return
    if (open) {
      setMounted(true)
      const id = window.requestAnimationFrame(() => setVisible(true))
      return () => window.cancelAnimationFrame(id)
    }

    setVisible(false)
    const timeoutId = window.setTimeout(() => setMounted(false), EXIT_MS)
    return () => window.clearTimeout(timeoutId)
  }, [mounted, open])

  useEffect(() => {
    if (!mounted) return
    function handleResize() {
      setViewportWidth(window.innerWidth)
      setViewportHeight(window.innerHeight)
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('resize', handleResize)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [mounted, onClose])

  const desktop = viewportWidth >= 960
  const targetAlign = align === 'top-right' ? 'top-right' : desktop ? 'center' : align
  const center = rectCenter(originRect)

  const overlayClassName = visible ? 'opacity-100' : 'opacity-0'
  const panelClassName = 'sauti-modal-surface text-[var(--sauti-text)]'

  const headerNode = header ?? (
    <div className="flex items-start justify-between gap-4 border-b border-[color:var(--sauti-border)] px-6 py-5 sm:px-7">
      <div className="min-w-0">
        {title ? <h2 className="sauti-modal-title text-[var(--sauti-text)]">{title}</h2> : null}
        {description ? (
          <p className="mt-2 text-sm text-[var(--sauti-text-muted)]">{description}</p>
        ) : null}
      </div>
      {showCloseButton ? (
        <button
          type="button"
          onClick={onClose}
          className="sauti-modal-icon-button shrink-0"
          aria-label={title ? `Close ${title}` : 'Close dialog'}
        >
          <X size={18} />
        </button>
      ) : null}
    </div>
  )

  const panelStyle = useMemo<CSSProperties>(() => {
    const horizontalPadding = size === 'full' ? 24 : 16
    const width = Math.min(surfaceWidth(size), viewportWidth - horizontalPadding * 2)
    const originX = center?.x ?? viewportWidth / 2
    const originY = center?.y ?? (targetAlign === 'center' ? viewportHeight / 2 : viewportHeight - 48)
    const maxHeight = size === 'full'
      ? viewportHeight - horizontalPadding * 2
      : desktop
        ? Math.min(viewportHeight * 0.86, 920)
        : Math.min(viewportHeight - 32, viewportHeight * 0.88)
    const base: CSSProperties = {
      position: 'fixed',
      width,
      maxWidth: `calc(100vw - ${horizontalPadding * 2}px)`,
      maxHeight,
      transformOrigin: `${originX}px ${originY}px`,
      transition: `opacity ${EXIT_MS}ms ease, transform ${EXIT_MS}ms cubic-bezier(.2,.8,.2,1)`,
      opacity: visible ? 1 : 0,
    }

    if (size === 'full') {
      return {
        ...base,
        left: horizontalPadding,
        top: horizontalPadding,
        width: `calc(100vw - ${horizontalPadding * 2}px)`,
        maxWidth: `calc(100vw - ${horizontalPadding * 2}px)`,
        maxHeight: `calc(100vh - ${horizontalPadding * 2}px)`,
        transform: visible ? 'translateY(0) scale(1)' : 'translateY(12px) scale(0.985)',
      }
    }

    if (targetAlign === 'center') {
      return {
        ...base,
        left: '50%',
        top: '50%',
        transform: visible ? 'translate(-50%, -50%) scale(1)' : 'translate(-50%, -47%) scale(0.92)',
      }
    }

    if (targetAlign === 'top-right') {
      const left = Math.max(
        16,
        Math.min(((originRect?.left ?? viewportWidth - 24) + (originRect?.width ?? 0)) - width, viewportWidth - width - 16),
      )
      const top = Math.max(
        16,
        Math.min(((originRect?.top ?? 56) + (originRect?.height ?? 0)) + 12, viewportHeight - Math.min(maxHeight, 560) - 16),
      )
      return {
        ...base,
        left,
        top,
        maxHeight: Math.min(maxHeight, 560),
        transform: visible ? 'translateY(0) scale(1)' : 'translateY(-8px) scale(0.96)',
      }
    }

    return {
      ...base,
      left: 16,
      right: 16,
      bottom: 16,
      width: 'calc(100vw - 32px)',
      transform: visible ? 'translateY(0) scale(1)' : 'translateY(18px) scale(0.96)',
    }
  }, [center?.x, center?.y, desktop, size, targetAlign, viewportHeight, viewportWidth, visible])

  if (!mounted) return null

  return (
    <>
      <button
        type="button"
        aria-label={title ? `Close ${title}` : 'Close dialog'}
        className={`sauti-modal-overlay fixed inset-0 z-40 transition-opacity duration-200 ${overlayClassName}`}
        onClick={onClose}
      />
      <section className={`fixed z-50 flex flex-col overflow-hidden ${panelClassName}`} style={panelStyle}>
        {headerNode}
        <div
          className={`flex-1 overflow-y-auto px-6 pb-6 pt-4 sm:px-7 ${bodyClassName}`}
          style={{ overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch' }}
        >
          {children}
        </div>
      </section>
    </>
  )
}
