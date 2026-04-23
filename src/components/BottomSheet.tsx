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
  maxHeightClassName = 'max-h-[82vh]',
  variant = 'light',
  originRect,
  size = 'lg',
}: BottomSheetProps) {
  return (
    <MorphSurface
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      originRect={originRect}
      variant={variant}
      size={size}
      align="bottom"
      bodyClassName={`${maxHeightClassName} !pt-4`}
    >
      <div className="mx-auto w-full max-w-[720px]">{children}</div>
    </MorphSurface>
  )
}
