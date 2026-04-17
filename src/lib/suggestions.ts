import type { SuggestionKind } from '../db'
import {
  type LibrarySummaryEntry,
  type SeedTrackSummary,
  type SimilarArtistResult,
  type TasteProfile,
  type TrackCandidate,
  generatePlaylistFooterSuggestions,
  generateSetlistSeeds,
  generateSimilarArtist,
  pickBestTidalMatch,
} from './llm'
import { getLastPlayedMap, getPlayCountByTrack } from './listenTracking'
import { getCachedSuggestion, putCachedSuggestion } from './suggestionCache'
import {
  type ResolutionOutcome,
  type ResolutionTarget,
  resolveTarget,
} from './tidalResolution'
import type { Track } from '../types'
import { useNotificationStore } from '../stores/notificationStore'

const SETLIST_TTL_MS = 6 * 60 * 60 * 1000
const PLAYLIST_FOOTER_TTL_MS = 24 * 60 * 60 * 1000
const HOME_FEED_TTL_MS = 24 * 60 * 60 * 1000

export interface ResolvedCandidate {
  candidate: TrackCandidate
  outcome: ResolutionOutcome
}

export interface SetlistResult {
  id: string
  seedTrackId: string
  generatedAt: number
  resolved: ResolvedCandidate[]
}

export interface PlaylistFooterResult {
  id: string
  playlistId: string
  generatedAt: number
  resolved: ResolvedCandidate[]
}

export interface SimilarArtistCardResult {
  id: string
  kind: 'home-similar-artist'
  seedArtist: string
  generatedAt: number
  characterization: string
  artist: string
  resolved: ResolvedCandidate[]
}

export interface RediscoveryCardResult {
  id: string
  kind: 'home-rediscovery'
  generatedAt: number
  tracks: Track[]
}

export type HomeFeedCard = SimilarArtistCardResult | RediscoveryCardResult

function newId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

function trackToSeed(track: Track): SeedTrackSummary {
  return {
    title: track.title,
    artist: track.artist,
    genre: track.genre,
    bpm: track.bpm,
    energy: track.energy,
    mood: track.mood,
    tags: track.tags,
  }
}

async function buildLibrarySummary(library: Track[]): Promise<LibrarySummaryEntry[]> {
  const playCounts = await getPlayCountByTrack()
  const lastPlayed = await getLastPlayedMap()
  return library.map((track) => ({
    title: track.title,
    artist: track.artist,
    source: track.source,
    genre: track.genre,
    playCount: playCounts.get(track.id) ?? 0,
    lastPlayedAt: lastPlayed.get(track.id),
  }))
}

async function buildRecentPlays(library: Track[]): Promise<LibrarySummaryEntry[]> {
  const lastPlayed = await getLastPlayedMap()
  const byTrack = new Map(library.map((t) => [t.id, t]))
  return [...lastPlayed.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([trackId]) => byTrack.get(trackId))
    .filter((t): t is Track => Boolean(t))
    .map((track) => ({
      title: track.title,
      artist: track.artist,
      source: track.source,
      genre: track.genre,
    }))
}

