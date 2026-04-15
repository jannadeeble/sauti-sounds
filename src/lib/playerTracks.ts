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

    async function resolvePlaylist() {
      if (tracks.length === 0) {
        setState({
          playableTracks: [],
          playlist: [],
          currentPlayId: 1,
          errors: [],
          loading: false,
        })
        return
      }

      setState((current) => ({ ...current, loading: true }))

      const nextTracks: Track[] = []
      const nextPlaylist: ResolvedPlayerTrack[] = []
      const errors: string[] = []

      for (const track of tracks) {
        try {
          const { src, ownedUrl } = await resolveTrackSrc(track)
          if (ownedUrl) {
            ownedUrls.push(ownedUrl)
          }

          const { src: artworkSrc, ownedUrl: ownedArtworkUrl } = resolveArtworkSource(track)
          if (ownedArtworkUrl) {
            ownedUrls.push(ownedArtworkUrl)
          }

          const playableIndex = nextPlaylist.length

          nextTracks.push(track)
          nextPlaylist.push({
            id: buildAudioId(sessionId, playableIndex),
            trackId: track.id,
            source: track.source,
            src,
            name: track.title,
            writer: track.artist,
            img: artworkSrc,
            description: track.album,
            customTrackInfo: track.source === 'tidal' ? 'TIDAL' : 'Local file',
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error'
          errors.push(`${track.title} could not be prepared for playback (${message}).`)
        }
      }

      if (cancelled) {
        return
      }

      const safeIndex = Math.max(0, Math.min(startIndex, nextPlaylist.length - 1))
      const currentPlayId = nextPlaylist[safeIndex]?.id ?? 1

      setState({
        playableTracks: nextTracks,
        playlist: nextPlaylist,
        currentPlayId,
        errors,
        loading: false,
      })
    }

    void resolvePlaylist()

    return () => {
      cancelled = true
      // Defer revocation to component unmount — the audio element may still
      // be loading these URLs in the DOM. Revoking now would cause
      // ERR_FILE_NOT_FOUND during normal session transitions.
      allOwnedUrlsRef.current.push(...ownedUrls)
    }
  }, [tracks, sessionId, startIndex])

  return state
}
