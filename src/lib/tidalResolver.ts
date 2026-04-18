import { adjudicateMatch, type Recommendation } from './llm'
import { hasLiveRemixCoverQualifier, levenshteinRatio, tokenSetSimilarity } from './search'
import { searchTidal } from './tidal'
import type { Track } from '../types'

export interface ResolveOptions {
  excludeIds?: Set<string>
  penaliseLiveRemixCover?: boolean
  mixId: string
  maxCandidates?: number
}

export interface ResolvedPick {
  track: Track
  rec: Recommendation
}

export interface ResolveResult {
  resolved: ResolvedPick[]
  vetoed: Recommendation[]
}

const ACCEPT_SCORE = 0.82
const REJECT_SCORE = 0.55

function scoreCandidate(
  wanted: { artist: string; title: string },
  candidate: Track,
  penaliseQualifiers: boolean,
): number {
  const titleSim = levenshteinRatio(wanted.title.toLowerCase(), candidate.title.toLowerCase())
  const artistSim = tokenSetSimilarity(wanted.artist, candidate.artist)
  let score = titleSim * 0.6 + artistSim * 0.4
  if (
    penaliseQualifiers &&
    hasLiveRemixCoverQualifier(candidate.title) &&
    !hasLiveRemixCoverQualifier(wanted.title)
  ) {
    score -= 0.25
  }
  return Math.max(0, Math.min(1, score))
}

/**
 * Resolve recommendation objects (artist/title/reason) to concrete Tidal
 * tracks. Uses deterministic scoring first; falls back to a Haiku adjudicator
 * when the top candidate is in the grey zone.
 */
export async function resolveRecommendations(
  recs: Recommendation[],
  options: ResolveOptions,
): Promise<ResolveResult> {
  const resolved: ResolvedPick[] = []
  const vetoed: Recommendation[] = []
  const penalise = options.penaliseLiveRemixCover !== false
  const maxCandidates = options.maxCandidates ?? 5

  for (const rec of recs) {
    const wanted = { artist: rec.artist, title: rec.title }
    let result: Track | null = null
    try {
      const search = await searchTidal(`${rec.artist} ${rec.title}`, maxCandidates)
      const candidates = search.tracks.filter(
        t => !options.excludeIds?.has(t.id),
      )
      if (!candidates.length) {
        vetoed.push(rec)
        continue
      }

      const scored = candidates.map(candidate => ({
        candidate,
        score: scoreCandidate(wanted, candidate, penalise),
      }))
      scored.sort((a, b) => b.score - a.score)
      const top = scored[0]

      if (top.score >= ACCEPT_SCORE) {
        result = top.candidate
      } else if (top.score <= REJECT_SCORE) {
        result = null
      } else {
        // Grey zone — ask Haiku.
        const pickIndex = await adjudicateMatch(
          wanted,
          scored.map(s => ({
            id: s.candidate.id,
            title: s.candidate.title,
            artist: s.candidate.artist,
            album: s.candidate.album,
          })),
        )
        if (pickIndex !== null && pickIndex >= 0 && pickIndex < scored.length) {
          result = scored[pickIndex].candidate
        }
      }
    } catch (err) {
      console.error('Tidal resolver search failed', err)
    }

    if (result) {
      resolved.push({ track: result, rec })
    } else {
      vetoed.push(rec)
    }
  }

  return { resolved, vetoed }
}
