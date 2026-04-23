import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ListMusic, Pause, Play, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react'
import { useTrackArtworkUrl } from '../lib/artwork'
import { maybeFillAutoRadio } from '../lib/autoRadio'
import { resolveTrackContext } from '../lib/listenContextRegistry'
import { flushActiveListen, reportPlayerTick } from '../lib/listenTracker'
import { formatTime } from '../lib/metadata'
import { useResolvedPlayerTracks, type ResolvedPlayerTrack } from '../lib/playerTracks'
import { rectFromElement } from '../lib/rect'
import { useHistoryStore } from '../stores/historyStore'
import { usePlaybackSessionStore } from '../stores/playbackSessionStore'
import type { Track } from '../types'

function PlayerIconButton({
  label,
  onClick,
  children,
  large = false,
}: {
  label: string
  onClick: () => void
  children: ReactNode
  large?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`workspace-player__icon-button${large ? ' workspace-player__icon-button--large' : ''}`}
    >
      {children}
    </button>
  )
}

function PlayerRuntime({
  playableTracks,
  playlist,
  startIndex,
}: {
  playableTracks: Track[]
  playlist: ResolvedPlayerTrack[]
  startIndex: number
}) {
  const setPlayerOpen = usePlaybackSessionStore((state) => state.setPlayerOpen)
  const syncPlayerState = usePlaybackSessionStore((state) => state.syncPlayerState)
  const recordPlay = useHistoryStore((state) => state.recordPlay)

  const initialTrackId = playlist[startIndex]?.trackId ?? playlist[0]?.trackId ?? null

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const lastLoadedTrackIdRef = useRef<string | null>(null)
  const lastRecordedTrackIdRef = useRef<string | null>(null)
  const pendingPlayRef = useRef(false)

  const [activeTrackId, setActiveTrackId] = useState<string | null>(initialTrackId)
  const [isPlaying, setIsPlaying] = useState(true)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [muted, setMuted] = useState(false)

  const currentIndex = useMemo(() => {
    if (!playlist.length) return 0
    if (!activeTrackId) return Math.max(0, Math.min(startIndex, playlist.length - 1))

    const index = playlist.findIndex((track) => track.trackId === activeTrackId)
    if (index >= 0) return index

    return Math.max(0, Math.min(startIndex, playlist.length - 1))
  }, [activeTrackId, playlist, startIndex])

  const currentTrack = playableTracks[currentIndex] ?? null
  const resolvedTrack = playlist[currentIndex] ?? null
  const artworkUrl = useTrackArtworkUrl(currentTrack ?? {})
  const progressRatio = duration > 0 ? Math.min(currentTime / duration, 1) : 0

  const volumeIcon = muted
    ? <VolumeX size={18} strokeWidth={2.05} />
    : <Volume2 size={18} strokeWidth={2.05} />

  const handlePrevious = useCallback(() => {
    const audio = audioRef.current

    if (audio && audio.currentTime > 5) {
      audio.currentTime = 0
      setCurrentTime(0)
      return
    }

    const previousTrack = playlist[Math.max(0, currentIndex - 1)]
    if (previousTrack) {
      setActiveTrackId(previousTrack.trackId)
      setIsPlaying(true)
    }
  }, [currentIndex, playlist])

  const handleNext = useCallback(() => {
    const nextTrack = playlist[Math.min(playlist.length - 1, currentIndex + 1)]
    if (nextTrack && nextTrack.trackId !== activeTrackId) {
      setActiveTrackId(nextTrack.trackId)
      setIsPlaying(true)
    }
  }, [activeTrackId, currentIndex, playlist])

  const handleSeek = useCallback((nextTime: number) => {
    const audio = audioRef.current
    if (!audio || !isFinite(nextTime)) return

    audio.currentTime = nextTime
    setCurrentTime(nextTime)
  }, [])

  const attemptPlayback = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return

    pendingPlayRef.current = true

    void audio.play().then(() => {
      pendingPlayRef.current = false
    }).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return
      }

      pendingPlayRef.current = false
      setIsPlaying(false)
    })
  }, [])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !resolvedTrack) return
    if (lastLoadedTrackIdRef.current === resolvedTrack.trackId && audio.src === resolvedTrack.src) return

    lastLoadedTrackIdRef.current = resolvedTrack.trackId
    pendingPlayRef.current = isPlaying
    audio.src = resolvedTrack.src
    audio.load()
  }, [isPlaying, resolvedTrack])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    audio.volume = 1
    audio.muted = muted
  }, [muted])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !resolvedTrack) return

    if (isPlaying) {
      if (audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
        attemptPlayback()
      } else {
        pendingPlayRef.current = true
      }
      return
    }

    pendingPlayRef.current = false
    audio.pause()
  }, [attemptPlayback, isPlaying, resolvedTrack])

  useEffect(() => {
    syncPlayerState({
      currentTrack,
      currentIndex,
      isPlaying,
      currentTime,
      duration,
    })
  }, [currentIndex, currentTime, currentTrack, duration, isPlaying, syncPlayerState])

  useEffect(() => {
    if (!currentTrack || !isPlaying) return
    if (lastRecordedTrackIdRef.current === currentTrack.id) return

    lastRecordedTrackIdRef.current = currentTrack.id
    void recordPlay(currentTrack)
  }, [currentTrack, isPlaying, recordPlay])

  useEffect(() => {
    void reportPlayerTick(
      {
        track: currentTrack,
        isPlaying,
        positionMs: Math.round(currentTime * 1000),
        durationSec: duration,
      },
      resolveTrackContext,
    )
  }, [currentTrack, currentTime, duration, isPlaying])

  useEffect(() => {
    return () => {
      void flushActiveListen('unmount')
    }
  }, [])

  useEffect(() => {
    if (!currentTrack) return
    if (currentIndex !== playableTracks.length - 1) return
    if (duration <= 0) return
    if (currentTime / duration < 0.8) return

    void maybeFillAutoRadio(currentTrack)
  }, [currentIndex, currentTime, currentTrack, duration, playableTracks.length])

  useEffect(() => {
    if (!('mediaSession' in navigator)) return

    navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused'

    if (currentTrack) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentTrack.title,
        artist: currentTrack.artist,
        album: currentTrack.album,
        artwork: artworkUrl
          ? [{ src: artworkUrl, sizes: '512x512', type: 'image/jpeg' }]
          : [],
      })
    }

    const actions: Array<['play' | 'pause' | 'previoustrack' | 'nexttrack', () => void]> = [
      ['play', () => setIsPlaying(true)],
      ['pause', () => setIsPlaying(false)],
      ['previoustrack', handlePrevious],
      ['nexttrack', handleNext],
    ]

    for (const [action, handler] of actions) {
      try {
        navigator.mediaSession.setActionHandler(action, handler)
      } catch {
        // Some platforms do not support every action.
      }
    }

    if (duration > 0) {
      try {
        navigator.mediaSession.setPositionState({
          duration,
          position: Math.min(currentTime, duration),
          playbackRate: 1,
        })
      } catch {
        // Some platforms reject position state updates.
      }
    }
  }, [artworkUrl, currentTime, currentTrack, duration, handleNext, handlePrevious, isPlaying])

  if (!resolvedTrack || !currentTrack) return null

  return (
    <div className="workspace-player pointer-events-auto mx-auto max-w-[980px]">
      <audio
        ref={audioRef}
        preload="metadata"
        onLoadStart={() => {
          setCurrentTime(0)
          setDuration(0)
        }}
        onCanPlay={() => {
          if (pendingPlayRef.current || isPlaying) {
            attemptPlayback()
          }
        }}
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
        onDurationChange={(event) => setDuration(event.currentTarget.duration || 0)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onPlay={() => {
          pendingPlayRef.current = false
          setIsPlaying(true)
        }}
        onPause={() => {
          if (pendingPlayRef.current) return
          setIsPlaying(false)
        }}
        onEnded={() => {
          const nextTrack = playlist[currentIndex + 1]
          if (nextTrack) {
            setActiveTrackId(nextTrack.trackId)
            setIsPlaying(true)
            return
          }

          setIsPlaying(false)
        }}
      />

      <div className="workspace-player__card">
        <div className="workspace-player__header">
          <div className="workspace-player__identity">
            <div className="workspace-player__artwork">
              {artworkUrl ? (
                <img src={artworkUrl} alt="" className="workspace-player__artwork-image" />
              ) : (
                <div className="workspace-player__artwork-fallback">♪</div>
              )}
            </div>

            <div className="workspace-player__copy">
              <p className="workspace-player__title">{currentTrack.title}</p>
              <p className="workspace-player__artist">{currentTrack.artist}</p>
            </div>
          </div>

        </div>

        <div className="workspace-player__transport">
          <div className="workspace-player__transport-side workspace-player__transport-side--left">
            <PlayerIconButton
              label={muted ? 'Unmute playback' : 'Mute playback'}
              onClick={() => setMuted((current) => !current)}
            >
              {volumeIcon}
            </PlayerIconButton>
          </div>

          <div className="workspace-player__transport-center">
            <PlayerIconButton label="Previous track" onClick={handlePrevious}>
              <SkipBack size={18} strokeWidth={2.05} />
            </PlayerIconButton>
            <PlayerIconButton
              label={isPlaying ? 'Pause' : 'Play'}
              onClick={() => setIsPlaying((current) => !current)}
              large
            >
              {isPlaying ? <Pause size={20} strokeWidth={2.1} /> : <Play size={20} strokeWidth={2.1} />}
            </PlayerIconButton>
            <PlayerIconButton label="Next track" onClick={handleNext}>
              <SkipForward size={18} strokeWidth={2.05} />
            </PlayerIconButton>
          </div>

          <div className="workspace-player__transport-side workspace-player__transport-side--right">
            <PlayerIconButton
              label={`Open queue (${playlist.length} tracks)`}
              onClick={() => {
                const active = document.activeElement instanceof Element ? document.activeElement : null
                setPlayerOpen(true, rectFromElement(active))
              }}
            >
              <ListMusic size={18} strokeWidth={2.05} />
            </PlayerIconButton>
          </div>
        </div>

        <div className="workspace-player__progress">
          <span className="workspace-player__time">{formatTime(currentTime)}</span>
          <label className="workspace-player__seekbar">
            <span className="workspace-player__seekbar-track" aria-hidden="true">
              <span
                className="workspace-player__seekbar-fill"
                style={{ transform: `scaleX(${progressRatio})` }}
              />
            </span>
            <input
              className="workspace-player__seekbar-input"
              type="range"
              min="0"
              max={duration || 0}
              step="0.1"
              value={Math.min(currentTime, duration || 0)}
              onChange={(event) => handleSeek(Number(event.target.value))}
              aria-label="Seek playback"
            />
          </label>
          <span className="workspace-player__time">{formatTime(duration)}</span>
        </div>
      </div>
    </div>
  )
}

