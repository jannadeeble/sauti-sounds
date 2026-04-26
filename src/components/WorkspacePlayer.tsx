import { type MouseEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Heart, ListMusic, LoaderCircle, MoreVertical, Pause, Play, Radio, SkipBack, SkipForward } from 'lucide-react'
import AddToPlaylistDialog from './AddToPlaylistDialog'
import MorphSurface from './MorphSurface'
import { useTrackArtworkUrl } from '../lib/artwork'
import { toApiUrl } from '../lib/api'
import { maybeFillAutoRadio } from '../lib/autoRadio'
import { isLLMConfigured } from '../lib/llm'
import { resolveTrackContext } from '../lib/listenContextRegistry'
import { flushActiveListen, reportPlayerTick } from '../lib/listenTracker'
import { formatTime } from '../lib/metadata'
import { useResolvedPlayerTracks, type ResolvedPlayerTrack } from '../lib/playerTracks'
import { rectFromElement } from '../lib/rect'
import { useAIModalStore } from '../stores/aiModalStore'
import { useHistoryStore } from '../stores/historyStore'
import { useLibraryStore } from '../stores/libraryStore'
import { usePlaybackSessionStore } from '../stores/playbackSessionStore'
import { useTidalStore } from '../stores/tidalStore'
import type { Track } from '../types'

interface PlayerTrackAction {
  label: string
  icon?: ReactNode
  onClick: () => void
  destructive?: boolean
}

function buildWaveformBars(channelData: Float32Array, barCount: number): number[] {
  const samplesPerBar = Math.max(1, Math.floor(channelData.length / barCount))
  const bars: number[] = []
  let max = 0

  for (let index = 0; index < barCount; index++) {
    const offset = index * samplesPerBar
    let sum = 0
    let peak = 0
    let samples = 0

    for (let sampleIndex = 0; sampleIndex < samplesPerBar && offset + sampleIndex < channelData.length; sampleIndex++) {
      const value = Math.abs(channelData[offset + sampleIndex])
      peak = Math.max(peak, value)
      sum += value * value
      samples++
    }

    const rms = samples > 0 ? Math.sqrt(sum / samples) : 0
    const amplitude = (peak * 0.72) + (rms * 0.28)
    bars.push(amplitude)
    max = Math.max(max, amplitude)
  }

  return max > 0 ? bars.map((bar) => bar / max) : bars
}

async function decodeWaveformFromBuffer(arrayBuffer: ArrayBuffer, signal: AbortSignal): Promise<number[]> {
  if (signal.aborted) return []

  const AudioContextConstructor = window.AudioContext
    ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioContextConstructor) return []

  const audioContext = new AudioContextConstructor()
  try {
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)
    if (signal.aborted) return []
    return buildWaveformBars(audioBuffer.getChannelData(0), 96)
  } finally {
    void audioContext.close()
  }
}

async function decodeWaveformForTrack(track: Track, src: string, signal: AbortSignal): Promise<number[]> {
  if (track.audioBlob) {
    return decodeWaveformFromBuffer(await track.audioBlob.arrayBuffer(), signal)
  }

  if (track.fileHandle) {
    const file = await track.fileHandle.getFile()
    return decodeWaveformFromBuffer(await file.arrayBuffer(), signal)
  }

  if (track.r2Key) {
    const response = await fetch(toApiUrl(`/api/storage/${track.r2Key}/stream`), {
      credentials: 'include',
      signal,
    })
    if (!response.ok) throw new Error('Stored waveform source could not be loaded')
    return decodeWaveformFromBuffer(await response.arrayBuffer(), signal)
  }

  const response = await fetch(src, { signal })
  if (!response.ok) throw new Error('Waveform source could not be loaded')
  return decodeWaveformFromBuffer(await response.arrayBuffer(), signal)
}

