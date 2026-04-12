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

// Parse Spotify export files
export function parseSpotifyLibrary(json: any): SpotifyTrackEntry[] {
  const tracks: SpotifyTrackEntry[] = []

  // YourLibrary.json format
  if (json.tracks) {
    for (const t of json.tracks) {
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

export function parseSpotifyPlaylists(json: any): SpotifyPlaylist[] {
  const playlists: SpotifyPlaylist[] = []

  // Playlist1.json / Playlist2.json format
  if (json.playlists) {
    for (const p of json.playlists) {
      playlists.push({
        name: p.name || 'Untitled Playlist',
        description: p.description,
        tracks: (p.items || []).map((item: any) => ({
          trackName: item.track?.trackName || '',
          artistName: item.track?.artistName || '',
          albumName: item.track?.albumName || '',
          trackUri: item.track?.trackUri,
        })).filter((t: SpotifyTrackEntry) => t.trackName),
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
  onProgress?: (progress: ImportProgress) => void
): Promise<{ matched: MatchResult[]; uncertain: MatchResult[]; missing: MatchResult[] }> {
  const matched: MatchResult[] = []
  const uncertain: MatchResult[] = []
  const missing: MatchResult[] = []

  // Deduplicate by artist+title
  const seen = new Set<string>()
  const unique = spotifyTracks.filter(t => {
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

    try {
      const tidalMatch = await searchTidalForMatch(spotify.artistName, spotify.trackName)

      if (tidalMatch) {
        // Check confidence based on exact match
        const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
        const titleMatch = normalize(tidalMatch.title) === normalize(spotify.trackName)
        const artistMatch = normalize(tidalMatch.artist).includes(normalize(spotify.artistName))

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
        await new Promise(r => setTimeout(r, 200))
      }
    } catch {
      missing.push({ spotify, tidalMatch: null, confidence: 'none' })
    }
  }

  return { matched, uncertain, missing }
}

export function buildPlaylistsFromMatches(
  spotifyPlaylists: SpotifyPlaylist[],
  matchMap: Map<string, Track> // key: "artist|||title" -> Tidal track
): Playlist[] {
  return spotifyPlaylists.map(sp => {
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
