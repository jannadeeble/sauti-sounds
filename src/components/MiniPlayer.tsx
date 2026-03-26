import { Play, Pause, SkipForward } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { usePlayerStore } from '../stores/playerStore'

export default function MiniPlayer() {
  const navigate = useNavigate()
  const { currentTrack, isPlaying, togglePlay, next, currentTime, duration } = usePlayerStore()

  if (!currentTrack) return null

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

  return (
    <div
      className="glass border-t border-white/5 cursor-pointer"
      onClick={() => navigate('/now-playing')}
    >
      {/* Progress bar */}
      <div className="h-0.5 bg-surface-600">
        <div
          className="h-full bg-accent transition-all duration-200"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="flex items-center gap-3 px-4 py-2">
        {/* Artwork */}
        <div className="w-10 h-10 rounded-md bg-surface-600 overflow-hidden flex-shrink-0">
          {currentTrack.artworkUrl ? (
            <img src={currentTrack.artworkUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-500 text-lg">
              ♪
            </div>
          )}
        </div>

        {/* Track info */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{currentTrack.title}</p>
          <p className="text-xs text-gray-400 truncate">{currentTrack.artist}</p>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={(e) => { e.stopPropagation(); togglePlay() }}
            className="p-2 hover:bg-white/10 rounded-full transition-colors"
          >
            {isPlaying ? <Pause size={20} /> : <Play size={20} fill="white" />}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); next() }}
            className="p-2 hover:bg-white/10 rounded-full transition-colors"
          >
            <SkipForward size={18} />
          </button>
        </div>
      </div>
    </div>
  )
}
