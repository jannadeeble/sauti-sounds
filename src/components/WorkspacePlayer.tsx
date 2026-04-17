import { useEffect, useMemo } from 'react'
import AudioPlayer, { type InterfacePlacement, useAudioPlayer } from 'react-modern-audio-player'
import { ChevronDown, ChevronUp, HardDrive, ListMusic, Radio } from 'lucide-react'
import { useTrackArtworkUrl } from '../lib/artwork'
import { flushListenSession, handleListenTick } from '../lib/listenTracking'
import { useResolvedPlayerTracks } from '../lib/playerTracks'
import { usePlaybackSessionStore } from '../stores/playbackSessionStore'
import type { Track } from '../types'
import type { ListenContext } from '../db'

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
  const context = usePlaybackSessionStore((state) => state.context)
  const playerOpen = usePlaybackSessionStore((state) => state.playerOpen)
  const setPlayerOpen = usePlaybackSessionStore((state) => state.setPlayerOpen)
  const syncPlayerState = usePlaybackSessionStore((state) => state.syncPlayerState)

  const currentTrack = tracks[currentIndex] ?? null
  const artworkUrl = useTrackArtworkUrl(currentTrack ?? {})
  const playbackContext = usePlaybackSessionStore((state) => state.context)
  const suggestionId = usePlaybackSessionStore((state) => state.suggestionId)

  useEffect(() => {
    syncPlayerState({
      currentTrack,
      currentIndex,
      isPlaying,
      currentTime,
      duration,
    })
    handleListenTick({
      track: currentTrack,
      isPlaying,
      currentTime,
      duration,
      context: playbackContext as ListenContext,
      suggestionId,
    })
  }, [currentIndex, currentTime, currentTrack, duration, isPlaying, playbackContext, suggestionId, syncPlayerState])

  useEffect(() => {
    return () => flushListenSession('unmount')
  }, [])

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

  const contextLabel = useMemo(() => {
    switch (context) {
      case 'app-playlist':
        return 'App playlist'
      case 'tidal-playlist':
        return 'TIDAL playlist'
      case 'search-local':
        return 'Local search'
      case 'search-tidal':
        return 'TIDAL search'
      default:
        return 'Library'
    }
  }, [context])

  return (
    <div className="workspace-player-chip">
      <div className="workspace-player-chip__meta">
        <span className="workspace-player-chip__context">
          {currentTrack?.source === 'tidal' ? <Radio size={11} className="text-cyan-300" /> : <HardDrive size={11} className="text-gray-300" />}
          {contextLabel}
        </span>
        <span className="workspace-player-chip__queue">
          <ListMusic size={12} />
          {playList.length} queued
        </span>
      </div>
      <button
        type="button"
        className="workspace-player-chip__toggle"
        onClick={() => setPlayerOpen(!playerOpen)}
        aria-label={playerOpen ? 'Hide queue' : 'Show queue'}
      >
        <span>{playerOpen ? 'Hide queue' : 'Show queue'}</span>
        {playerOpen ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
      </button>
    </div>
  )
}

export default function WorkspacePlayer() {
  const tracks = usePlaybackSessionStore((state) => state.tracks)
  const sessionId = usePlaybackSessionStore((state) => state.sessionId)
  const startIndex = usePlaybackSessionStore((state) => state.startIndex)
  const playerOpen = usePlaybackSessionStore((state) => state.playerOpen)
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
      playList: playerOpen ? ('unSortable' as const) : (false as const),
    }),
    [playerOpen],
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
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-surface-900/95 px-5 py-4 backdrop-blur-2xl">
        <p className="text-sm text-gray-400">Preparing playback…</p>
      </div>
    )
  }

  if (playlist.length === 0) {
    return null
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-30">
      <AudioPlayer<11>
        key={sessionId}
        playList={playlist}
        colorScheme="dark"
        rootContainerProps={{ className: 'workspace-player deezer-player' }}
        placement={placement}
        activeUI={activeUI}
        audioInitialState={audioInitialState}
      >
        <AudioPlayer.CustomComponent id="sessionMeta">
          <PlayerSessionChip tracks={playableTracks} />
        </AudioPlayer.CustomComponent>
      </AudioPlayer>
    </div>
  )
}
