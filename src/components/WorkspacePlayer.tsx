import { useEffect, useMemo, useRef } from 'react'
import AudioPlayer, { type InterfacePlacement, useAudioPlayer } from 'react-modern-audio-player'
import { ChevronUp, ListMusic, Radio } from 'lucide-react'
import { useTrackArtworkUrl } from '../lib/artwork'
import { useResolvedPlayerTracks } from '../lib/playerTracks'
import { useHistoryStore } from '../stores/historyStore'
import { usePlaybackSessionStore } from '../stores/playbackSessionStore'
import type { Track } from '../types'

function PlayerSessionChip({ tracks }: { tracks: Track[] }) {
  const {
    currentIndex,
    isPlaying,
    currentTime,
    duration,
    next,
    prev,
    togglePlay,
    playList,
  } = useAudioPlayer()
  const setPlayerOpen = usePlaybackSessionStore((state) => state.setPlayerOpen)
  const syncPlayerState = usePlaybackSessionStore((state) => state.syncPlayerState)
  const recordPlay = useHistoryStore((state) => state.recordPlay)
  const lastRecordedTrackId = useRef<string | null>(null)

  const currentTrack = tracks[currentIndex] ?? null
  const artworkUrl = useTrackArtworkUrl(currentTrack ?? {})

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
    if (lastRecordedTrackId.current === currentTrack.id) return
    lastRecordedTrackId.current = currentTrack.id
    void recordPlay(currentTrack)
  }, [currentTrack, isPlaying, recordPlay])

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
      ['play', () => togglePlay()],
      ['pause', () => togglePlay()],
      ['previoustrack', () => prev()],
      ['nexttrack', () => next()],
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
        // Older Android builds can reject position state updates.
      }
    }
  }, [artworkUrl, currentTime, currentTrack, duration, isPlaying, next, prev, togglePlay])

  return (
    <div className="workspace-player-chip">
      <div className="workspace-player-chip__meta">
        {currentTrack?.source === 'tidal' ? (
          <span className="workspace-player-chip__context">
            <Radio size={11} className="text-cyan-300" />
            TIDAL
          </span>
        ) : null}
      </div>
      <button
        type="button"
        className="workspace-player-chip__toggle"
        onClick={() => setPlayerOpen(true)}
        aria-label="Open queue"
      >
        <ListMusic size={14} />
        <span>{playList.length}</span>
        <ChevronUp size={14} />
      </button>
    </div>
  )
}

export default function WorkspacePlayer() {
  const tracks = usePlaybackSessionStore((state) => state.tracks)
  const sessionId = usePlaybackSessionStore((state) => state.sessionId)
  const startIndex = usePlaybackSessionStore((state) => state.startIndex)
  const setErrorMessage = usePlaybackSessionStore((state) => state.setErrorMessage)

  const { playableTracks, playlist, currentPlayId, errors, loading } = useResolvedPlayerTracks(
    tracks,
    sessionId,
    startIndex,
  )

  useEffect(() => {
    setErrorMessage(errors[0] || null)
  }, [errors, setErrorMessage])

  const placement = useMemo(
    () =>
      ({
        player: 'static',
        playList: 'top',
        interface: {
          customComponentsArea: {
            sessionMeta: 'row1-10',
          },
        } as InterfacePlacement<11>,
      }) as const,
    [],
  )

  const activeUI = useMemo(
    () => ({
      artwork: true,
      playButton: true,
      prevNnext: true,
      volume: true,
      repeatType: true,
      trackTime: true,
      trackInfo: true,
      progress: 'bar' as const,
      playList: false as const,
    }),
    [],
  )

  const audioInitialState = useMemo(
    () => ({
      curPlayId: currentPlayId,
      isPlaying: true,
      volume: 1,
    }),
    [currentPlayId, sessionId],
  )

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

  if (playlist.length === 0) {
    return null
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[76px] z-30 px-4 lg:bottom-4">
      <div className="pointer-events-auto mx-auto max-w-[980px] overflow-hidden rounded-2xl border border-white/50 bg-white/55 shadow-[0_12px_40px_rgba(17,17,22,0.15)] backdrop-blur-2xl backdrop-saturate-150">
        <AudioPlayer<11>
          key={sessionId}
          playList={playlist}
          colorScheme="light"
          rootContainerProps={{ className: 'workspace-player workspace-player--floating workspace-player--glass deezer-player' }}
          placement={placement}
          activeUI={activeUI}
          audioInitialState={audioInitialState}
        >
          <AudioPlayer.CustomComponent id="sessionMeta">
            <PlayerSessionChip tracks={playableTracks} />
          </AudioPlayer.CustomComponent>
        </AudioPlayer>
      </div>
    </div>
  )
}
