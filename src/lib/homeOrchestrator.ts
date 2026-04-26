import { isLLMConfigured } from './llm'
import { runBackendGeneration } from './generationRuns'
import {
  getPersistentUiState,
  hydrateAppStateFromBackend,
  pushAppStateSnapshot,
  setPersistentUiState,
} from './appStateSync'
import { computePlayStats, pickHotTracks } from './playStats'
import { useLibraryStore } from '../stores/libraryStore'
import { useMixStore } from '../stores/mixStore'
import { usePlaylistStore } from '../stores/playlistStore'
import { useTasteStore } from '../stores/tasteStore'
import type { Mix, MixKind, Playlist, Track } from '../types'

const RUN_COOLDOWN_MS = 1000 * 60 * 60 * 12 // 12h
let inFlight = false

interface RunOptions {
  force?: boolean
  phases?: ('rediscovery' | 'track-echo' | 'playlist-echo' | 'similar-artist' | 'cultural-bridge')[]
}

async function lastHomeFeedRun(): Promise<number> {
  await hydrateAppStateFromBackend()
  return getPersistentUiState().lastHomeFeedRun ?? 0
}

async function markHomeFeedRun(): Promise<void> {
  setPersistentUiState({ lastHomeFeedRun: Date.now() })
  await pushAppStateSnapshot()
}

export async function maybeRunHomeFeed(opts: RunOptions = {}): Promise<void> {
  if (inFlight) return
  if (!opts.force && Date.now() - await lastHomeFeedRun() < RUN_COOLDOWN_MS) return
  inFlight = true
  try {
    await runHomeFeed(opts)
    await markHomeFeedRun()
  } finally {
    inFlight = false
  }
}

async function runHomeFeed(opts: RunOptions): Promise<void> {
  if (!isLLMConfigured()) return

  const libraryState = useLibraryStore.getState()
  const tasteState = useTasteStore.getState()
  const mixStore = useMixStore.getState()
  const playlists = usePlaylistStore.getState()

  const library = libraryState.tracks
  if (library.length < 20) return // cold start: handled elsewhere

  // Stale prior fresh home-feed mixes before generating new ones.
  await mixStore.markStale([
    'rediscovery',
    'track-echo',
    'playlist-echo',
    'similar-artist',
    'cultural-bridge',
  ])

  const phases = opts.phases ?? ['rediscovery', 'track-echo', 'playlist-echo', 'similar-artist', 'cultural-bridge']

  const stats = await computePlayStats()
  const jobs: Promise<Mix | null>[] = []
  const useTaste = Boolean(tasteState.profile)

  if (phases.includes('rediscovery')) {
    jobs.push(
      runBackendGeneration({ kind: 'rediscovery', count: 10, source: 'home-feed' }).then((result) => result.mix ?? null),
    )
  }

  if (phases.includes('track-echo')) {
    const hot = pickHotTracks(stats).slice(0, 2)
    for (const trackId of hot) {
      const t = library.find(l => l.id === trackId)
      if (t) {
        jobs.push(
          runBackendGeneration({
            kind: 'track-echo',
            seedTrackId: t.id,
            count: 10,
            source: 'home-feed',
            useTaste,
          }).then((result) => result.mix ?? null),
        )
      }
    }
  }

  if (phases.includes('playlist-echo')) {
    const seeds = pickPlaylistSeeds(playlists.appPlaylists, 4)
    for (const playlist of seeds) {
      const tracks = resolvePlaylistTracks(playlist, library)
      if (tracks.length < 3) continue
      jobs.push(
        runBackendGeneration({
          kind: 'playlist-echo',
          seedPlaylistId: playlist.id,
          count: 12,
          source: 'home-feed',
          useTaste,
        }).then((result) => result.mix ?? null),
      )
    }
  }

  if (phases.includes('similar-artist')) {
    const topArtist = pickTopArtistThisMonth(library, stats)
    if (topArtist) {
      jobs.push(
        runBackendGeneration({
          kind: 'similar-artist',
          seedArtist: topArtist,
          count: 5,
          source: 'home-feed',
          useTaste,
        }).then((result) => result.mix ?? null),
      )
    }
  }

  if (phases.includes('cultural-bridge') && tasteState.profile?.culturalMarkers?.length) {
    jobs.push(
      runBackendGeneration({
        kind: 'cultural-bridge',
        count: 8,
        source: 'home-feed',
        useTaste: true,
      }).then((result) => result.mix ?? null),
    )
  }

  await Promise.allSettled(jobs)
  await Promise.all([libraryState.loadTracks(), mixStore.load()])
}

