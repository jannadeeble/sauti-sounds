import { cachedHumanizedTidalCall } from './humanizedRequest'
import { searchTidal } from './tidal'
import type { Track } from '../types'

const TIDAL_SEARCH_TTL_MS = 10 * 60 * 1000
const HIGH_SCORE_THRESHOLD = 0.82
const LOW_SCORE_THRESHOLD = 0.55
const PENALTY_TERMS = [
  'live',
  'karaoke',
  'instrumental',
  'cover',
  'acoustic version',
  'radio edit',
  'sped up',
  'slowed',
]

const FEATURE_RE = /\s*[([]?\s*(feat\.?|ft\.?|featuring)\s+[^)\]]*[)\]]?/gi
const PAREN_RE = /\s*[([][^)\]]*[)\]]/g
const NON_ALNUM_RE = /[^a-z0-9 ]+/g
const MULTI_SPACE_RE = /\s+/g

function stripDiacritics(input: string) {
  return input.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

export function normalize(value: string): string {
  const stripped = stripDiacritics(value.toLowerCase())
    .replace(FEATURE_RE, ' ')
    .replace(PAREN_RE, ' ')
    .replace(NON_ALNUM_RE, ' ')
    .replace(MULTI_SPACE_RE, ' ')
    .trim()
  return stripped
}

function tokenize(value: string): string[] {
  return normalize(value).split(' ').filter(Boolean)
}

function jaroWinkler(a: string, b: string) {
  if (!a.length || !b.length) return 0
  if (a === b) return 1
  const matchDistance = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1)
  const aMatches = new Array<boolean>(a.length).fill(false)
  const bMatches = new Array<boolean>(b.length).fill(false)
  let matches = 0
  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - matchDistance)
    const end = Math.min(i + matchDistance + 1, b.length)
    for (let j = start; j < end; j++) {
      if (bMatches[j]) continue
      if (a[i] !== b[j]) continue
      aMatches[i] = true
      bMatches[j] = true
      matches += 1
      break
    }
  }
  if (matches === 0) return 0
  let transpositions = 0
  let k = 0
  for (let i = 0; i < a.length; i++) {
    if (!aMatches[i]) continue
    while (!bMatches[k]) k++
    if (a[i] !== b[k]) transpositions += 1
    k += 1
  }
  const m = matches
  const jaro = (m / a.length + m / b.length + (m - transpositions / 2) / m) / 3
  let prefix = 0
  const maxPrefix = Math.min(4, a.length, b.length)
  for (let i = 0; i < maxPrefix; i++) {
    if (a[i] === b[i]) prefix += 1
    else break
  }
  return jaro + prefix * 0.1 * (1 - jaro)
}

function tokenSetRatio(a: string, b: string) {
  const aTokens = new Set(tokenize(a))
  const bTokens = new Set(tokenize(b))
  if (!aTokens.size || !bTokens.size) return 0
  const intersection = new Set([...aTokens].filter((t) => bTokens.has(t)))
  const unionSize = new Set([...aTokens, ...bTokens]).size
  const jaccard = intersection.size / unionSize
  const sortedA = [...aTokens].sort().join(' ')
  const sortedB = [...bTokens].sort().join(' ')
  const jw = jaroWinkler(sortedA, sortedB)
  return jaccard * 0.5 + jw * 0.5
}

export interface MatchScore {
  total: number
  titleJw: number
  artistSet: number
  penalty: number
  preferOriginal: boolean
}

export function scoreCandidate(
  target: { title: string; artist: string },
  candidate: { title: string; artist: string },
): MatchScore {
  const targetTitle = normalize(target.title)
  const candidateTitle = normalize(candidate.title)
  const titleJw = jaroWinkler(targetTitle, candidateTitle)
  const artistSet = tokenSetRatio(target.artist, candidate.artist)

  const rawCandidateTitle = candidate.title.toLowerCase()
  let penalty = 0
  const preferOriginal = !PENALTY_TERMS.some((term) => target.title.toLowerCase().includes(term))
  if (preferOriginal) {
    for (const term of PENALTY_TERMS) {
      if (rawCandidateTitle.includes(term)) {
        penalty += 0.18
        break
      }
    }
  }

  const total = Math.max(0, titleJw * 0.55 + artistSet * 0.45 - penalty)
  return { total, titleJw, artistSet, penalty, preferOriginal }
}

