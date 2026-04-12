import { useState } from 'react'
import { HardDrive, Heart, ListPlus, MoreVertical, Play, PlusCircle, Radio } from 'lucide-react'
import type { Track } from '../types'
import { formatTime } from '../lib/metadata'
import { useLibraryStore } from '../stores/libraryStore'
import { usePlayerStore } from '../stores/playerStore'
import { useTidalStore } from '../stores/tidalStore'
import AddToPlaylistDialog from './AddToPlaylistDialog'

export interface TrackAction {
  label: string
  onClick: () => void
  destructive?: boolean
  disabled?: boolean
}

interface Props {
  track: Track
  tracks?: Track[]
  index?: number
  showIndex?: boolean
  extraActions?: TrackAction[]
}

export default function TrackRow({ track, tracks, index = 0, showIndex, extraActions = [] }: Props) {
  const { setQueue, addToQueue, currentTrack, isPlaying } = usePlayerStore()
  const toggleTidalFavorite = useLibraryStore(s => s.toggleTidalFavorite)
  const tidalConnected = useTidalStore(s => s.tidalConnected)
  const [showActions, setShowActions] = useState(false)
  const [showPlaylistDialog, setShowPlaylistDialog] = useState(false)

  const isActive = currentTrack?.id === track.id

  function handlePlay() {
    if (tracks) {
      setQueue(tracks, index)
    } else {
      setQueue([track], 0)
    }
  }

  async function handleToggleFavorite() {
    if (track.source !== 'tidal') return
    await toggleTidalFavorite(track)
    setShowActions(false)
  }

  return (
    <>
      <button
        onClick={handlePlay}
        className={`w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 rounded-lg transition-colors group text-left ${
          isActive ? 'bg-white/5' : ''
        }`}
      >
        <div className="w-8 text-center flex-shrink-0">
          {showIndex && !isActive ? (
            <span className="text-sm text-gray-500 group-hover:hidden">{index + 1}</span>
          ) : null}
          {isActive && isPlaying ? (
            <div className="flex gap-0.5 items-end justify-center h-4">
              <span className="w-0.5 bg-accent animate-pulse" style={{ height: '60%' }} />
              <span className="w-0.5 bg-accent animate-pulse" style={{ height: '100%', animationDelay: '0.2s' }} />
              <span className="w-0.5 bg-accent animate-pulse" style={{ height: '40%', animationDelay: '0.4s' }} />
            </div>
          ) : (
            <Play size={14} className={`mx-auto ${isActive ? 'text-accent' : 'text-gray-400 hidden group-hover:block'}`} fill="currentColor" />
          )}
        </div>

        <div className="w-10 h-10 rounded bg-surface-600 overflow-hidden flex-shrink-0">
          {track.artworkUrl ? (
            <img src={track.artworkUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-600 text-sm">♪</div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium truncate ${isActive ? 'text-accent' : ''}`}>
            {track.title}
          </p>
          <div className="flex items-center gap-1.5 text-xs text-gray-400">
            {track.source === 'local' ? (
              <HardDrive size={10} className="flex-shrink-0" />
            ) : (
              <Radio size={10} className="flex-shrink-0" />
            )}
            <span className="truncate">{track.artist}</span>
            <span>·</span>
            <span className="truncate">{track.album}</span>
          </div>
        </div>

        <span className="text-xs text-gray-500 flex-shrink-0">
          {formatTime(track.duration)}
        </span>

        <button
          onClick={(e) => {
            e.stopPropagation()
            setShowActions(true)
          }}
          className="p-1 opacity-0 group-hover:opacity-100 hover:bg-white/10 rounded-full transition-all"
        >
          <MoreVertical size={16} className="text-gray-400" />
        </button>
      </button>

      {showActions && (
        <>
          <button
            className="fixed inset-0 z-40 bg-black/50"
            onClick={() => setShowActions(false)}
            aria-label="Close track actions"
          />
          <div className="fixed inset-x-4 bottom-4 z-50 rounded-2xl border border-white/10 bg-surface-800 p-3 shadow-2xl">
            <div className="mb-3 px-2">
              <p className="text-sm font-semibold truncate">{track.title}</p>
              <p className="text-xs text-gray-400 truncate">{track.artist}</p>
            </div>

            <div className="space-y-1">
              <button
                onClick={() => {
                  addToQueue(track)
                  setShowActions(false)
                }}
                className="w-full inline-flex items-center gap-2 rounded-xl px-3 py-3 text-left text-sm hover:bg-white/5"
              >
                <ListPlus size={16} className="text-accent" />
                Add To Queue
              </button>

              <button
                onClick={() => {
                  setShowActions(false)
                  setShowPlaylistDialog(true)
                }}
                className="w-full inline-flex items-center gap-2 rounded-xl px-3 py-3 text-left text-sm hover:bg-white/5"
              >
                <PlusCircle size={16} className="text-accent" />
                Add To Playlist
              </button>

              {track.source === 'tidal' && tidalConnected && (
                <button
                  onClick={() => void handleToggleFavorite()}
                  className="w-full inline-flex items-center gap-2 rounded-xl px-3 py-3 text-left text-sm hover:bg-white/5"
                >
                  <Heart size={16} className={track.isFavorite ? 'text-red-400 fill-current' : 'text-red-300'} />
                  {track.isFavorite ? 'Remove From Favorites' : 'Save To Favorites'}
                </button>
              )}

              {extraActions.map(action => (
                <button
                  key={action.label}
                  disabled={action.disabled}
                  onClick={() => {
                    setShowActions(false)
                    action.onClick()
                  }}
                  className={`w-full rounded-xl px-3 py-3 text-left text-sm hover:bg-white/5 disabled:opacity-40 ${
                    action.destructive ? 'text-red-300' : 'text-gray-100'
                  }`}
                >
                  {action.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      <AddToPlaylistDialog
        open={showPlaylistDialog}
        track={track}
        onClose={() => setShowPlaylistDialog(false)}
      />
    </>
  )
}
