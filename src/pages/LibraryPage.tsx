import { useEffect, useState } from 'react'
import { FolderOpen, ListMusic, Grid3X3, SlidersHorizontal, Disc3, Radio } from 'lucide-react'
import { useLibraryStore } from '../stores/libraryStore'
import TrackRow from '../components/TrackRow'
import type { ViewMode } from '../types'

type SortKey = 'title' | 'artist' | 'album' | 'duration'
type TabKey = 'tracks' | 'albums' | 'artists'
type SourceFilter = 'all' | 'local' | 'tidal'

export default function LibraryPage() {
  const { tracks, loadTracks, importFiles } = useLibraryStore()
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [sortBy, setSortBy] = useState<SortKey>('title')
  const [tab, setTab] = useState<TabKey>('tracks')
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')

  useEffect(() => { loadTracks() }, [loadTracks])

  const filteredTracks = sourceFilter === 'all'
    ? tracks
    : tracks.filter(t => t.source === sourceFilter)

  const sortedTracks = [...filteredTracks].sort((a, b) => {
    if (sortBy === 'duration') return a.duration - b.duration
    return (a[sortBy] || '').localeCompare(b[sortBy] || '')
  })

  const albums = [...new Set(tracks.map(t => t.album))].sort()
  const artists = [...new Set(tracks.map(t => t.artist))].sort()

  const tabs: { key: TabKey; label: string; count: number }[] = [
    { key: 'tracks', label: 'Tracks', count: tracks.length },
    { key: 'albums', label: 'Albums', count: albums.length },
    { key: 'artists', label: 'Artists', count: artists.length },
  ]

  return (
    <div className="px-4 pt-6 pb-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Library</h1>
        <button
          onClick={importFiles}
          className="p-2 hover:bg-white/10 rounded-full transition-colors"
          title="Import files"
        >
          <FolderOpen size={20} className="text-gray-400" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-surface-800 rounded-lg p-1 mb-4">
        {tabs.map(({ key, label, count }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex-1 text-sm py-1.5 rounded-md transition-colors ${
              tab === key
                ? 'bg-surface-600 text-white font-medium'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            {label} <span className="text-xs opacity-60">({count})</span>
          </button>
        ))}
      </div>

      {/* Source filter badges */}
      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={() => setSourceFilter('all')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
            sourceFilter === 'all'
              ? 'bg-accent/20 text-accent border border-accent/40'
              : 'bg-surface-700 text-gray-400 border border-transparent hover:bg-surface-600'
          }`}
        >
          All
        </button>
        <button
          onClick={() => setSourceFilter('local')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
            sourceFilter === 'local'
              ? 'bg-accent/20 text-accent border border-accent/40'
              : 'bg-surface-700 text-gray-400 border border-transparent hover:bg-surface-600'
          }`}
        >
          <Disc3 size={14} />
          Local
        </button>
        <button
          onClick={() => setSourceFilter('tidal')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
            sourceFilter === 'tidal'
              ? 'bg-accent/20 text-accent border border-accent/40'
              : 'bg-surface-700 text-gray-400 border border-transparent hover:bg-surface-600'
          }`}
        >
          <Radio size={14} />
          Tidal
        </button>
      </div>

      {/* Toolbar */}
      {tab === 'tracks' && tracks.length > 0 && (
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <SlidersHorizontal size={14} className="text-gray-400" />
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value as SortKey)}
              className="bg-transparent text-sm text-gray-400 outline-none cursor-pointer"
            >
              <option value="title">Title</option>
              <option value="artist">Artist</option>
              <option value="album">Album</option>
              <option value="duration">Duration</option>
            </select>
          </div>
          <div className="flex gap-1">
            <button
              onClick={() => setViewMode('list')}
              className={`p-1.5 rounded ${viewMode === 'list' ? 'bg-white/10 text-white' : 'text-gray-500'}`}
            >
              <ListMusic size={16} />
            </button>
            <button
              onClick={() => setViewMode('grid')}
              className={`p-1.5 rounded ${viewMode === 'grid' ? 'bg-white/10 text-white' : 'text-gray-500'}`}
            >
              <Grid3X3 size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Track list */}
      {tab === 'tracks' && (
        <div className="space-y-0.5">
          {sortedTracks.map((track, i) => (
            <TrackRow key={track.id} track={track} tracks={sortedTracks} index={i} showIndex />
          ))}
        </div>
      )}

      {/* Albums grid */}
      {tab === 'albums' && (
        <div className="grid grid-cols-2 gap-3">
          {albums.map(album => {
            const albumTracks = tracks.filter(t => t.album === album)
            const artwork = albumTracks.find(t => t.artworkUrl)?.artworkUrl
            return (
              <div key={album} className="bg-surface-800 rounded-xl overflow-hidden">
                <div className="aspect-square bg-surface-700">
                  {artwork ? (
                    <img src={artwork} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-4xl text-gray-600">♪</div>
                  )}
                </div>
                <div className="p-3">
                  <p className="text-sm font-medium truncate">{album}</p>
                  <p className="text-xs text-gray-400 truncate">{albumTracks[0]?.artist}</p>
                  <p className="text-xs text-gray-500">{albumTracks.length} tracks</p>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Artists list */}
      {tab === 'artists' && (
        <div className="space-y-1">
          {artists.map(artist => {
            const count = tracks.filter(t => t.artist === artist).length
            return (
              <div key={artist} className="flex items-center gap-3 px-4 py-3 hover:bg-white/5 rounded-lg">
                <div className="w-10 h-10 rounded-full bg-surface-600 flex items-center justify-center text-lg text-gray-500">
                  {artist[0]?.toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-medium">{artist}</p>
                  <p className="text-xs text-gray-400">{count} track{count !== 1 ? 's' : ''}</p>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {tracks.length === 0 && (
        <div className="text-center py-16 text-gray-500">
          <p className="mb-3">No tracks in your library yet</p>
          <button
            onClick={importFiles}
            className="text-accent hover:text-accent-light text-sm"
          >
            Import music files
          </button>
        </div>
      )}
    </div>
  )
}
