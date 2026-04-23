import { db } from '../db'
import { pushAppStateSnapshot } from './appStateSync'
import type { ListenContext, ListenEvent, Track } from '../types'

const MAX_EVENTS = 5000
const SKIP_THRESHOLD_MS = 30_000
const COMPLETE_FRACTION = 0.9

interface ActiveListen {
  trackId: string
  startedAt: number
  duration: number
  context: ListenContext
  msListened: number
  lastPositionMs: number
}

let active: ActiveListen | null = null
let pruneScheduled = false

function makeId(trackId: string, startedAt: number): string {
  return `${trackId}-${startedAt}`
}

async function commitEvent(event: ListenEvent): Promise<void> {
  await db.listenEvents.put(event)
  await pushAppStateSnapshot()
  schedulePrune()
}

function schedulePrune(): void {
  if (pruneScheduled) return
  pruneScheduled = true
  // Defer so a flurry of writes only triggers one count/cleanup pass.
  setTimeout(async () => {
    pruneScheduled = false
    const total = await db.listenEvents.count()
    if (total <= MAX_EVENTS) return
    const excess = await db.listenEvents
      .orderBy('startedAt')
      .limit(total - MAX_EVENTS)
      .primaryKeys()
    if (excess.length) {
      await db.listenEvents.bulkDelete(excess)
      await pushAppStateSnapshot()
    }
  }, 5_000)
}

async function flush(opts: { skipped: boolean }): Promise<void> {
  if (!active) return
  const completed =
    active.duration > 0 &&
    active.msListened >= active.duration * 1000 * COMPLETE_FRACTION
  const skipped = opts.skipped && active.msListened < SKIP_THRESHOLD_MS && !completed

  const event: ListenEvent = {
    id: makeId(active.trackId, active.startedAt),
    trackId: active.trackId,
    startedAt: active.startedAt,
    msListened: Math.round(active.msListened),
    completed,
    skipped,
    context: active.context,
  }
  active = null
  await commitEvent(event)
}

export interface PlayerSnapshot {
  track: Track | null
  isPlaying: boolean
  positionMs: number
  durationSec: number
}

export async function reportPlayerTick(
  snapshot: PlayerSnapshot,
  contextResolver: (track: Track) => ListenContext = () => 'manual',
): Promise<void> {
  const { track, positionMs, durationSec } = snapshot

  // Track changed (or stopped) — flush prior listen.
  if (active && (!track || track.id !== active.trackId)) {
    const skipped = !!track && positionMs < SKIP_THRESHOLD_MS
    await flush({ skipped })
  }

  if (!track) return

  if (!active || active.trackId !== track.id) {
    active = {
      trackId: track.id,
      startedAt: Date.now(),
      duration: durationSec,
      context: contextResolver(track),
      msListened: 0,
      lastPositionMs: positionMs,
    }
    return
  }

  // Same track: accumulate forward delta only. Backward seeks reset the cursor
  // without reducing accumulated time.
  if (positionMs > active.lastPositionMs) {
    const delta = positionMs - active.lastPositionMs
    // Clip 5s+ jumps; treat as a seek, not playback.
    if (delta < 5_000) active.msListened += delta
  }
  active.lastPositionMs = positionMs
  if (durationSec > 0) active.duration = durationSec
}

export async function flushActiveListen(reason: 'unmount' | 'manual' = 'unmount'): Promise<void> {
  await flush({ skipped: reason === 'manual' && !!active && active.msListened < SKIP_THRESHOLD_MS })
}
