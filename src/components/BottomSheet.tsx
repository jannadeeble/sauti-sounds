import type { ReactNode } from 'react'
import type { RectLike } from '../lib/rect'
import MorphSurface from './MorphSurface'

interface BottomSheetProps {
  open: boolean
  title: string
  description?: string
  onClose: () => void
  children: ReactNode
  maxHeightClassName?: string
  variant?: 'light' | 'dark'
  originRect?: RectLike | null
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full'
}

export default function BottomSheet({
  open,
  title,
  description,
  onClose,
  children,
  maxHeightClassName = '',
  variant = 'dark',
  originRect,
  size = 'lg',
}: BottomSheetProps) {
  const contentWidthClassName = size === 'xl' || size === 'full'
    ? 'max-w-[980px]'
    : size === 'md'
      ? 'max-w-[640px]'
      : size === 'sm'
        ? 'max-w-[520px]'
        : 'max-w-[760px]'
  const bodyClassName = maxHeightClassName ? `${maxHeightClassName} !pt-4` : '!pt-4'

  return (
    <MorphSurface
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      originRect={originRect}
      variant={variant}
      size="full"
      align="bottom"
      bodyClassName={bodyClassName}
    >
      <div className={`mx-auto w-full ${contentWidthClassName}`}>{children}</div>
    </MorphSurface>
  )
}