export async function regenerateMix(mix: Mix): Promise<Mix | null> {
  if (!isLLMConfigured()) return null
  const library = useLibraryStore.getState().tracks
  const tasteProfile = useTasteStore.getState().profile
  const playlists = usePlaylistStore.getState()

  let next: Mix | null = null
  switch (mix.kind) {
    case 'rediscovery': {
      const result = await runBackendGeneration({ kind: 'rediscovery', count: 10, source: 'home-feed' })
      next = result.mix ?? null
      break
    }
    case 'track-echo': {
      const seedId = mix.seedRef?.type === 'track' ? mix.seedRef.id : null
      const seed = seedId ? library.find(t => t.id === seedId) : null
      if (seed) {
        const result = await runBackendGeneration({
          kind: 'track-echo',
          seedTrackId: seed.id,
          count: 10,
          source: 'home-feed',
          useTaste: Boolean(tasteProfile),
        })
        next = result.mix ?? null
      }
      break
    }
    case 'playlist-echo': {
      const seedId = mix.seedRef?.type === 'playlist' ? mix.seedRef.id : null
      const seedPlaylist = seedId ? playlists.appPlaylists.find(p => p.id === seedId) : null
      if (seedPlaylist) {
        const tracks = resolvePlaylistTracks(seedPlaylist, library)
        if (tracks.length >= 3) {
          const result = await runBackendGeneration({
            kind: 'playlist-echo',
            seedPlaylistId: seedPlaylist.id,
            count: 12,
            source: 'home-feed',
            useTaste: Boolean(tasteProfile),
          })
          next = result.mix ?? null
        }
      }
      break
    }
    case 'similar-artist': {
      const seedArtist = mix.seedRef?.type === 'artist' ? mix.seedRef.name : null
      if (seedArtist) {
        const result = await runBackendGeneration({
          kind: 'similar-artist',
          seedArtist,
          count: 5,
          source: 'home-feed',
          useTaste: Boolean(tasteProfile),
        })
        next = result.mix ?? null
      }
      break
    }
    case 'cultural-bridge': {
      const result = await runBackendGeneration({
        kind: 'cultural-bridge',
        count: 8,
        source: 'home-feed',
        useTaste: Boolean(tasteProfile),
      })
      next = result.mix ?? null
      break
    }
  }

  if (next) {
    const mixStore = useMixStore.getState()
    await mixStore.setStatus(mix.id, 'dismissed')
    await mixStore.load()
  }
  return next
}

function pickPlaylistSeeds(playlists: Playlist[], limit: number): Playlist[] {
  const app = playlists.filter(p => p.kind === 'app')
  if (!app.length) return []
  // Weighted blend: recent updates, oldest (dormant), largest.
  const byUpdated = [...app].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit)
  const byDormant = [...app].sort((a, b) => a.updatedAt - b.updatedAt).slice(0, limit)
  const byLargest = [...app].sort((a, b) => (b.trackCount ?? 0) - (a.trackCount ?? 0)).slice(0, limit)
  const seen = new Set<string>()
  const out: Playlist[] = []
  const rotation = [...byUpdated, ...byDormant, ...byLargest]
  for (const p of rotation) {
    if (seen.has(p.id)) continue
    seen.add(p.id)
    out.push(p)
    if (out.length >= limit) break
  }
  return out
}

function resolvePlaylistTracks(playlist: Playlist, library: Track[]): Track[] {
  const byId = new Map(library.map(t => [t.id, t]))
  const byProvider = new Map<string, Track>()
  for (const t of library) {
    if (t.providerTrackId) byProvider.set(t.providerTrackId, t)
  }
  const tracks: Track[] = []
  for (const item of playlist.items ?? []) {
    if (item.source === 'local') {
      const t = byId.get(item.trackId)
      if (t) tracks.push(t)
    } else if (item.source === 'tidal') {
      const t = byProvider.get(item.providerTrackId)
      if (t) tracks.push(t)
    }
  }
  return tracks
}

function pickTopArtistThisMonth(
  library: Track[],
  stats: Map<string, { playCount: number; lastPlayedAt: number; recentPlayCount: number }>,
): string | null {
  const cutoff = Date.now() - 1000 * 60 * 60 * 24 * 30
  const counts = new Map<string, number>()
  const trackById = new Map(library.map(t => [t.id, t]))
  for (const [trackId, s] of stats) {
    if (s.lastPlayedAt < cutoff) continue
    const t = trackById.get(trackId)
    if (!t) continue
    counts.set(t.artist, (counts.get(t.artist) ?? 0) + s.playCount)
  }
  let best: { artist: string; count: number } | null = null
  for (const [artist, count] of counts) {
    if (!best || count > best.count) best = { artist, count }
  }
  return best?.artist ?? null
}

// Re-export kinds for callers
export type HomeMixKind = Extract<MixKind, 'rediscovery' | 'track-echo' | 'playlist-echo' | 'similar-artist' | 'cultural-bridge'>