export default function WorkspacePlayer() {
  const tracks = usePlaybackSessionStore((state) => state.tracks)
  const sessionId = usePlaybackSessionStore((state) => state.sessionId)
  const startIndex = usePlaybackSessionStore((state) => state.startIndex)
  const requestedTrackId = usePlaybackSessionStore((state) => state.requestedTrackId)
  const setErrorMessage = usePlaybackSessionStore((state) => state.setErrorMessage)

  const { playableTracks, playlist, currentIndex: resolvedStartIndex, errors, loading } = useResolvedPlayerTracks(
    tracks,
    sessionId,
    startIndex,
    requestedTrackId,
  )

  useEffect(() => {
    setErrorMessage(errors[0] || null)
  }, [errors, setErrorMessage])

  if (tracks.length === 0) return null

  if (loading && playlist.length === 0) {
    return (
      <div className="pointer-events-none fixed inset-x-0 bottom-[76px] z-30 px-4 lg:bottom-4">
        <div className="pointer-events-auto mx-auto max-w-[980px] rounded-2xl border border-white/10 bg-surface-900/95 px-5 py-4 shadow-[0_12px_40px_rgba(17,17,22,0.22)] backdrop-blur-2xl">
          <p className="text-sm text-gray-400">Preparing playback…</p>
        </div>
      </div>
    )
  }

  if (playlist.length === 0) return null

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-2 z-30 px-4">
      <PlayerRuntime
        key={sessionId}
        playableTracks={playableTracks}
        playlist={playlist}
        startIndex={resolvedStartIndex}
      />
    </div>
  )
}
