import { useCallback, useEffect, useRef } from 'react'

interface NodePoint {
  baseX: number
  baseY: number
  brightness: number
  nodeSize: number
  phase: number
  phase2: number
  phase3: number
  x: number
  y: number
}

type ConnectionState = 'stable' | 'breaking' | 'forming' | 'broken'

interface Connection {
  a: number
  b: number
  baseBrightness: number
  brightness: number
  state: ConnectionState
}

const INTERNAL_SIZE = 150

class NetworkAnimationState {
  connections: Connection[] = []
  nodes: NodePoint[] = []
  pad: number
  size: number
  time = 0

  constructor(size: number) {
    this.size = size
    this.pad = size * 0.136

    const count = 7
    const minSpacing = size * 0.25

    for (let index = 0; index < count; index += 1) {
      let attempts = 0
      let x = 0
      let y = 0
      let valid = false

      while (!valid && attempts < 100) {
        x = this.pad + Math.random() * (this.size - this.pad * 2)
        y = this.pad + Math.random() * (this.size - this.pad * 2)
        valid = this.nodes.every(
          (node) => Math.hypot(x - node.baseX, y - node.baseY) >= minSpacing,
        )
        attempts += 1
      }

      this.nodes.push({
        baseX: x,
        baseY: y,
        brightness: 0.4 + Math.random() * 0.6,
        nodeSize: 3 + Math.random() * 9,
        phase: Math.random() * Math.PI * 2,
        phase2: Math.random() * Math.PI * 2,
        phase3: Math.random() * Math.PI * 2,
        x,
        y,
      })
    }

    for (let i = 0; i < this.nodes.length; i += 1) {
      const distances: Array<[number, number]> = []
      for (let j = 0; j < this.nodes.length; j += 1) {
        if (j === i) continue
        distances.push([
          j,
          Math.hypot(
            this.nodes[i].baseX - this.nodes[j].baseX,
            this.nodes[i].baseY - this.nodes[j].baseY,
          ),
        ])
      }

      distances.sort((left, right) => left[1] - right[1])
      const connectCount = 2 + Math.floor(Math.random() * 2)

      for (let k = 0; k < Math.min(connectCount, distances.length); k += 1) {
        const nextIndex = distances[k][0]
        const exists = this.connections.some(
          (connection) =>
            (connection.a === i && connection.b === nextIndex) ||
            (connection.a === nextIndex && connection.b === i),
        )
        const countA = this.connections.filter((connection) => connection.a === i || connection.b === i).length
        const countB = this.connections.filter(
          (connection) => connection.a === nextIndex || connection.b === nextIndex,
        ).length

        if (!exists && countA < 3 && countB < 3) {
          const brightness = 0.08 + Math.random() * 0.25
          this.connections.push({
            a: i,
            b: nextIndex,
            baseBrightness: brightness,
            brightness,
            state: 'stable',
          })
        }
      }
    }
  }

  update() {
    for (let step = 0; step < 35; step += 1) {
      this.time += 0.004

      for (const node of this.nodes) {
        node.x += (node.baseX - node.x) * 0.06
        node.y += (node.baseY - node.y) * 0.06
      }

      for (const node of this.nodes) {
        const driftX =
          Math.sin(this.time * 0.05 + node.phase) * 0.08 +
          Math.sin(this.time * 0.03 + node.phase2) * 0.05
        const driftY =
          Math.sin(this.time * 0.04 + node.phase3) * 0.08 +
          Math.cos(this.time * 0.025 + node.phase) * 0.05

        node.baseX = Math.max(this.pad, Math.min(this.size - this.pad, node.baseX + driftX))
        node.baseY = Math.max(this.pad, Math.min(this.size - this.pad, node.baseY + driftY))
      }

      const centerX = this.nodes.reduce((sum, node) => sum + node.baseX, 0) / this.nodes.length
      const centerY = this.nodes.reduce((sum, node) => sum + node.baseY, 0) / this.nodes.length
      const target = this.size / 2

      for (const node of this.nodes) {
        node.baseX += (centerX - node.baseX) * 0.003
        node.baseY += (centerY - node.baseY) * 0.003
        node.baseX += (target - centerX) * 0.01
        node.baseY += (target - centerY) * 0.01
      }

      const minDistance = this.size * 0.2
      for (let i = 0; i < this.nodes.length; i += 1) {
        for (let j = i + 1; j < this.nodes.length; j += 1) {
          const dx = this.nodes[j].x - this.nodes[i].x
          const dy = this.nodes[j].y - this.nodes[i].y
          const distance = Math.hypot(dx, dy)

          if (distance < minDistance && distance > 0) {
            const overlap = 1 - distance / minDistance
            const push = Math.min(overlap * overlap * 0.35, 0.5)
            const normalX = dx / distance
            const normalY = dy / distance
            this.nodes[i].baseX -= normalX * push
            this.nodes[i].baseY -= normalY * push
            this.nodes[j].baseX += normalX * push
            this.nodes[j].baseY += normalY * push
          }
        }
      }

      const breakDistance = this.size * 0.5
      const formDistance = this.size * 0.27

      for (let index = 0; index < this.connections.length; index += 1) {
        const connection = this.connections[index]
        const from = this.nodes[connection.a]
        const to = this.nodes[connection.b]
        const distance = Math.hypot(to.x - from.x, to.y - from.y)

        if (connection.state === 'stable' && distance > breakDistance && this.isConnectedWithout(connection.a, connection.b, index)) {
          connection.state = 'breaking'
        }

        if (connection.state === 'breaking') {
          connection.brightness -= 0.01
          if (connection.brightness <= 0) {
            connection.state = 'broken'
            connection.brightness = 0
          }
        }

        if (connection.state === 'broken' && distance < formDistance) {
          const countA = this.connectionCount(connection.a)
          const countB = this.connectionCount(connection.b)
          if (countA < 3 && countB < 3) {
            connection.state = 'forming'
          }
        }

        if (connection.state === 'forming') {
          connection.brightness += 0.01
          if (connection.brightness >= connection.baseBrightness) {
            connection.brightness = connection.baseBrightness
            connection.state = 'stable'
          }
        }
      }
    }
  }

