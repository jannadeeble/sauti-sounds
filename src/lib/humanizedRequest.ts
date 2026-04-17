type Task<T> = () => Promise<T>

interface QueueEntry {
  run: () => Promise<void>
}

const queue: QueueEntry[] = []
let draining = false
let lastCompletedAt = 0

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min)
}

function gaussianMs() {
  const u1 = Math.random() || 1e-9
  const u2 = Math.random()
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
  return 550 + z * 180
}

function humanGapMs() {
  const raw = gaussianMs()
  return Math.max(350, Math.min(1400, Math.round(raw)))
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

async function drain() {
  if (draining) return
  draining = true

  while (queue.length > 0) {
    const gapSinceLast = Date.now() - lastCompletedAt
    const gap = humanGapMs()
    if (gapSinceLast < gap) {
      await sleep(gap - gapSinceLast)
    }
    const entry = queue.shift()
    if (!entry) break
    try {
      await entry.run()
    } finally {
      lastCompletedAt = Date.now()
    }
  }

  draining = false
}

export interface HumanizedOptions {
  maxRetries?: number
  label?: string
}

export function humanizedTidalCall<T>(task: Task<T>, options: HumanizedOptions = {}): Promise<T> {
  const { maxRetries = 3 } = options
  return new Promise<T>((resolve, reject) => {
    queue.push({
      run: async () => {
        let attempt = 0
        let lastError: unknown = null
        while (attempt <= maxRetries) {
          try {
            const result = await task()
            resolve(result)
            return
          } catch (error) {
            lastError = error
            const shouldRetry = isRetryable(error) && attempt < maxRetries
            if (!shouldRetry) {
              reject(error)
              return
            }
            const backoff = Math.round(randomBetween(1500, 3500) * Math.pow(2, attempt))
            await sleep(backoff)
            attempt += 1
          }
        }
        reject(lastError)
      },
    })
    void drain()
  })
}

function isRetryable(error: unknown) {
  if (error instanceof Error) {
    const message = error.message.toLowerCase()
    if (message.includes('429')) return true
    if (message.includes('502') || message.includes('503') || message.includes('504')) return true
    if (message.includes('network')) return true
  }
  return false
}

interface CacheEntry<T> {
  expiresAt: number
  value: T
}

const responseCache = new Map<string, CacheEntry<unknown>>()

export function cachedHumanizedTidalCall<T>(
  key: string,
  ttlMs: number,
  task: Task<T>,
  options: HumanizedOptions = {},
): Promise<T> {
  const hit = responseCache.get(key)
  if (hit && hit.expiresAt > Date.now()) {
    return Promise.resolve(hit.value as T)
  }
  return humanizedTidalCall(task, options).then((value) => {
    responseCache.set(key, { expiresAt: Date.now() + ttlMs, value })
    return value
  })
}

export function clearHumanizedCache() {
  responseCache.clear()
}
