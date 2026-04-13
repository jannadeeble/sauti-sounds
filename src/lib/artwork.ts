import { useEffect, useMemo } from 'react'
import type { Track } from '../types'

function isPersistentArtworkUrl(url?: string) {
  return Boolean(url && !url.startsWith('blob:'))
}

export function resolveArtworkSource(track: Pick<Track, 'artworkBlob' | 'artworkUrl'>): {
  src?: string
  ownedUrl?: string
} {
  if (track.artworkBlob) {
    const ownedUrl = URL.createObjectURL(track.artworkBlob)
    return { src: ownedUrl, ownedUrl }
  }

  if (isPersistentArtworkUrl(track.artworkUrl)) {
    return { src: track.artworkUrl }
  }

  return {}
}

export function useTrackArtworkUrl(track: Pick<Track, 'artworkBlob' | 'artworkUrl'>) {
  const { artworkBlob, artworkUrl } = track
  const artwork = useMemo(
    () => resolveArtworkSource({ artworkBlob, artworkUrl }),
    [artworkBlob, artworkUrl],
  )

  useEffect(() => {
    return () => {
      if (artwork.ownedUrl) {
        URL.revokeObjectURL(artwork.ownedUrl)
      }
    }
  }, [artwork.ownedUrl])

  return artwork.src
}
