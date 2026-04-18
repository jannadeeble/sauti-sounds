import type { SuggestionContext } from './llm'
import type { TasteProfile, Track, TrackSource } from '../types'

interface FlatTrack {
  title: string
  artist: string
  source: TrackSource
  tags?: string[]
  lastPlayedAt?: number
  playCount?: number
}

export interface RecentPlayContext {
  trackId: string
  playedAt: number
  msListened?: number
}

export interface BuildContextInput {
  // The full library + recent listening, for the cache-friendly prefix.
  libraryTracks: Track[]
  taggedSampleSize?: number
  recentPlays?: RecentPlayContext[]
  recentPlaysWindow?: number
  tasteProfile?: TasteProfile | null
  includeProfile?: boolean
  // The seed-specific tail (per-call, NOT cached).
  seed: {
    label: string
    body: string
  }
}

function flattenTrack(track: Track): FlatTrack {
  return {
    title: track.title,
    artist: track.artist,
    source: track.source,
    tags: track.tags
      ? [
          track.tags.mood,
          ...track.tags.genres,
          ...track.tags.vibeDescriptors,
        ].filter(Boolean)
      : undefined,
  }
}

/**
 * Build a SuggestionContext: a static prefix (taste profile + tagged library
 * sample, sent with cache_control) and a per-call tail (seed details).
 *
 * The prefix is intentionally identical across calls in the same session so
 * Anthropic's prompt cache hits — only the tail varies.
 */
export function buildSuggestionContext(input: BuildContextInput): SuggestionContext {
  const sampleSize = input.taggedSampleSize ?? 150
  const includeProfile = input.includeProfile !== false && !!input.tasteProfile

  // Stable selection: tagged tracks first, then most-recently-added, capped.
  const sorted = [...input.libraryTracks].sort((a, b) => {
    const aTagged = a.tags ? 1 : 0
    const bTagged = b.tags ? 1 : 0
    if (aTagged !== bTagged) return bTagged - aTagged
    return (b.addedAt ?? 0) - (a.addedAt ?? 0)
  })
  const sample = sorted.slice(0, sampleSize).map(flattenTrack)

  const profileBlock = includeProfile && input.tasteProfile
    ? formatTasteProfile(input.tasteProfile)
    : ''

  const libraryBlock = formatLibrarySample(sample, input.libraryTracks.length)

  const prefix = [
    profileBlock,
    libraryBlock,
  ].filter(Boolean).join('\n\n')

  const tail = `${input.seed.label}\n${input.seed.body}`

  return { prefix, tail }
}

function formatTasteProfile(profile: TasteProfile): string {
  return [
    '## Taste profile',
    `- Identity: ${profile.coreIdentity}`,
    `- Primary genres: ${profile.primaryGenres.join(', ')}`,
    `- Energy sweet spot: ${profile.energyPreference.sweet_spot} (range ${profile.energyPreference.min}-${profile.energyPreference.max})`,
    `- Cultural markers: ${profile.culturalMarkers.join(', ')}`,
    `- Favorite artists: ${profile.favoriteArtists.join(', ')}`,
    `- Mood preferences: ${profile.moodPreferences.join(', ')}`,
    `- Avoids: ${profile.antiPreferences.join(', ')}`,
  ].join('\n')
}

function formatLibrarySample(sample: FlatTrack[], totalCount: number): string {
  if (!sample.length) return ''
  const lines = sample.map(t => {
    const tags = t.tags?.length ? ` [${t.tags.slice(0, 4).join(', ')}]` : ''
    return `- "${t.title}" — ${t.artist}${tags}`
  })
  return [
    `## Library sample (${sample.length} of ${totalCount} tracks; library is a taste signal — recommendations should expand it, not repeat it)`,
    ...lines,
  ].join('\n')
}
