import { useEffect, useMemo, useRef, useState } from 'react'
import type { Track } from '../types'
import { getPresignedUrl } from './r2Storage'

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
  const [remoteUrl, setRemoteUrl] = useState<string | undefined>()
  const artwork = useMemo(
    () => resolveArtworkSource({ artworkBlob, artworkUrl, artworkR2Key }),
    [artworkBlob, artworkUrl, artworkR2Key],
  )

  const allOwnedUrlsRef = useRef<string[]>([])

  useEffect(() => {
    if (artwork.ownedUrl) {
      allOwnedUrlsRef.current.push(artwork.ownedUrl)
    }
  }, [artwork.ownedUrl])

  useEffect(() => {
    const urls = allOwnedUrlsRef.current
    return () => {
      for (const url of urls) {
        URL.revokeObjectURL(url)
      }
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    if (artwork.src || !artworkR2Key) {
      setRemoteUrl(undefined)
      return
    }

    getPresignedUrl(artworkR2Key)
      .then((url) => {
        if (!cancelled) setRemoteUrl(url)
      })
      .catch(() => {
        if (!cancelled) setRemoteUrl(undefined)
      })

    return () => {
      cancelled = true
    }
  }, [artwork.src, artworkR2Key])

  return artwork.src || remoteUrl
}
