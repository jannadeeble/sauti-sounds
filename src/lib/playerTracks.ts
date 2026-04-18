import { useEffect, useRef, useState } from 'react'
import type { AudioData } from 'react-modern-audio-player'
import { getPresignedUrl } from './r2Storage'
import { resolveArtworkSource } from './artwork'
import type { Track } from '../types'

export interface ResolvedPlayerTrack extends AudioData {
  trackId: string
  source: Track['source']
}

interface ResolvedPlayerPlaylist {
  playableTracks: Track[]
  playlist: ResolvedPlayerTrack[]
  currentPlayId: number
  errors: string[]
  loading: boolean
}

async function resolveTrackSrc(track: Track): Promise<{ src: string; ownedUrl?: string }> {
  if (track.audioUrl) {
    return { src: track.audioUrl }
  }

  if (track.r2Key) {
    try {
      const url = await getPresignedUrl(track.r2Key)
      return { src: url }
    } catch {
      // Fall through to local blob fallback
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

function buildAudioId(sessionId: number, playableIndex: number) {
  return sessionId * 1000 + playableIndex + 1
}

export function useResolvedPlayerTracks(
  tracks: Track[],
  sessionId: number,
  startIndex: number,
): ResolvedPlayerPlaylist {
  const [state, setState] = useState<ResolvedPlayerPlaylist>({
    playableTracks: [],
    playlist: [],
    currentPlayId: 1,
    errors: [],
    loading: false,
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

    // Resolve a single track and return a ResolvedPlayerTrack.
    // playableIndex is its position in the final (success-only) playlist.
    async function resolveOne(
      track: Track,
      playableIndex: number,
    ): Promise<ResolvedPlayerTrack> {
      const { src, ownedUrl } = await resolveTrackSrc(track)
      if (ownedUrl) ownedUrls.push(ownedUrl)
      const { src: artworkSrc, ownedUrl: ownedArtworkUrl } = resolveArtworkSource(track)
      if (ownedArtworkUrl) ownedUrls.push(ownedArtworkUrl)
      return {
        id: buildAudioId(sessionId, playableIndex),
        trackId: track.id,
        source: track.source,
        src,
        name: track.title,
        writer: track.artist,
        img: artworkSrc,
        description: track.album,
        customTrackInfo: track.source === 'tidal' ? 'TIDAL' : undefined,
      }
    }

    async function resolvePlaylist() {
      if (tracks.length === 0) {
        setState({ playableTracks: [], playlist: [], currentPlayId: 1, errors: [], loading: false })
        return
      }

      setState((current) => ({ ...current, loading: true }))

      const safeStart = Math.max(0, Math.min(startIndex, tracks.length - 1))

      // ── Phase 1: resolve the clicked track first so playback starts immediately ──
      let startResolved: ResolvedPlayerTrack | null = null
      try {
        startResolved = await resolveOne(tracks[safeStart], 0)
      } catch {
        // will surface in the full-pass errors below
      }

      if (cancelled) return

      if (startResolved) {
        setState({
          playableTracks: [tracks[safeStart]],
          playlist: [startResolved],
          currentPlayId: startResolved.id,
          errors: [],
          loading: tracks.length > 1,
        })
      }

      if (tracks.length === 1) return

      // ── Phase 2: resolve every other track concurrently ──
      const otherIndices = tracks.map((_, i) => i).filter((i) => i !== safeStart)
      const settled = await Promise.allSettled(
        otherIndices.map((i) => resolveOne(tracks[i], i /* temp id slot */)),
      )

      if (cancelled) return

      // Rebuild ordered playlist (start track + others in original order)
      const nextTracks: Track[] = []
      const nextPlaylist: ResolvedPlayerTrack[] = []
      const errors: string[] = []

      for (let i = 0; i < tracks.length; i++) {
        if (i === safeStart) {
          if (startResolved) {
            nextTracks.push(tracks[i])
            nextPlaylist.push({ ...startResolved, id: buildAudioId(sessionId, nextPlaylist.length) })
          } else {
            errors.push(`${tracks[i].title} could not be prepared for playback.`)
          }
        } else {
          const settledIdx = otherIndices.indexOf(i)
          const result = settled[settledIdx]
          if (result?.status === 'fulfilled') {
            nextTracks.push(tracks[i])
            nextPlaylist.push({ ...result.value, id: buildAudioId(sessionId, nextPlaylist.length) })
          } else {
            const reason = result?.status === 'rejected' ? result.reason : null
            const msg = reason instanceof Error ? reason.message : 'Unknown error'
            errors.push(`${tracks[i].title} could not be prepared for playback (${msg}).`)
          }
        }
      }

      const currentPlayId =
        nextPlaylist.find((p) => p.trackId === tracks[safeStart].id)?.id ?? nextPlaylist[0]?.id ?? 1

      setState({ playableTracks: nextTracks, playlist: nextPlaylist, currentPlayId, errors, loading: false })
    }

    void resolvePlaylist()

    return () => {
      cancelled = true
      allOwnedUrlsRef.current.push(...ownedUrls)
    }
  }, [tracks, sessionId, startIndex])

  return state
}
