import { Play, MoreVertical, HardDrive, Radio } from 'lucide-react'
import type { Track } from '../types'
import { formatTime } from '../lib/metadata'
import { usePlayerStore } from '../stores/playerStore'

interface Props {
  track: Track
  tracks?: Track[]
  index?: number
  showIndex?: boolean
}

export default function TrackRow({ track, tracks, index = 0, showIndex }: Props) {
  const { setQueue, currentTrack, isPlaying } = usePlayerStore()
  const isActive = currentTrack?.id === track.id

  function handlePlay() {
    if (tracks) {
      setQueue(tracks, index)
    } else {
      setQueue([track], 0)
    }
  }

  return (
    <button
      onClick={handlePlay}
      className={`w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 rounded-lg transition-colors group text-left ${
        isActive ? 'bg-white/5' : ''
      }`}
    >
      {/* Index / Play overlay */}
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

      {/* Artwork */}
      <div className="w-10 h-10 rounded bg-surface-600 overflow-hidden flex-shrink-0">
        {track.artworkUrl ? (
          <img src={track.artworkUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-600 text-sm">♪</div>
        )}
      </div>

      {/* Info */}
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

      {/* Duration */}
      <span className="text-xs text-gray-500 flex-shrink-0">
        {formatTime(track.duration)}
      </span>

      {/* More menu */}
      <button
        onClick={(e) => e.stopPropagation()}
        className="p-1 opacity-0 group-hover:opacity-100 hover:bg-white/10 rounded-full transition-all"
      >
        <MoreVertical size={16} className="text-gray-400" />
      </button>
    </button>
  )
}
