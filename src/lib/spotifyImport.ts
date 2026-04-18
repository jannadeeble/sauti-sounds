import { searchTidalForMatch } from './tidal'
import type { Track, Playlist } from '../types'

export interface SpotifyTrackEntry {
  trackName: string
  artistName: string
  albumName: string
  trackUri?: string
}

export interface SpotifyPlaylist {
  name: string
  description?: string
  tracks: SpotifyTrackEntry[]
}

export interface MatchResult {
  spotify: SpotifyTrackEntry
  tidalMatch: Track | null
  confidence: 'high' | 'medium' | 'none'
}

export interface ImportReport {
  matched: MatchResult[]
  uncertain: MatchResult[]
  missing: MatchResult[]
  playlists: SpotifyPlaylist[]
  totalTracks: number
}

// Strip noisy suffixes that keep otherwise-identical tracks from matching:
// "(feat. X)", "[feat. X]", "- Remastered 2019", "- Radio Edit",
// "(Single Version)", "(Acoustic)", "(Live at …)", etc.
const SUFFIX_KEYWORDS =
  '(?:feat\\.?|ft\\.?|with|featuring|remaster(?:ed)?|radio edit|single version|album version|acoustic|live|explicit|clean|instrumental|remix|edit|demo|mono|stereo|bonus|deluxe|extended|original|version)'

const PARENS_SUFFIX_RE = new RegExp(
  `\\s*[\\(\\[][^)\\]]*${SUFFIX_KEYWORDS}[^)\\]]*[\\)\\]]`,
  'gi',
)

const DASH_SUFFIX_RE = new RegExp(
  `\\s*[-–—]\\s*${SUFFIX_KEYWORDS}.*$`,
  'gi',
)

export function cleanTrackTitle(raw: string): string {
  if (!raw) return ''
  return raw
    .replace(PARENS_SUFFIX_RE, '')
    .replace(DASH_SUFFIX_RE, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function cleanArtistName(raw: string): string {
  if (!raw) return ''
  // Keep only the primary artist for searching — drop "feat." collaborators
  return raw
    .split(/\s*(?:,|&| and | x | X |feat\.?|ft\.?|featuring|with)\s+/i)[0]
    .trim()
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

async function retry<T>(fn: () => Promise<T>, attempts = 3, baseDelayMs = 400): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (i === attempts - 1) break
      const delay = baseDelayMs * Math.pow(2, i)
      await new Promise((r) => setTimeout(r, delay))
    }
  }
  throw lastErr
}

// Shapes observed in Spotify's "Download your data" JSON exports. Fields are
// optional because the exporter varies between account regions and years.
interface SpotifyLibraryTrackRaw {
  track?: string
  trackName?: string
  artist?: string
  artistName?: string
  album?: string
  albumName?: string
  uri?: string
  trackUri?: string
}

interface SpotifyPlaylistItemRaw {
  track?: {
    trackName?: string
    artistName?: string
    albumName?: string
    trackUri?: string
  }
}

interface SpotifyPlaylistRaw {
  name?: string
  description?: string
  items?: SpotifyPlaylistItemRaw[]
}

