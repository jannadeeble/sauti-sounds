export interface RectLike {
  top: number
  left: number
  width: number
  height: number
}

export function rectFromElement(element: Element | null): RectLike | null {
  if (!element) return null
  const rect = element.getBoundingClientRect()
  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  }
}

export function rectCenter(rect?: RectLike | null): { x: number; y: number } | null {
  if (!rect) return null
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  }
}
