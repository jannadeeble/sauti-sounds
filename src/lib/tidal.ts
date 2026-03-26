import type { Track } from '../types'

const TIDAL_API = 'https://openapi.tidal.com'

interface TidalConfig {
  clientId: string
  clientSecret: string
  accessToken?: string
  tokenExpiry?: number
}

let config: TidalConfig | null = null

export function configureTidal(clientId: string, clientSecret: string) {
  config = { clientId, clientSecret }
}

export function isTidalConfigured(): boolean {
  return config !== null && !!config.clientId
}

async function getAccessToken(): Promise<string> {
  if (!config) throw new Error('Tidal not configured')

  if (config.accessToken && config.tokenExpiry && Date.now() < config.tokenExpiry) {
    return config.accessToken
  }

  const res = await fetch('https://auth.tidal.com/v1/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
  })

  if (!res.ok) throw new Error(`Tidal auth failed: ${res.status}`)
  const data = await res.json()
  config.accessToken = data.access_token
  config.tokenExpiry = Date.now() + (data.expires_in - 60) * 1000
  return data.access_token
}

async function tidalFetch(path: string, params?: Record<string, string>) {
  const token = await getAccessToken()
  const url = new URL(`${TIDAL_API}${path}`)
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  }
  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/vnd.tidal.v1+json',
    },
  })
  if (!res.ok) throw new Error(`Tidal API error: ${res.status}`)
  return res.json()
}

export interface TidalSearchResult {
  tracks: Track[]
  totalResults: number
}

function tidalTrackToTrack(item: any): Track {
  const resource = item.resource || item
  const imageId = resource.album?.imageCover?.[0]?.url
    || resource.imageCover?.[0]?.url

  return {
    id: `tidal-${resource.id}`,
    title: resource.title || 'Unknown',
    artist: resource.artists?.map((a: any) => a.name).join(', ') || 'Unknown Artist',
    album: resource.album?.title || 'Unknown Album',
    duration: resource.duration || 0,
    source: 'tidal',
    tidalId: resource.id,
    tidalUrl: resource.tidalUrl || `https://tidal.com/track/${resource.id}`,
    artworkUrl: imageId || undefined,
    genre: resource.properties?.genre?.[0],
  }
}

export async function searchTidal(query: string, limit = 20): Promise<TidalSearchResult> {
  if (!isTidalConfigured()) {
    return { tracks: [], totalResults: 0 }
  }

  try {
    const data = await tidalFetch('/search', {
      query,
      type: 'TRACKS',
      limit: String(limit),
      countryCode: 'US',
    })

    const tracks = (data.tracks || []).map(tidalTrackToTrack)
    return {
      tracks,
      totalResults: data.tracks?.length || 0,
    }
  } catch (err) {
    console.error('Tidal search error:', err)
    return { tracks: [], totalResults: 0 }
  }
}

export async function getTidalTrack(trackId: number): Promise<Track | null> {
  try {
    const data = await tidalFetch(`/tracks/${trackId}`, { countryCode: 'US' })
    return tidalTrackToTrack(data)
  } catch {
    return null
  }
}

export async function searchTidalForMatch(
  artist: string,
  title: string
): Promise<Track | null> {
  const results = await searchTidal(`${artist} ${title}`, 5)
  if (results.tracks.length === 0) return null

  // Score matches by similarity
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim()
  const targetArtist = normalize(artist)
  const targetTitle = normalize(title)

  let bestMatch: Track | null = null
  let bestScore = 0

  for (const track of results.tracks) {
    const a = normalize(track.artist)
    const t = normalize(track.title)
    let score = 0

    if (a.includes(targetArtist) || targetArtist.includes(a)) score += 2
    if (t.includes(targetTitle) || targetTitle.includes(t)) score += 2
    if (t === targetTitle) score += 3
    if (a === targetArtist) score += 3

    if (score > bestScore) {
      bestScore = score
      bestMatch = track
    }
  }

  return bestScore >= 2 ? bestMatch : null
}
