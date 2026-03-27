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
  beats?: number[]     // beat timestamps in seconds
  downbeats?: number[] // downbeat timestamps in seconds
  duration?: number    // track duration for converting timestamps to positions
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
  beats,
  downbeats,
  duration,
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

    // Beat grid markers
    if (beats && duration && duration > 0) {
      const downbeatSet = downbeats ? new Set(downbeats) : new Set<number>()
      for (const beatTime of beats) {
        const x = (beatTime / duration) * w
        const isDownbeat = downbeatSet.has(beatTime)

        ctx.strokeStyle = isDownbeat ? 'rgba(232, 133, 61, 0.5)' : 'rgba(255, 255, 255, 0.12)'
        ctx.lineWidth = isDownbeat ? 1.5 : 0.5
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, h)
        ctx.stroke()
      }
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
  }, [data, progress, color, activeColor, height, mixOutPoint, mixInPoint, beats, downbeats, duration])

  return (
    <canvas
      ref={canvasRef}
      className={`w-full ${className}`}
      style={{ height }}
    />
  )
}
