import { useNavigate } from 'react-router-dom'
import {
  ChevronDown, Play, Pause, SkipBack, SkipForward,
  Shuffle, Repeat, Repeat1, Volume2, VolumeX, ListMusic,
} from 'lucide-react'
import { usePlayerStore } from '../stores/playerStore'
import { formatTime } from '../lib/metadata'

export default function NowPlayingPage() {
  const navigate = useNavigate()
  const {
    currentTrack, isPlaying, currentTime, duration, volume, muted,
    shuffle, repeat, togglePlay, next, previous, seek, setVolume,
    toggleMute, toggleShuffle, cycleRepeat, queue, queueIndex,
  } = usePlayerStore()

  if (!currentTrack) {
    navigate('/')
    return null
  }

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

  return (
    <div className="flex flex-col h-full px-6 pb-6">
      {/* Header */}
      <div className="flex items-center justify-between py-4">
        <button onClick={() => navigate(-1)} className="p-2 -ml-2 hover:bg-white/10 rounded-full">
          <ChevronDown size={24} />
        </button>
        <div className="text-center">
          <p className="text-xs text-gray-400 uppercase tracking-wider">Now Playing</p>
          {queue.length > 1 && (
            <p className="text-xs text-gray-500">{queueIndex + 1} of {queue.length}</p>
          )}
        </div>
        <button className="p-2 -mr-2 hover:bg-white/10 rounded-full">
          <ListMusic size={20} className="text-gray-400" />
        </button>
      </div>

      {/* Album Art */}
      <div className="flex-1 flex items-center justify-center py-4">
        <div className="w-full max-w-[320px] aspect-square rounded-2xl bg-surface-700 overflow-hidden shadow-2xl">
          {currentTrack.artworkUrl ? (
            <img src={currentTrack.artworkUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <div className="text-8xl text-gray-600">♪</div>
            </div>
          )}
        </div>
      </div>

      {/* Track info */}
      <div className="text-center mb-6">
        <h2 className="text-xl font-bold truncate">{currentTrack.title}</h2>
        <p className="text-gray-400 truncate mt-1">{currentTrack.artist}</p>
        {currentTrack.album !== 'Unknown Album' && (
          <p className="text-gray-500 text-sm truncate mt-0.5">{currentTrack.album}</p>
        )}
      </div>

      {/* Progress bar */}
      <div className="mb-4">
        <input
          type="range"
          min={0}
          max={duration || 0}
          value={currentTime}
          onChange={e => seek(Number(e.target.value))}
          className="w-full"
          style={{
            background: `linear-gradient(to right, var(--color-accent) ${progress}%, var(--color-surface-500) ${progress}%)`,
          }}
        />
        <div className="flex justify-between text-xs text-gray-500 mt-1">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      {/* Main controls */}
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={toggleShuffle}
          className={`p-2 rounded-full transition-colors ${shuffle ? 'text-accent' : 'text-gray-400 hover:text-white'}`}
        >
          <Shuffle size={20} />
        </button>

        <button onClick={previous} className="p-3 hover:bg-white/10 rounded-full transition-colors">
          <SkipBack size={24} fill="white" />
        </button>

        <button
          onClick={togglePlay}
          className="w-16 h-16 bg-white rounded-full flex items-center justify-center hover:scale-105 transition-transform"
        >
          {isPlaying ? (
            <Pause size={28} className="text-surface-900" />
          ) : (
            <Play size={28} className="text-surface-900 ml-1" fill="var(--color-surface-900)" />
          )}
        </button>

        <button onClick={next} className="p-3 hover:bg-white/10 rounded-full transition-colors">
          <SkipForward size={24} fill="white" />
        </button>

        <button
          onClick={cycleRepeat}
          className={`p-2 rounded-full transition-colors ${repeat !== 'off' ? 'text-accent' : 'text-gray-400 hover:text-white'}`}
        >
          {repeat === 'one' ? <Repeat1 size={20} /> : <Repeat size={20} />}
        </button>
      </div>

      {/* Volume */}
      <div className="flex items-center gap-3">
        <button onClick={toggleMute} className="text-gray-400 hover:text-white">
          {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={muted ? 0 : volume}
          onChange={e => setVolume(Number(e.target.value))}
          className="flex-1"
        />
      </div>
    </div>
  )
}