  private connectionCount(nodeIndex: number): number {
    return this.connections.filter(
      (connection) =>
        connection.state !== 'broken' &&
        (connection.a === nodeIndex || connection.b === nodeIndex),
    ).length
  }

  private isConnectedWithout(nodeA: number, nodeB: number, excludingIndex: number): boolean {
    const visited = new Set<number>([nodeA])
    const queue = [nodeA]

    while (queue.length > 0) {
      const current = queue.shift()
      if (current === undefined) return false
      if (current === nodeB) return true

      for (let index = 0; index < this.connections.length; index += 1) {
        if (index === excludingIndex) continue
        const connection = this.connections[index]
        if (connection.state === 'broken') continue

        let neighbor: number | null = null
        if (connection.a === current) neighbor = connection.b
        else if (connection.b === current) neighbor = connection.a

        if (neighbor !== null && !visited.has(neighbor)) {
          visited.add(neighbor)
          queue.push(neighbor)
        }
      }
    }

    return false
  }
}

function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.trim()
  if (!normalized.startsWith('#')) return normalized

  const raw = normalized.slice(1)
  const expanded = raw.length === 3
    ? raw.split('').map((char) => `${char}${char}`).join('')
    : raw

  const r = parseInt(expanded.slice(0, 2), 16)
  const g = parseInt(expanded.slice(2, 4), 16)
  const b = parseInt(expanded.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function getThemeColors() {
  const styles = getComputedStyle(document.documentElement)
  const accent = styles.getPropertyValue('--color-accent').trim() || '#ef5466'
  const outline = styles.getPropertyValue('--deezer-border-strong').trim() || 'rgba(17, 17, 22, 0.14)'
  return { accent, outline }
}

export default function NetworkLoadingAnimation({ className = '' }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number>(0)
  const stateRef = useRef<NetworkAnimationState | null>(null)

  const renderFrame = useCallback(
    (ctx: CanvasRenderingContext2D, animationState: NetworkAnimationState, dpr: number) => {
      const canvasWidth = ctx.canvas.width
      const canvasHeight = ctx.canvas.height
      const displaySize = Math.min(canvasWidth, canvasHeight) / dpr
      const scale = (displaySize * dpr) / animationState.size
      const { accent, outline } = getThemeColors()

      ctx.clearRect(0, 0, canvasWidth, canvasHeight)

      for (const connection of animationState.connections) {
        if (connection.state === 'broken') continue
        const from = animationState.nodes[connection.a]
        const to = animationState.nodes[connection.b]
        const alpha = 0.12 + connection.brightness * 0.3

        ctx.beginPath()
        ctx.moveTo(from.x * scale, from.y * scale)
        ctx.lineTo(to.x * scale, to.y * scale)
        ctx.strokeStyle = hexToRgba(accent, alpha)
        ctx.lineWidth = 1.5 * dpr
        ctx.stroke()
      }

      for (const node of animationState.nodes) {
        const radius = (node.nodeSize + 2) * scale

        ctx.beginPath()
        ctx.ellipse(node.x * scale, node.y * scale, radius, radius, 0, 0, Math.PI * 2)
        ctx.fillStyle = hexToRgba(accent, 0.4 + node.brightness * 0.45)
        ctx.fill()

        ctx.beginPath()
        ctx.ellipse(node.x * scale, node.y * scale, radius + 1.5 * scale, radius + 1.5 * scale, 0, 0, Math.PI * 2)
        ctx.strokeStyle = outline.startsWith('#') ? hexToRgba(outline, 0.45) : outline
        ctx.lineWidth = Math.max(1, 0.8 * dpr)
        ctx.stroke()
      }
    },
    [],
  )

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined

    function draw() {
      const currentCanvas = canvasRef.current
      if (!currentCanvas) return

      const context = currentCanvas.getContext('2d')
      if (!context) return

      if (!stateRef.current) {
        stateRef.current = new NetworkAnimationState(INTERNAL_SIZE)
      }

      stateRef.current.update()
      renderFrame(context, stateRef.current, window.devicePixelRatio || 1)
      rafRef.current = requestAnimationFrame(draw)
    }

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const size = Math.min(entry.contentRect.width, entry.contentRect.height)
        if (size <= 0) continue
        const dpr = window.devicePixelRatio || 1
        canvas.width = size * dpr
        canvas.height = size * dpr
      }
    })
    resizeObserver.observe(canvas)

    if (!stateRef.current) {
      stateRef.current = new NetworkAnimationState(INTERNAL_SIZE)
    }

    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    const initialSize = Math.min(rect.width, rect.height) || INTERNAL_SIZE
    canvas.width = initialSize * dpr
    canvas.height = initialSize * dpr

    const context = canvas.getContext('2d')
    if (context && stateRef.current) {
      renderFrame(context, stateRef.current, dpr)
    }
    rafRef.current = requestAnimationFrame(draw)

    return () => {
      resizeObserver.disconnect()
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
    }
  }, [renderFrame])

  return (
    <canvas
      ref={canvasRef}
      className={`rounded-full ${className}`}
      style={{ height: '100%', width: '100%' }}
    />
  )
}
