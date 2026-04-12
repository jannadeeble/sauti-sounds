import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { FolderOpen, Disc3, Sparkles, Radio, PlayCircle } from 'lucide-react'
import { useLibraryStore } from '../stores/libraryStore'
import { usePlayerStore } from '../stores/playerStore'
import { useSettingsStore } from '../stores/settingsStore'
import TrackRow from '../components/TrackRow'

export default function HomePage() {
  const navigate = useNavigate()
  const { tracks, loadTracks, importFiles, importing, importProgress } = useLibraryStore()
  const { setQueue } = usePlayerStore()
  const llmApiKey = useSettingsStore(s => s.llmApiKey)

  useEffect(() => {
    loadTracks()
  }, [loadTracks])

  const recentTracks = tracks.slice(0, 20)

  function playAll() {
    if (tracks.length > 0) setQueue(tracks, 0)
  }

  return (
    <div className="px-4 pt-6 pb-4">
      {/* Header */}
      <div className="mb-4">
        <h1 className="text-2xl font-bold">Sauti Sounds</h1>
        <p className="text-gray-400 text-sm mt-1">music is the remedy</p>
      </div>

      {/* AI Prompt Bar */}
      {llmApiKey && (
        <button
          onClick={() => navigate('/ai')}
          className="w-full flex items-center gap-3 bg-surface-800 hover:bg-surface-700 rounded-xl px-4 py-3 mb-6 transition-colors text-left"
        >
          <Sparkles size={18} className="text-accent flex-shrink-0" />
          <span className="text-sm text-gray-400">Create a playlist for...</span>
        </button>
      )}

      {/* Quick actions */}
      <div className="flex flex-wrap gap-3 mb-6">
        <button
          onClick={playAll}
          disabled={tracks.length === 0}
          className="flex items-center gap-2 bg-surface-700 hover:bg-surface-600 rounded-xl px-4 py-3 text-sm font-medium transition-colors disabled:opacity-50"
        >
          <PlayCircle size={18} className="text-accent" />
          Play All
        </button>
        <button
          onClick={() => navigate('/import')}
          disabled={importing}
          className="flex items-center gap-2 bg-accent/10 hover:bg-accent/20 text-accent border border-accent/20 rounded-xl px-4 py-3 text-sm font-medium transition-colors disabled:opacity-50"
        >
          <FolderOpen size={18} />
          {importing
            ? `Importing ${importProgress?.current}/${importProgress?.total}...`
            : 'Import'}
        </button>
        <button
          onClick={() => {
            if (tracks.length > 0) {
              const randomTrack = tracks[Math.floor(Math.random() * tracks.length)]
              setQueue(tracks, tracks.indexOf(randomTrack))
            }
          }}
          disabled={tracks.length === 0}
          className="flex items-center gap-2 bg-surface-700 hover:bg-surface-600 rounded-xl px-4 py-3 text-sm font-medium transition-colors disabled:opacity-50"
        >
          <Radio size={18} className="text-accent" />
          Song Radio
        </button>
      </div>

      {/* Empty state */}
      {tracks.length === 0 && !importing && (
        <div className="text-center py-16">
          <Disc3 size={64} className="mx-auto text-gray-600 mb-4" />
          <h2 className="text-lg font-medium text-gray-300 mb-2">Your library is empty</h2>
          <p className="text-gray-500 text-sm mb-6 max-w-xs mx-auto">
            Import your local music files or connect Tidal to get started.
          </p>
          <button
            onClick={importFiles}
            className="bg-accent hover:bg-accent-dark text-white rounded-full px-6 py-2.5 text-sm font-medium transition-colors"
          >
            Import Your First Songs
          </button>
        </div>
      )}

      {/* Recently added */}
      {recentTracks.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold mb-3">
            Recent Tracks
          </h2>
          <div className="space-y-0.5">
            {recentTracks.map((track, i) => (
              <TrackRow key={track.id} track={track} tracks={recentTracks} index={i} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
