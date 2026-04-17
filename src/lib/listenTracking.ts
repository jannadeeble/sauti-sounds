import { db, type ListenContext, type ListenEvent } from '../db'
import type { Track } from '../types'

const MIN_LISTEN_MS = 3_000
const COMPLETION_RATIO = 0.85

interface CurrentSession {
  trackId: string
  source: 'local' | 'tidal'
  providerTrackId?: string
  startedAt: number
  lastTickAt: number
  msAccumulated: number
  trackDurationMs?: number
  context: ListenContext
  suggestionId?: string
  lastPlayingState: boolean
}

let session: CurrentSession | null = null

function generateId() {
  return `listen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

async function commit(finalPosition: number, completed: boolean, skipped: boolean) {
  if (!session) return
  if (session.msAccumulated < MIN_LISTEN_MS) {
    session = null
    return
  }

  const event: ListenEvent = {
    id: generateId(),
    trackId: session.trackId,
    source: session.source,
    providerTrackId: session.providerTrackId,
    startedAt: session.startedAt,
    endedAt: Date.now(),
    msListened: Math.round(session.msAccumulated),
    trackDurationMs: session.trackDurationMs,
    completed,
    skipped,
    context: session.context,
    suggestionId: session.suggestionId,
  }

  try {
    await db.listens.put(event)
  } catch (err) {
    console.error('Failed to persist listen event', err)
  }

  void finalPosition
  session = null
}

export interface ListenTickInput {
  track: Track | null
  isPlaying: boolean
  currentTime: number
  duration: number
  context: ListenContext
  suggestionId?: string
}

export function handleListenTick(input: ListenTickInput) {
  const { track, isPlaying, currentTime, duration, context, suggestionId } = input

  if (!track) {
    if (session) {
      void commit(currentTime * 1000, false, true)
    }
    return
  }

  if (session && session.trackId !== track.id) {
    const prevDuration = session.trackDurationMs ?? 0
    const completed = prevDuration > 0 && session.msAccumulated / prevDuration >= COMPLETION_RATIO
    void commit(session.msAccumulated, completed, !completed)
  }

  if (!session) {
    session = {
      trackId: track.id,
      source: track.source,
      providerTrackId: track.providerTrackId,
      startedAt: Date.now(),
      lastTickAt: Date.now(),
      msAccumulated: 0,
      trackDurationMs: duration > 0 ? Math.round(duration * 1000) : track.duration ? track.duration * 1000 : undefined,
      context,
      suggestionId,
      lastPlayingState: isPlaying,
    }
    return
  }

  const now = Date.now()
  if (isPlaying && session.lastPlayingState) {
    session.msAccumulated += now - session.lastTickAt
  }
  session.lastTickAt = now
  session.lastPlayingState = isPlaying
  if (!session.trackDurationMs && duration > 0) {
    session.trackDurationMs = Math.round(duration * 1000)
  }
}

export function flushListenSession(reason: 'unmount' | 'session-change' = 'session-change') {
  if (!session) return
  const completed = session.trackDurationMs
    ? session.msAccumulated / session.trackDurationMs >= COMPLETION_RATIO
    : false
  void commit(0, completed, !completed && reason === 'session-change')
}

export async function getRecentListens(limit = 50): Promise<ListenEvent[]> {
  return db.listens.orderBy('startedAt').reverse().limit(limit).toArray()
}

export async function getPlayCountByTrack(): Promise<Map<string, number>> {
  const events = await db.listens.toArray()
  const counts = new Map<string, number>()
  for (const event of events) {
    if (event.skipped) continue
    counts.set(event.trackId, (counts.get(event.trackId) ?? 0) + 1)
  }
  return counts
}

export async function getLastPlayedMap(): Promise<Map<string, number>> {
  const events = await db.listens.toArray()
  const map = new Map<string, number>()
  for (const event of events) {
    const existing = map.get(event.trackId) ?? 0
    if (event.startedAt > existing) map.set(event.trackId, event.startedAt)
  }
  return map
}
