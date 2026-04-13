import { useEffect, useMemo } from 'react'
import type { Track } from '../types'

function isPersistentArtworkUrl(url?: string) {
  return Boolean(url && !url.startsWith('blob:'))
}

export function resolveArtworkSource(track: Pick<Track, 'artworkBlob' | 'artworkUrl' | 'artworkR2Key'>): {
  src?: string
  ownedUrl?: string
} {
  if (isPersistentArtworkUrl(track.artworkUrl)) {
    return { src: track.artworkUrl }
  }

  if (track.artworkBlob) {
    const ownedUrl = URL.createObjectURL(track.artworkBlob)
    return { src: ownedUrl, ownedUrl }
  }

  return {}
}

export function useTrackArtworkUrl(track: Pick<Track, 'artworkBlob' | 'artworkUrl' | 'artworkR2Key'>) {
  const { artworkBlob, artworkUrl, artworkR2Key } = track
  const artwork = useMemo(
    () => resolveArtworkSource({ artworkBlob, artworkUrl, artworkR2Key }),
    [artworkBlob, artworkUrl, artworkR2Key],
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