interface SpotifyLibraryExport {
  tracks?: SpotifyLibraryTrackRaw[]
  playlists?: SpotifyPlaylistRaw[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function asLibraryExport(json: unknown): SpotifyLibraryExport {
  return isRecord(json) ? (json as SpotifyLibraryExport) : {}
}

// Parse Spotify export files
export function parseSpotifyLibrary(json: unknown): SpotifyTrackEntry[] {
  const tracks: SpotifyTrackEntry[] = []
  const parsed = asLibraryExport(json)

  // YourLibrary.json format
  if (parsed.tracks) {
    for (const t of parsed.tracks) {
      tracks.push({
        trackName: t.track || t.trackName || '',
        artistName: t.artist || t.artistName || '',
        albumName: t.album || t.albumName || '',
        trackUri: t.uri || t.trackUri,
      })
    }
  }

  return tracks
}

export function parseSpotifyPlaylists(json: unknown): SpotifyPlaylist[] {
  const playlists: SpotifyPlaylist[] = []
  const parsed = asLibraryExport(json)

  // Playlist1.json / Playlist2.json format
  if (parsed.playlists) {
    for (const p of parsed.playlists) {
      playlists.push({
        name: p.name || 'Untitled Playlist',
        description: p.description,
        tracks: (p.items || [])
          .map<SpotifyTrackEntry>((item) => ({
            trackName: item.track?.trackName || '',
            artistName: item.track?.artistName || '',
            albumName: item.track?.albumName || '',
            trackUri: item.track?.trackUri,
          }))
          .filter((t) => Boolean(t.trackName)),
      })
    }
  }

  return playlists
}

export interface ImportProgress {
  phase: 'parsing' | 'matching' | 'done'
  current: number
  total: number
  message: string
}

export async function matchSpotifyToTidal(
  spotifyTracks: SpotifyTrackEntry[],
  onProgress?: (progress: ImportProgress) => void,
): Promise<{ matched: MatchResult[]; uncertain: MatchResult[]; missing: MatchResult[] }> {
  const matched: MatchResult[] = []
  const uncertain: MatchResult[] = []
  const missing: MatchResult[] = []

  // Deduplicate by raw artist+title — playlist rebuilding references these exact keys
  const seen = new Set<string>()
  const unique = spotifyTracks.filter((t) => {
    const key = `${t.artistName}|||${t.trackName}`.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  for (let i = 0; i < unique.length; i++) {
    const spotify = unique[i]
    onProgress?.({
      phase: 'matching',
      current: i + 1,
      total: unique.length,
      message: `Matching: ${spotify.artistName} - ${spotify.trackName}`,
    })

    const searchArtist = cleanArtistName(spotify.artistName) || spotify.artistName
    const searchTitle = cleanTrackTitle(spotify.trackName) || spotify.trackName

    try {
      const tidalMatch = await retry(() => searchTidalForMatch(searchArtist, searchTitle))

      if (tidalMatch) {
        const cleanedSpotifyTitle = normalize(searchTitle)
        const cleanedTidalTitle = normalize(cleanTrackTitle(tidalMatch.title))
        const cleanedSpotifyArtist = normalize(searchArtist)
        const cleanedTidalArtist = normalize(tidalMatch.artist)

        const titleMatch =
          cleanedTidalTitle === cleanedSpotifyTitle ||
          cleanedTidalTitle.includes(cleanedSpotifyTitle) ||
          cleanedSpotifyTitle.includes(cleanedTidalTitle)
        const artistMatch =
          cleanedTidalArtist.includes(cleanedSpotifyArtist) ||
          cleanedSpotifyArtist.includes(cleanedTidalArtist)

        if (titleMatch && artistMatch) {
          matched.push({ spotify, tidalMatch, confidence: 'high' })
        } else {
          uncertain.push({ spotify, tidalMatch, confidence: 'medium' })
        }
      } else {
        missing.push({ spotify, tidalMatch: null, confidence: 'none' })
      }

      // Rate limiting - small delay between API calls
      if (i < unique.length - 1) {
        await new Promise((r) => setTimeout(r, 200))
      }
    } catch {
      missing.push({ spotify, tidalMatch: null, confidence: 'none' })
    }
  }

  return { matched, uncertain, missing }
}

export function buildPlaylistsFromMatches(
  spotifyPlaylists: SpotifyPlaylist[],
  matchMap: Map<string, Track>, // key: "artist|||title" -> Tidal track
): Playlist[] {
  return spotifyPlaylists.map((sp) => {
    const items: Playlist['items'] = []
    for (const t of sp.tracks) {
      const key = `${t.artistName}|||${t.trackName}`.toLowerCase()
      const match = matchMap.get(key)
      if (!match) continue
      if (match.source === 'tidal' && match.providerTrackId) {
        items.push({ source: 'tidal', providerTrackId: match.providerTrackId })
      } else {
        items.push({ source: 'local', trackId: match.id })
      }
    }

    return {
      id: `import-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: sp.name,
      description: sp.description,
      items,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      kind: 'app',
      writable: true,
      trackCount: items.length,
    }
  })
}
