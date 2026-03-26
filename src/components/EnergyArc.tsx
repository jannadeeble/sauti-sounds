import { useRef, useEffect } from 'react'

interface Props {
  values: number[] // energy values 0-1
  currentIndex?: number
  height?: number
  className?: string
  labels?: string[] // track names
}

export default function EnergyArc({
  values,
  currentIndex = -1,
  height = 80,
  className = '',
  labels: _labels,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || values.length === 0) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    ctx.scale(dpr, dpr)

    const w = rect.width
    const h = rect.height
    const padding = 4

    ctx.clearRect(0, 0, w, h)

    // Draw filled area under curve
    const gradient = ctx.createLinearGradient(0, 0, 0, h)
    gradient.addColorStop(0, 'rgba(232, 133, 61, 0.3)')
    gradient.addColorStop(1, 'rgba(232, 133, 61, 0.02)')

    ctx.beginPath()
    ctx.moveTo(padding, h - padding)

    for (let i = 0; i < values.length; i++) {
      const x = padding + (i / (values.length - 1)) * (w - padding * 2)
      const y = h - padding - values[i] * (h - padding * 2)

      if (i === 0) ctx.lineTo(x, y)
      else {
        // Smooth curve
        const prevX = padding + ((i - 1) / (values.length - 1)) * (w - padding * 2)
        const cpx = (prevX + x) / 2
        ctx.quadraticCurveTo(cpx, h - padding - values[i - 1] * (h - padding * 2), x, y)
      }
    }

    ctx.lineTo(w - padding, h - padding)
    ctx.closePath()
    ctx.fillStyle = gradient
    ctx.fill()

    // Draw the line
    ctx.beginPath()
    for (let i = 0; i < values.length; i++) {
      const x = padding + (i / (values.length - 1)) * (w - padding * 2)
      const y = h - padding - values[i] * (h - padding * 2)

      if (i === 0) ctx.moveTo(x, y)
      else {
        const prevX = padding + ((i - 1) / (values.length - 1)) * (w - padding * 2)
        const cpx = (prevX + x) / 2
        ctx.quadraticCurveTo(cpx, h - padding - values[i - 1] * (h - padding * 2), x, y)
      }
    }
    ctx.strokeStyle = '#e8853d'
    ctx.lineWidth = 2
    ctx.stroke()

    // Draw dots for each track
    for (let i = 0; i < values.length; i++) {
      const x = padding + (i / (values.length - 1)) * (w - padding * 2)
      const y = h - padding - values[i] * (h - padding * 2)

      ctx.beginPath()
      ctx.arc(x, y, i === currentIndex ? 5 : 3, 0, Math.PI * 2)
      ctx.fillStyle = i === currentIndex ? '#e8853d' : i < currentIndex ? '#e8853d88' : '#33334a'
      ctx.fill()

      if (i === currentIndex) {
        ctx.strokeStyle = '#e8853d'
        ctx.lineWidth = 2
        ctx.stroke()
      }
    }
  }, [values, currentIndex, height])

  return (
    <canvas
      ref={canvasRef}
      className={`w-full ${className}`}
      style={{ height }}
    />
  )
}
