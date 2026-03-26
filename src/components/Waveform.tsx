import { useRef, useEffect } from 'react'

interface Props {
  data: number[]
  progress?: number // 0-1
  color?: string
  activeColor?: string
  height?: number
  className?: string
  mixOutPoint?: number // 0-1 position for mix-out marker
  mixInPoint?: number  // 0-1 position for mix-in marker
}

export default function Waveform({
  data,
  progress = 0,
  color = '#33334a',
  activeColor = '#e8853d',
  height = 60,
  className = '',
  mixOutPoint,
  mixInPoint,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || data.length === 0) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    ctx.scale(dpr, dpr)

    const w = rect.width
    const h = rect.height
    const barWidth = Math.max(1, w / data.length - 1)
    const centerY = h / 2

    ctx.clearRect(0, 0, w, h)

    // Draw waveform bars
    for (let i = 0; i < data.length; i++) {
      const x = (i / data.length) * w
      const amplitude = data[i] * centerY * 0.9
      const isPlayed = i / data.length <= progress

      ctx.fillStyle = isPlayed ? activeColor : color
      // Top half
      ctx.fillRect(x, centerY - amplitude, barWidth, amplitude)
      // Bottom half (mirrored, slightly smaller)
      ctx.fillRect(x, centerY, barWidth, amplitude * 0.6)
    }

    // Mix point markers
    if (mixOutPoint !== undefined) {
      const x = mixOutPoint * w
      ctx.strokeStyle = '#ef4444'
      ctx.lineWidth = 2
      ctx.setLineDash([4, 4])
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, h)
      ctx.stroke()
      ctx.setLineDash([])

      // Label
      ctx.fillStyle = '#ef4444'
      ctx.font = '9px sans-serif'
      ctx.fillText('OUT', x + 3, 10)
    }

    if (mixInPoint !== undefined) {
      const x = mixInPoint * w
      ctx.strokeStyle = '#22c55e'
      ctx.lineWidth = 2
      ctx.setLineDash([4, 4])
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, h)
      ctx.stroke()
      ctx.setLineDash([])

      ctx.fillStyle = '#22c55e'
      ctx.font = '9px sans-serif'
      ctx.fillText('IN', x + 3, 10)
    }
  }, [data, progress, color, activeColor, height, mixOutPoint, mixInPoint])

  return (
    <canvas
      ref={canvasRef}
      className={`w-full ${className}`}
      style={{ height }}
    />
  )
}
