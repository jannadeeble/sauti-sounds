const MUSICBRAINZ_BASE = 'https://musicbrainz.org/ws/2'
const COVER_ART_BASE = 'https://coverartarchive.org'
const ITUNES_BASE = 'https://itunes.apple.com/search'

export async function fetchArtwork(artist: string, album: string): Promise<string | null> {
  // Try MusicBrainz + Cover Art Archive
  try {
    const query = encodeURIComponent(`release:"${album}" AND artist:"${artist}"`)
    const mbRes = await fetch(
      `${MUSICBRAINZ_BASE}/release/?query=${query}&limit=1&fmt=json`,
      { headers: { 'User-Agent': 'SautiSounds/0.1 (sautisounds.app)' } }
    )
    if (mbRes.ok) {
      const data = await mbRes.json()
      if (data.releases?.length > 0) {
        const mbid = data.releases[0].id
        const artRes = await fetch(`${COVER_ART_BASE}/release/${mbid}/front-250`)
        if (artRes.ok) {
          const blob = await artRes.blob()
          return URL.createObjectURL(blob)
        }
      }
    }
  } catch { /* continue to fallback */ }

  // Fallback: iTunes Search API
  try {
    const query = encodeURIComponent(`${artist} ${album}`)
    const res = await fetch(`${ITUNES_BASE}?term=${query}&entity=album&limit=1`)
    if (res.ok) {
      const data = await res.json()
      if (data.results?.length > 0) {
        // Get larger artwork
        return data.results[0].artworkUrl100?.replace('100x100', '600x600') || null
      }
    }
  } catch { /* no artwork found */ }

  return null
}
