import { db } from '../db'
import { hydrateAppStateFromBackend } from './appStateSync'

export interface TrackPlayStat {
  playCount: number
  lastPlayedAt: number
  recentPlayCount: number // within the hot window
}

const HOT_WINDOW_MS = 1000 * 60 * 60 * 24 * 14 // 14 days
const HOT_THRESHOLD = 5

export async function computePlayStats(): Promise<Map<string, TrackPlayStat>> {
  await hydrateAppStateFromBackend()
  const events = await db.listenEvents.toArray()
  const cutoff = Date.now() - HOT_WINDOW_MS
  const stats = new Map<string, TrackPlayStat>()

  for (const ev of events) {
    if (ev.skipped) continue
    const existing = stats.get(ev.trackId) ?? {
      playCount: 0,
      lastPlayedAt: 0,
      recentPlayCount: 0,
    }
    existing.playCount += 1
    if (ev.startedAt > existing.lastPlayedAt) existing.lastPlayedAt = ev.startedAt
    if (ev.startedAt >= cutoff) existing.recentPlayCount += 1
    stats.set(ev.trackId, existing)
  }

  return stats
}

export function pickHotTracks(stats: Map<string, TrackPlayStat>): string[] {
  return [...stats.entries()]
    .filter(([, s]) => s.recentPlayCount >= HOT_THRESHOLD)
    .sort((a, b) => b[1].recentPlayCount - a[1].recentPlayCount)
    .map(([id]) => id)
}