function buildLibraryIndex(library: Track[]) {
  return library.map((track) => ({
    track,
    normalizedTitle: normalize(track.title),
    normalizedArtist: normalize(track.artist),
  }))
}

export interface ResolutionTarget {
  title: string
  artist: string
  album?: string
  reason?: string
}

export type ResolutionOutcome =
  | { status: 'owned'; track: Track; score: MatchScore; target: ResolutionTarget }
  | { status: 'matched'; track: Track; score: MatchScore; target: ResolutionTarget }
  | { status: 'ambiguous'; candidates: Track[]; topScore: MatchScore; target: ResolutionTarget }
  | { status: 'veto'; reason: string; candidates: Track[]; target: ResolutionTarget }
  | { status: 'error'; error: string; target: ResolutionTarget }

function findInLibrary(target: ResolutionTarget, index: ReturnType<typeof buildLibraryIndex>) {
  let bestScore: MatchScore | null = null
  let bestTrack: Track | null = null
  for (const entry of index) {
    const score = scoreCandidate(target, { title: entry.track.title, artist: entry.track.artist })
    if (!bestScore || score.total > bestScore.total) {
      bestScore = score
      bestTrack = entry.track
    }
  }
  if (bestTrack && bestScore && bestScore.total >= HIGH_SCORE_THRESHOLD) {
    return { track: bestTrack, score: bestScore }
  }
  return null
}

async function searchTidalCached(query: string) {
  return cachedHumanizedTidalCall(
    `tidal-search:${query}`,
    TIDAL_SEARCH_TTL_MS,
    () => searchTidal(query, 10),
    { label: 'tidal-search' },
  )
}

export async function resolveTarget(target: ResolutionTarget, library: Track[]): Promise<ResolutionOutcome> {
  const libraryIndex = buildLibraryIndex(library)
  const owned = findInLibrary(target, libraryIndex)
  if (owned) {
    return { status: 'owned', track: owned.track, score: owned.score, target }
  }

  try {
    const queryVariants = buildQueryVariants(target)
    const seenIds = new Set<string>()
    const candidates: Array<{ track: Track; score: MatchScore }> = []

    for (const query of queryVariants) {
      const result = await searchTidalCached(query)
      for (const track of result.tracks) {
        if (seenIds.has(track.id)) continue
        seenIds.add(track.id)
        const score = scoreCandidate(target, { title: track.title, artist: track.artist })
        candidates.push({ track, score })
      }
      if (candidates.some((c) => c.score.total >= HIGH_SCORE_THRESHOLD)) break
    }

    candidates.sort((a, b) => b.score.total - a.score.total)
    if (candidates.length === 0) {
      return { status: 'veto', reason: 'No Tidal results for this track', candidates: [], target }
    }

    const best = candidates[0]
    if (best.score.total >= HIGH_SCORE_THRESHOLD) {
      const runnerUp = candidates[1]
      if (runnerUp && best.score.total - runnerUp.score.total < 0.06 && runnerUp.score.total >= HIGH_SCORE_THRESHOLD) {
        return {
          status: 'ambiguous',
          candidates: candidates.slice(0, 5).map((c) => c.track),
          topScore: best.score,
          target,
        }
      }
      return { status: 'matched', track: best.track, score: best.score, target }
    }

    if (best.score.total < LOW_SCORE_THRESHOLD) {
      return {
        status: 'veto',
        reason: `Closest Tidal match too weak (score ${best.score.total.toFixed(2)})`,
        candidates: candidates.slice(0, 3).map((c) => c.track),
        target,
      }
    }

    return {
      status: 'ambiguous',
      candidates: candidates.slice(0, 5).map((c) => c.track),
      topScore: best.score,
      target,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { status: 'error', error: message, target }
  }
}

function buildQueryVariants(target: ResolutionTarget): string[] {
  const normalizedTitle = normalize(target.title)
  const normalizedArtist = normalize(target.artist)
  const primary = `${target.artist} ${target.title}`
  const stripped = `${normalizedArtist} ${normalizedTitle}`
  const titleOnly = normalizedTitle
  const variants = [primary, stripped, titleOnly].filter((q, i, arr) => q && arr.indexOf(q) === i)
  return variants
}

export async function resolveTargets(
  targets: ResolutionTarget[],
  library: Track[],
): Promise<ResolutionOutcome[]> {
  const outcomes: ResolutionOutcome[] = []
  for (const target of targets) {
    const outcome = await resolveTarget(target, library)
    outcomes.push(outcome)
  }
  return outcomes
}
