import { useEffect, useRef, useState } from 'react'
import { getPresignedUrl } from './r2Storage'
import { resolveArtworkSource } from './artwork'
import type { Track } from '../types'

export interface ResolvedPlayerTrack {
  description?: string
  id: string
  img?: string
  name?: string
  source: Track['source']
  src: string
  trackId: string
  writer?: string
}

interface ResolvedPlayerPlaylist {
  currentIndex: number
  errors: string[]
  loading: boolean
  playableTracks: Track[]
  playlist: ResolvedPlayerTrack[]
}

async function resolveTrackSrc(track: Track): Promise<{ ownedUrl?: string; src: string }> {
  if (track.audioUrl) {
    return { src: track.audioUrl }
  }

  if (track.r2Key) {
    try {
      const url = await getPresignedUrl(track.r2Key)
      return { src: url }
    } catch {
      // Fall through to local blob fallback.
    }
  }

  if (track.audioBlob) {
    const ownedUrl = URL.createObjectURL(track.audioBlob)
    return { src: ownedUrl, ownedUrl }
  }

  if (track.fileHandle) {
    const file = await track.fileHandle.getFile()
    const ownedUrl = URL.createObjectURL(file)
    return { src: ownedUrl, ownedUrl }
  }

  throw new Error('No audio source available')
}

function buildAudioId(sessionId: number, trackId: string) {
  return `${sessionId}-${trackId}`
}

function pickPreferredIndex(tracks: Track[], startIndex: number, preferredTrackId?: string | null) {
  if (preferredTrackId) {
    const preferredIndex = tracks.findIndex((track) => track.id === preferredTrackId)
    if (preferredIndex >= 0) return preferredIndex
  }

  return Math.max(0, Math.min(startIndex, tracks.length - 1))
}

export function useResolvedPlayerTracks(
  tracks: Track[],
  sessionId: number,
  startIndex: number,
  preferredTrackId?: string | null,
): ResolvedPlayerPlaylist {
  const [state, setState] = useState<ResolvedPlayerPlaylist>({
    currentIndex: 0,
    errors: [],
    loading: false,
    playableTracks: [],
    playlist: [],
  })
  const allOwnedUrlsRef = useRef<string[]>([])

  useEffect(() => {
    return () => {
      for (const url of allOwnedUrlsRef.current) {
        URL.revokeObjectURL(url)
      }
      allOwnedUrlsRef.current = []
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const ownedUrls: string[] = []

    async function resolveOne(track: Track): Promise<ResolvedPlayerTrack> {
      const { src, ownedUrl } = await resolveTrackSrc(track)
      if (ownedUrl) ownedUrls.push(ownedUrl)

      const { src: artworkSrc, ownedUrl: ownedArtworkUrl } = resolveArtworkSource(track)
      if (ownedArtworkUrl) ownedUrls.push(ownedArtworkUrl)

      return {
        id: buildAudioId(sessionId, track.id),
        trackId: track.id,
        source: track.source,
        src,
        name: track.title,
        writer: track.artist,
        img: artworkSrc,
        description: track.album,
      }
    }

    async function resolvePlaylist() {
      if (tracks.length === 0) {
        setState({
          currentIndex: 0,
          errors: [],
          loading: false,
          playableTracks: [],
          playlist: [],
        })
        return
      }

      const preferredIndex = pickPreferredIndex(tracks, startIndex, preferredTrackId)
      const preferredTrack = tracks[preferredIndex]

      setState((current) => ({
        ...current,
        loading: true,
      }))

      let preferredResolved: ResolvedPlayerTrack | null = null
      try {
        preferredResolved = await resolveOne(preferredTrack)
      } catch {
        // Surfaced in the full pass below.
      }

      if (cancelled) return

      if (preferredResolved) {
        setState(() => ({
          currentIndex: 0,
          errors: [],
          loading: tracks.length > 1,
          playableTracks: [preferredTrack],
          playlist: [preferredResolved],
        }))
      }

      const settled = await Promise.allSettled(tracks.map((track) => resolveOne(track)))
      if (cancelled) return

      const nextTracks: Track[] = []
      const nextPlaylist: ResolvedPlayerTrack[] = []
      const errors: string[] = []

      settled.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          nextTracks.push(tracks[index])
          nextPlaylist.push(result.value)
          return
        }

        const reason = result.reason
        const message = reason instanceof Error ? reason.message : 'Unknown error'
        errors.push(`${tracks[index].title} could not be prepared for playback (${message}).`)
      })

      const preferredTrackKey = preferredTrackId ?? preferredTrack.id
      const nextCurrentIndex = Math.max(
        0,
        nextTracks.findIndex((track) => track.id === preferredTrackKey),
      )

      setState({
        currentIndex: nextPlaylist.length > 0 ? nextCurrentIndex : 0,
        errors,
        loading: false,
        playableTracks: nextTracks,
        playlist: nextPlaylist,
      })
    }

    void resolvePlaylist()

    return () => {
      cancelled = true
      allOwnedUrlsRef.current.push(...ownedUrls)
    }
  }, [tracks, sessionId, startIndex, preferredTrackId])

  return state
}
