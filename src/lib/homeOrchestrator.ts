import { isLLMConfigured } from './llm'
import {
  generateCulturalBridge,
  generatePlaylistEcho,
  generateRediscovery,
  generateSimilarArtist,
  generateTrackEcho,
} from './mixGenerator'
import { computePlayStats, pickHotTracks } from './playStats'
import { useLibraryStore } from '../stores/libraryStore'
import { useMixStore } from '../stores/mixStore'
import { usePlaylistStore } from '../stores/playlistStore'
import { useTasteStore } from '../stores/tasteStore'
import type { Mix, MixKind, Playlist, Track } from '../types'

const RUN_COOLDOWN_MS = 1000 * 60 * 60 * 12 // 12h
const LAST_RUN_KEY = 'sauti.homeFeed.lastRun'
let inFlight = false

interface RunOptions {
  force?: boolean
  phases?: ('rediscovery' | 'track-echo' | 'playlist-echo' | 'similar-artist' | 'cultural-bridge')[]
}

export function lastHomeFeedRun(): number {
  const raw = typeof window !== 'undefined' ? window.localStorage.getItem(LAST_RUN_KEY) : null
  return raw ? Number(raw) : 0
}

export function markHomeFeedRun(): void {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(LAST_RUN_KEY, String(Date.now()))
  }
}

export async function maybeRunHomeFeed(opts: RunOptions = {}): Promise<void> {
  if (inFlight) return
  if (!opts.force && Date.now() - lastHomeFeedRun() < RUN_COOLDOWN_MS) return
  inFlight = true
  try {
    await runHomeFeed(opts)
    markHomeFeedRun()
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

  const env = {
    library,
    tasteProfile: tasteState.profile,
    excludeLibraryIds: buildExcludeSet(library),
  }

  const phases = opts.phases ?? ['rediscovery', 'track-echo', 'playlist-echo', 'similar-artist', 'cultural-bridge']

  const stats = await computePlayStats()
  const jobs: Promise<Mix | null>[] = []

  if (phases.includes('rediscovery')) {
    jobs.push(
      generateRediscovery(env, {
        playStats: new Map(
          [...stats.entries()].map(([id, s]) => [id, { playCount: s.playCount, lastPlayedAt: s.lastPlayedAt }]),
        ),
      }),
    )
  }

  if (phases.includes('track-echo')) {
    const hot = pickHotTracks(stats).slice(0, 2)
    for (const trackId of hot) {
      const t = library.find(l => l.id === trackId)
      if (t) jobs.push(generateTrackEcho(env, t))
    }
  }

  if (phases.includes('playlist-echo')) {
    const seeds = pickPlaylistSeeds(playlists.appPlaylists, 4)
    for (const playlist of seeds) {
      const tracks = resolvePlaylistTracks(playlist, library)
      if (tracks.length < 3) continue
      jobs.push(generatePlaylistEcho(env, playlist, tracks))
    }
  }

  if (phases.includes('similar-artist')) {
    const topArtist = pickTopArtistThisMonth(library, stats)
    if (topArtist) jobs.push(generateSimilarArtist(env, topArtist))
  }

  if (phases.includes('cultural-bridge') && env.tasteProfile?.culturalMarkers?.length) {
    jobs.push(generateCulturalBridge(env))
  }

  const results = await Promise.allSettled(jobs)
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) {
      await mixStore.upsert(r.value)
    }
  }
}

export async function regenerateMix(mix: Mix): Promise<Mix | null> {
  if (!isLLMConfigured()) return null
  const library = useLibraryStore.getState().tracks
  const tasteProfile = useTasteStore.getState().profile
  const playlists = usePlaylistStore.getState()

  const env = {
    library,
    tasteProfile,
    excludeLibraryIds: buildExcludeSet(library),
  }

  let next: Mix | null = null
  switch (mix.kind) {
    case 'rediscovery': {
      const stats = await computePlayStats()
      next = await generateRediscovery(env, {
        playStats: new Map(
          [...stats.entries()].map(([id, s]) => [id, { playCount: s.playCount, lastPlayedAt: s.lastPlayedAt }]),
        ),
      })
      break
    }
    case 'track-echo': {
      const seedId = mix.seedRef?.type === 'track' ? mix.seedRef.id : null
      const seed = seedId ? library.find(t => t.id === seedId) : null
      if (seed) next = await generateTrackEcho(env, seed)
      break
    }
    case 'playlist-echo': {
      const seedId = mix.seedRef?.type === 'playlist' ? mix.seedRef.id : null
      const seedPlaylist = seedId ? playlists.appPlaylists.find(p => p.id === seedId) : null
      if (seedPlaylist) {
        const tracks = resolvePlaylistTracks(seedPlaylist, library)
        next = await generatePlaylistEcho(env, seedPlaylist, tracks)
      }
      break
    }
    case 'similar-artist': {
      const seedArtist = mix.seedRef?.type === 'artist' ? mix.seedRef.name : null
      if (seedArtist) next = await generateSimilarArtist(env, seedArtist)
      break
    }
    case 'cultural-bridge':
      next = await generateCulturalBridge(env)
      break
  }

  if (next) {
    const mixStore = useMixStore.getState()
    await mixStore.setStatus(mix.id, 'dismissed')
    await mixStore.upsert(next)
  }
  return next
}

function buildExcludeSet(library: Track[]): Set<string> {
  const ids = new Set<string>()
  for (const t of library) {
    if (t.providerTrackId) ids.add(t.providerTrackId)
    ids.add(t.id)
  }
  return ids
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
