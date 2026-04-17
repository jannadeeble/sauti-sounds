import { useState } from 'react'
import { HardDrive, Heart, ListPlus, MoreVertical, Radio } from 'lucide-react'
import AddToPlaylistDialog from './AddToPlaylistDialog'
import { useTrackArtworkUrl } from '../lib/artwork'
import { formatTime } from '../lib/metadata'
import { useLibraryStore } from '../stores/libraryStore'
import { type PlaybackContext, usePlaybackSessionStore } from '../stores/playbackSessionStore'
import { useTidalStore } from '../stores/tidalStore'
import type { Track } from '../types'

export interface TrackAction {
  label: string
  onClick: () => void
  destructive?: boolean
  disabled?: boolean
}

interface TrackRowProps {
  track: Track
  tracks?: Track[]
  playContext: PlaybackContext
  index?: number
  highlighted?: boolean
  extraActions?: TrackAction[]
}

export default function TrackRow({
  track,
  tracks,
  playContext,
  index = 0,
  highlighted = false,
  extraActions = [],
}: TrackRowProps) {
  const playTracks = usePlaybackSessionStore((state) => state.playTracks)
  const appendTrack = usePlaybackSessionStore((state) => state.appendTrack)
  const currentTrack = usePlaybackSessionStore((state) => state.currentTrack)
  const queuedTracks = usePlaybackSessionStore((state) => state.tracks)
  const toggleTidalFavorite = useLibraryStore((state) => state.toggleTidalFavorite)
  const tidalConnected = useTidalStore((state) => state.tidalConnected)

  const [showActions, setShowActions] = useState(false)
  const [showPlaylistDialog, setShowPlaylistDialog] = useState(false)

  const isActive = currentTrack?.id === track.id
  const artworkUrl = useTrackArtworkUrl(track)

  const actions: TrackAction[] = [
    {
      label: 'Add to current queue',
      onClick: () => appendTrack(track),
      disabled: queuedTracks.length === 0,
    },
    {
      label: 'Add to playlist',
      onClick: () => setShowPlaylistDialog(true),
    },
    ...(track.source === 'tidal' && tidalConnected
      ? [{
          label: track.isFavorite ? 'Remove from TIDAL favorites' : 'Add to TIDAL favorites',
          onClick: () => void toggleTidalFavorite(track),
        } satisfies TrackAction]
      : []),
    ...extraActions,
  ]

  function handlePlay() {
    playTracks(tracks || [track], playContext, index)
  }

  return (
    <>
      <article
        className={`group flex items-center gap-3 px-5 py-3 transition-colors ${
          highlighted
            ? 'bg-[#fff0f3] ring-1 ring-inset ring-[#f7c6cd]'
            : isActive
              ? 'bg-[#fff4f6]'
              : 'bg-transparent hover:bg-[#fafafb]'
        }`}
      >
        <button
          type="button"
          onClick={handlePlay}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <div className="h-10 w-10 overflow-hidden rounded-xl bg-[#f1f1f4]">
            {artworkUrl ? (
              <img src={artworkUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-lg text-[#9d9ea8]">♪</div>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className={`truncate text-sm font-medium ${isActive ? 'text-accent' : 'text-[#111116]'}`}>
                {track.title}
              </p>
              {track.source === 'tidal' ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-cyan-500/8 px-2 py-0.5 text-[10px] uppercase tracking-wide text-cyan-700">
                  <Radio size={10} />
                  TIDAL
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-[#f3f3f6] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[#686973]">
                  <HardDrive size={10} />
                  Local
                </span>
              )}
              {track.isFavorite ? <Heart size={12} className="fill-red-400 text-red-400" /> : null}
            </div>
            <p className="truncate text-xs text-[#7a7b86]">
              {track.artist}
              {track.album ? ` · ${track.album}` : ''}
            </p>
          </div>
        </button>

        <div className="flex items-center gap-2">
          <span className="text-xs text-[#8c8d96]">{formatTime(track.duration)}</span>
          <button
            type="button"
            onClick={() => setShowActions(true)}
            className="rounded-full p-2 text-[#8c8d96] transition-colors hover:bg-black/4 hover:text-[#111116]"
            aria-label={`More actions for ${track.title}`}
          >
            <MoreVertical size={16} />
          </button>
        </div>
      </article>

      {showActions ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 bg-black/35"
            onClick={() => setShowActions(false)}
            aria-label="Close track actions"
          />
          <div className="fixed inset-x-4 bottom-4 z-50 rounded-[24px] border border-black/8 bg-white p-3 shadow-[0_20px_40px_rgba(17,17,22,0.16)]">
            <div className="mb-2 flex items-center justify-between px-2 py-1">
              <div>
                <p className="text-sm font-semibold text-[#111116]">{track.title}</p>
                <p className="text-xs text-[#7a7b86]">{track.artist}</p>
              </div>
              <button
                type="button"
                onClick={() => setShowActions(false)}
                className="rounded-full p-2 text-[#8c8d96] transition-colors hover:bg-black/4 hover:text-[#111116]"
              >
                <MoreVertical size={16} />
              </button>
            </div>

            <div className="space-y-1">
              {actions.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  disabled={action.disabled}
                  onClick={() => {
                    action.onClick()
                    setShowActions(false)
                  }}
                  className={`flex w-full items-center gap-2 rounded-2xl px-4 py-3 text-left text-sm transition-colors disabled:opacity-40 ${
                    action.destructive
                      ? 'text-[#c4394d] hover:bg-[#fff4f6]'
                      : 'text-[#111116] hover:bg-[#f8f8f9]'
                  }`}
                >
                  {action.label === 'Add to current queue' ? <ListPlus size={15} className="text-accent" /> : null}
                  <span>{action.label}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      ) : null}

      <AddToPlaylistDialog
        open={showPlaylistDialog}
        track={track}
        onClose={() => setShowPlaylistDialog(false)}
      />
    </>
  )
}
