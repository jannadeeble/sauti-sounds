import {
  hasLiveRemixCoverQualifier,
  levenshteinRatio,
  tokenSetSimilarity,
} from './search'
import { cleanArtistName, cleanTrackTitle } from './spotifyImport'
import type { Track } from '../types'

export interface LocalDedupMatch {
  local: Track
  tidal: Track
  score: number
}

export interface LocalDedupResult {
  confident: LocalDedupMatch[]
  uncertain: LocalDedupMatch[]
}

const ACCEPT_SCORE = 0.88
const REVIEW_SCORE = 0.7

function scorePair(local: Track, tidal: Track): number {
  const localTitle = cleanTrackTitle(local.title).toLowerCase()
  const tidalTitle = cleanTrackTitle(tidal.title).toLowerCase()
  const localArtist = cleanArtistName(local.artist)
  const tidalArtist = cleanArtistName(tidal.artist)

  const titleSim = levenshteinRatio(localTitle, tidalTitle)
  const artistSim = tokenSetSimilarity(localArtist, tidalArtist)
  let score = titleSim * 0.6 + artistSim * 0.4

  if (
    hasLiveRemixCoverQualifier(tidal.title) &&
    !hasLiveRemixCoverQualifier(local.title)
  ) {
    score -= 0.25
  }

  if (local.duration > 0 && tidal.duration > 0) {
    const diff = Math.abs(local.duration - tidal.duration)
    if (diff <= 2) score += 0.05
    else if (diff >= 10) score -= 0.15
  }

  return Math.max(0, Math.min(1, score))
}

/**
 * For each newly-imported local track, find the best Tidal match in the
 * existing library. Splits results into confident (auto-apply) and uncertain
 * (user reviews) buckets. Tidal tracks that already have a confident match
 * are excluded from uncertain pairings to avoid double-binding.
 */
export function findTidalDuplicates(
  localTracks: Track[],
  tidalPool: Track[],
): LocalDedupResult {
  const confident: LocalDedupMatch[] = []
  const uncertain: LocalDedupMatch[] = []
  const claimedTidalIds = new Set<string>()

  type Scored = { tidal: Track; score: number }

  for (const local of localTracks) {
    if (local.source !== 'local') continue

    const scored: Scored[] = []
    for (const tidal of tidalPool) {
      if (tidal.source !== 'tidal') continue
      if (claimedTidalIds.has(tidal.id)) continue
      const score = scorePair(local, tidal)
      if (score >= REVIEW_SCORE) scored.push({ tidal, score })
    }

    if (scored.length === 0) continue
    scored.sort((a, b) => b.score - a.score)
    const top = scored[0]

    if (top.score >= ACCEPT_SCORE) {
      confident.push({ local, tidal: top.tidal, score: top.score })
      claimedTidalIds.add(top.tidal.id)
    } else {
      uncertain.push({ local, tidal: top.tidal, score: top.score })
    }
  }

  return { confident, uncertain }
}