function PlayerIconButton({
  label,
  onClick,
  children,
  large = false,
}: {
  label: string
  onClick: (event: MouseEvent<HTMLButtonElement>) => void
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
  const libraryTracks = useLibraryStore((state) => state.tracks)
  const toggleTidalFavorite = useLibraryStore((state) => state.toggleTidalFavorite)
  const removeTrack = useLibraryStore((state) => state.removeTrack)
  const tidalConnected = useTidalStore((state) => state.tidalConnected)
  const openAIModal = useAIModalStore((state) => state.open)

  const initialTrackId = playlist[startIndex]?.trackId ?? playlist[0]?.trackId ?? null

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const lastLoadedTrackIdRef = useRef<string | null>(null)
  const lastLoadedSrcRef = useRef<string | null>(null)
  const lastRecordedTrackIdRef = useRef<string | null>(null)
  const pendingPlayRef = useRef(false)
  const isPlayingRef = useRef(true)

  const [activeTrackId, setActiveTrackId] = useState<string | null>(initialTrackId)
  const [isPlaying, setIsPlaying] = useState(true)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playbackPending, setPlaybackPending] = useState(true)
  const [showActions, setShowActions] = useState(false)
  const [showPlaylistDialog, setShowPlaylistDialog] = useState(false)
  const [originRect, setOriginRect] = useState<ReturnType<typeof rectFromElement>>(null)
  const [waveform, setWaveform] = useState<{ src: string; bars: number[] } | null>(null)

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
  const waveformBars = currentTrack?.waveformData?.length
    ? currentTrack.waveformData
    : waveform?.src === resolvedTrack?.src
      ? waveform.bars
      : []
  const aiAvailable = isLLMConfigured()
  const isInLibrary = currentTrack ? libraryTracks.some((candidate) => candidate.id === currentTrack.id) : false
  const playerTrackActions: PlayerTrackAction[] = currentTrack
    ? [
        {
          label: 'Add to playlist',
          onClick: () => setShowPlaylistDialog(true),
        },
        ...(aiAvailable
          ? [
              {
                label: 'Make a setlist from this',
                onClick: () => openAIModal('setlist-seed', currentTrack, undefined, originRect),
              },
              {
                label: 'AI playlist from this track',
                onClick: () => openAIModal('playlist-from-track', currentTrack, undefined, originRect),
              },
            ] satisfies PlayerTrackAction[]
          : []),
        ...(currentTrack.source === 'tidal' && tidalConnected
          ? [{
              label: currentTrack.isFavorite ? 'Remove from TIDAL favorites' : 'Add to TIDAL favorites',
              icon: currentTrack.isFavorite
                ? <Heart size={15} className="fill-red-400 text-red-400" />
                : <Radio size={15} className="text-cyan-600" />,
              onClick: () => void toggleTidalFavorite(currentTrack),
            } satisfies PlayerTrackAction]
          : []),
        ...(isInLibrary
          ? [{
              label: 'Remove from library',
              destructive: true,
              onClick: () => {
                if (!window.confirm(`Remove "${currentTrack.title}" from your library?`)) return
                void removeTrack(currentTrack.id)
              },
            } satisfies PlayerTrackAction]
          : []),
      ]
    : []

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
    setPlaybackPending(true)

    void audio.play().then(() => {
      pendingPlayRef.current = false
      setPlaybackPending(false)
    }).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return
      }

      pendingPlayRef.current = false
      setPlaybackPending(false)
      setIsPlaying(false)
    })
  }, [])

  useEffect(() => {
    isPlayingRef.current = isPlaying
  }, [isPlaying])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !resolvedTrack) return
    if (lastLoadedTrackIdRef.current === resolvedTrack.trackId && lastLoadedSrcRef.current === resolvedTrack.src) return

    lastLoadedTrackIdRef.current = resolvedTrack.trackId
    lastLoadedSrcRef.current = resolvedTrack.src
    pendingPlayRef.current = isPlayingRef.current
    setPlaybackPending(isPlayingRef.current)
    audio.src = resolvedTrack.src
    audio.load()
  }, [resolvedTrack])

  useEffect(() => {
    if (!resolvedTrack?.src || !currentTrack || currentTrack.waveformData?.length) return

    const controller = new AbortController()

    void decodeWaveformForTrack(currentTrack, resolvedTrack.src, controller.signal)
      .then((bars) => {
        if (!controller.signal.aborted) {
          setWaveform({ src: resolvedTrack.src, bars })
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setWaveform({ src: resolvedTrack.src, bars: [] })
        }
      })

    return () => controller.abort()
  }, [currentTrack, resolvedTrack?.src])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !resolvedTrack) return

    if (isPlaying) {
      if (audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
        window.queueMicrotask(attemptPlayback)
      } else {
        pendingPlayRef.current = true
      }
      return
    }

    pendingPlayRef.current = false
    setPlaybackPending(false)
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
          setPlaybackPending(isPlayingRef.current)
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
          setPlaybackPending(false)
          setIsPlaying(true)
        }}
        onPlaying={() => setPlaybackPending(false)}
        onWaiting={() => {
          if (isPlayingRef.current) setPlaybackPending(true)
        }}
        onPause={(event) => {
          if (pendingPlayRef.current) return
          setCurrentTime(event.currentTarget.currentTime)
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
        <div className="workspace-player__transport">
          <div className="workspace-player__transport-side workspace-player__transport-side--left">
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

          <div className="workspace-player__transport-center">
            <PlayerIconButton label="Previous track" onClick={handlePrevious}>
              <SkipBack size={18} strokeWidth={2.05} />
            </PlayerIconButton>
            <PlayerIconButton
              label={isPlaying ? 'Pause' : 'Play'}
              onClick={() => setIsPlaying((current) => !current)}
              large
            >
              {isPlaying && playbackPending
                ? <LoaderCircle size={20} className="animate-spin" />
                : isPlaying
                  ? <Pause size={20} strokeWidth={2.1} />
                  : <Play size={20} strokeWidth={2.1} />}
            </PlayerIconButton>
            <PlayerIconButton label="Next track" onClick={handleNext}>
              <SkipForward size={18} strokeWidth={2.05} />
            </PlayerIconButton>
          </div>

          <div className="workspace-player__transport-side workspace-player__transport-side--right">
            <PlayerIconButton
              label={`More actions for ${currentTrack.title}`}
              onClick={(event) => {
                setOriginRect(rectFromElement(event.currentTarget))
                setShowActions(true)
              }}
            >
              <MoreVertical size={18} strokeWidth={2.05} />
            </PlayerIconButton>
          </div>
        </div>

        <div className="workspace-player__progress">
          <label className="workspace-player__seekbar">
            <span className="workspace-player__waveform" aria-hidden="true">
              {waveformBars.length > 0 ? (
                <span className="workspace-player__waveform-bars">
                  {waveformBars.map((height, index) => (
                    <span
                      key={index}
                      className="workspace-player__waveform-bar"
                      style={{
                        height: `${Math.max(height * 100, 7)}%`,
                        color: index / Math.max(waveformBars.length - 1, 1) <= progressRatio
                          ? '#ef5466'
                          : 'rgba(255, 255, 255, 0.2)',
                      }}
                    />
                  ))}
                </span>
              ) : (
                <span className="workspace-player__waveform-empty" />
              )}
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
          <div className="workspace-player__time-row">
            <span className="workspace-player__time">{formatTime(currentTime)}</span>
            <div className="workspace-player__meta-line">
              <span className="workspace-player__title">{currentTrack.title}</span>
              <span className="workspace-player__meta-separator">·</span>
              <span className="workspace-player__artist">{currentTrack.artist}</span>
            </div>
            <span className="workspace-player__time">{formatTime(duration)}</span>
          </div>
        </div>
      </div>

      <MorphSurface
        open={showActions}
        onClose={() => setShowActions(false)}
        title={currentTrack.title}
        description={currentTrack.artist}
        originRect={originRect}
        variant="light"
        size="sm"
        align="bottom"
      >
        <div className="sauti-modal-card-muted mb-3 flex items-center gap-3 px-3 py-3">
          <div className="h-12 w-12 overflow-hidden rounded-[14px] bg-white">
            {artworkUrl ? (
              <img src={artworkUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-lg text-[#9ea0aa]">♪</div>
            )}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-[#111116]">{currentTrack.title}</p>
            <p className="truncate text-xs text-[#7a7b86]">{currentTrack.artist}</p>
          </div>
        </div>

        <div className="space-y-1">
          {playerTrackActions.map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={() => {
                action.onClick()
                setShowActions(false)
              }}
              className={`sauti-modal-action-row text-sm ${action.destructive ? 'sauti-modal-action-row-danger' : ''}`}
            >
              {action.icon ?? null}
              <span>{action.label}</span>
            </button>
          ))}
        </div>
      </MorphSurface>

      <AddToPlaylistDialog
        open={showPlaylistDialog}
        track={currentTrack}
        originRect={originRect}
        onClose={() => setShowPlaylistDialog(false)}
      />
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
      <div className="pointer-events-none fixed inset-x-0 bottom-[76px] z-30 px-2 sm:bottom-[88px] sm:px-4">
        <div className="pointer-events-auto mx-auto max-w-[980px] rounded-2xl border border-white/10 bg-surface-900/95 px-5 py-4 shadow-[0_12px_40px_rgba(17,17,22,0.22)] backdrop-blur-2xl">
          <p className="text-sm text-gray-400">Preparing playback…</p>
        </div>
      </div>
    )
  }

  if (playlist.length === 0) return null

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[76px] z-30 px-2 sm:bottom-[88px] sm:px-4">
      <PlayerRuntime
        key={sessionId}
        playableTracks={playableTracks}
        playlist={playlist}
        startIndex={resolvedStartIndex}
      />
    </div>
  )
}
