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

  const track = currentTrack || { title: 'No Track Selected', artist: 'Select a track to play', album: 'Unknown Album', artworkUrl: '' }

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

  return (
    <div className="flex flex-col h-full overflow-y-auto px-6 pb-6">
      {/* Header */}
      <div className="flex items-center justify-between py-4 shrink-0">
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
      <div className="flex items-center justify-center py-4 shrink-0">
        <div className="w-full max-w-[280px] aspect-square rounded-2xl bg-surface-700 overflow-hidden shadow-2xl">
          {track.artworkUrl ? (
            <img src={track.artworkUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <div className="text-8xl text-gray-600">♪</div>
            </div>
          )}
        </div>
      </div>

      {/* Track info */}
      <div className="text-center mb-4 shrink-0">
        <h2 className="text-xl font-bold truncate">{track.title}</h2>
        <p className="text-gray-400 truncate mt-1">{track.artist}</p>
        {track.album !== 'Unknown Album' && (
          <p className="text-gray-500 text-sm truncate mt-0.5">{track.album}</p>
        )}
      </div>

      {/* Progress bar */}
      <div className="mb-3 shrink-0">
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
      <div className="flex items-center justify-between mb-4 shrink-0">
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
      <div className="flex items-center gap-3 mb-6 shrink-0">
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

      {/* Queue */}
      <div className="shrink-0 border-t border-white/10 pt-4">
        <div className="flex items-center gap-2 mb-3">
          <ListMusic size={16} className="text-gray-400" />
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Queue</h3>
        </div>
        {queue.length === 0 ? (
          <p className="text-sm text-gray-500 py-2">No tracks in queue</p>
        ) : (
          <div className="space-y-2">
            {queue.slice(queueIndex + 1, queueIndex + 4).map((t, i) => (
              <div key={t.id || i} className="flex items-center gap-3 py-1.5 text-sm">
                <span className="text-gray-500 w-5 text-right">{queueIndex + 2 + i}</span>
                <div className="flex-1 min-w-0">
                  <p className="truncate text-gray-300">{t.title}</p>
                  <p className="truncate text-gray-500 text-xs">{t.artist}</p>
                </div>
              </div>
            ))}
            {queue.length > queueIndex + 4 && (
              <p className="text-xs text-gray-500">+{queue.length - queueIndex - 4} more</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