async function resolveCandidates(candidates: TrackCandidate[], library: Track[]): Promise<ResolvedCandidate[]> {
  const resolved: ResolvedCandidate[] = []
  for (const candidate of candidates) {
    const target: ResolutionTarget = {
      title: candidate.title,
      artist: candidate.artist,
      reason: candidate.reason,
    }
    let outcome = await resolveTarget(target, library)
    if (outcome.status === 'ambiguous') {
      try {
        const decision = await pickBestTidalMatch({
          target: { title: candidate.title, artist: candidate.artist },
          candidates: outcome.candidates.map((c) => ({ title: c.title, artist: c.artist, album: c.album })),
        })
        if (decision && decision.index >= 0) {
          const picked = outcome.candidates[decision.index]
          outcome = {
            status: 'matched',
            track: picked,
            score: outcome.topScore,
            target,
          }
        } else {
          outcome = {
            status: 'veto',
            reason: `Adjudicator could not pick a confident match${decision?.reason ? `: ${decision.reason}` : ''}`,
            candidates: outcome.candidates,
            target,
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        outcome = { status: 'error', error: message, target }
      }
    }
    resolved.push({ candidate, outcome })
  }
  return resolved
}

function pushVetoNotifications(resolved: ResolvedCandidate[], scopeLabel: string) {
  const vetoed = resolved.filter(
    (entry) => entry.outcome.status === 'veto' || entry.outcome.status === 'error',
  )
  if (vetoed.length === 0) return
  const body = vetoed
    .slice(0, 6)
    .map((entry) => `• "${entry.candidate.title}" — ${entry.candidate.artist}`)
    .join('\n')
  useNotificationStore.getState().push({
    level: 'warning',
    title: `${vetoed.length} ${vetoed.length === 1 ? 'track' : 'tracks'} vetoed (${scopeLabel})`,
    body,
    meta: { scope: scopeLabel, vetoed: vetoed.length },
  })
}

export interface SuggestionContext {
  library: Track[]
  tasteProfile?: TasteProfile
}

export interface GetSetlistOptions {
  seed: Track
  context: SuggestionContext
  force?: boolean
  count?: number
}

export async function getSetlistSeeds(options: GetSetlistOptions): Promise<SetlistResult> {
  const { seed, context, force, count } = options
  const sourceKey = seed.id
  if (!force) {
    const cached = await getCachedSuggestion<SetlistResult>('setlist', sourceKey)
    if (cached) return cached.data
  }

  const recentPlays = await buildRecentPlays(context.library)
  const librarySummary = await buildLibrarySummary(context.library)

  const candidates = await generateSetlistSeeds({
    seed: trackToSeed(seed),
    librarySample: librarySummary,
    tasteProfile: context.tasteProfile,
    recentPlays,
    count,
  })

  const resolved = await resolveCandidates(candidates, context.library)
  pushVetoNotifications(resolved, `Setlist from "${seed.title}"`)

  const result: SetlistResult = {
    id: newId('setlist'),
    seedTrackId: seed.id,
    generatedAt: Date.now(),
    resolved,
  }

  await putCachedSuggestion('setlist', sourceKey, result, SETLIST_TTL_MS)
  return result
}

export interface GetPlaylistFooterOptions {
  playlistId: string
  playlistName: string
  playlistTracks: Track[]
  context: SuggestionContext
  force?: boolean
  count?: number
}

export async function getPlaylistFooterSuggestions(
  options: GetPlaylistFooterOptions,
): Promise<PlaylistFooterResult> {
  const { playlistId, playlistName, playlistTracks, context, force, count } = options
  const sourceKey = `${playlistId}:${playlistTracks.length}`
  if (!force) {
    const cached = await getCachedSuggestion<PlaylistFooterResult>('playlist-footer', sourceKey)
    if (cached) return cached.data
  }

  const librarySummary = await buildLibrarySummary(context.library)

  const candidates = await generatePlaylistFooterSuggestions({
    playlistName,
    tracks: playlistTracks.map(trackToSeed),
    librarySample: librarySummary,
    tasteProfile: context.tasteProfile,
    count,
  })

  const resolved = await resolveCandidates(candidates, context.library)
  pushVetoNotifications(resolved, `Suggestions for "${playlistName}"`)

  const result: PlaylistFooterResult = {
    id: newId('footer'),
    playlistId,
    generatedAt: Date.now(),
    resolved,
  }

  await putCachedSuggestion('playlist-footer', sourceKey, result, PLAYLIST_FOOTER_TTL_MS)
  return result
}

export interface GetHomeFeedOptions {
  context: SuggestionContext
  force?: boolean
}

export async function getHomeFeed(options: GetHomeFeedOptions): Promise<HomeFeedCard[]> {
  const { context, force } = options
  const cards: HomeFeedCard[] = []

  const rediscovery = await buildRediscoveryCard(context)
  if (rediscovery) cards.push(rediscovery)

  const similarArtistCard = await getSimilarArtistCard(context, { force })
  if (similarArtistCard) cards.push(similarArtistCard)

  return cards
}

async function buildRediscoveryCard(context: SuggestionContext): Promise<RediscoveryCardResult | null> {
  const lastPlayed = await getLastPlayedMap()
  const playCounts = await getPlayCountByTrack()
  const now = Date.now()
  const sixMonthsMs = 180 * 24 * 60 * 60 * 1000

  const stale = context.library
    .filter((track) => {
      const count = playCounts.get(track.id) ?? 0
      if (count < 2) return false
      const last = lastPlayed.get(track.id) ?? 0
      return now - last > sixMonthsMs
    })
    .sort((a, b) => (playCounts.get(b.id) ?? 0) - (playCounts.get(a.id) ?? 0))
    .slice(0, 8)

  if (stale.length === 0) return null
  return {
    id: newId('rediscover'),
    kind: 'home-rediscovery',
    generatedAt: now,
    tracks: stale,
  }
}

async function getSimilarArtistCard(
  context: SuggestionContext,
  options: { force?: boolean } = {},
): Promise<SimilarArtistCardResult | null> {
  const playCounts = await getPlayCountByTrack()
  const topArtist = pickTopArtist(context.library, playCounts)
  if (!topArtist) return null

  const sourceKey = `similar-artist:${topArtist}`
  if (!options.force) {
    const cached = await getCachedSuggestion<SimilarArtistCardResult>('home-similar-artist', sourceKey)
    if (cached) return cached.data
  }

  const librarySummary = await buildLibrarySummary(context.library)
  const ai: SimilarArtistResult | null = await generateSimilarArtist({
    seedArtist: topArtist,
    librarySample: librarySummary,
    tasteProfile: context.tasteProfile,
    count: 5,
  })
  if (!ai) return null

  const resolved = await resolveCandidates(ai.picks, context.library)
  pushVetoNotifications(resolved, `Similar-artist picks for ${ai.artist}`)

  const card: SimilarArtistCardResult = {
    id: newId('similar-artist'),
    kind: 'home-similar-artist',
    seedArtist: topArtist,
    generatedAt: Date.now(),
    characterization: ai.characterization,
    artist: ai.artist,
    resolved,
  }

  await putCachedSuggestion('home-similar-artist', sourceKey, card, HOME_FEED_TTL_MS)
  return card
}

function pickTopArtist(library: Track[], playCounts: Map<string, number>): string | null {
  const artistCounts = new Map<string, number>()
  for (const track of library) {
    const count = playCounts.get(track.id) ?? 0
    const existing = artistCounts.get(track.artist) ?? 0
    artistCounts.set(track.artist, existing + count + (track.isFavorite ? 2 : 0))
  }
  const sorted = [...artistCounts.entries()].filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1])
  return sorted[0]?.[0] ?? null
}

export function countMatched(result: SetlistResult | PlaylistFooterResult): number {
  return result.resolved.filter(
    (entry) => entry.outcome.status === 'matched' || entry.outcome.status === 'owned',
  ).length
}

export function extractPlayableTracks(
  result: SetlistResult | PlaylistFooterResult | SimilarArtistCardResult,
): Track[] {
  return result.resolved
    .map((entry) => (entry.outcome.status === 'matched' || entry.outcome.status === 'owned' ? entry.outcome.track : null))
    .filter((track): track is Track => track !== null)
}

export type { SuggestionKind }
