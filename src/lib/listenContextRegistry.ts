import type { ListenContext, Track } from '../types'

const map = new Map<string, ListenContext>()

export function tagTrackContext(trackId: string, context: ListenContext): void {
  map.set(trackId, context)
}

export function tagTrackContexts(trackIds: string[], context: ListenContext): void {
  for (const id of trackIds) map.set(id, context)
}

export function clearTrackContext(trackId: string): void {
  map.delete(trackId)
}

export function resolveTrackContext(track: Track): ListenContext {
  return map.get(track.id) ?? 'manual'
}
