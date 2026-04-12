import { useEffect, useMemo, useState } from 'react'
import { FolderOpen, Grid3X3, HardDrive, ListMusic, Radio, Shapes, SlidersHorizontal, Sparkles } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import TrackRow from '../components/TrackRow'
import { useLibraryStore } from '../stores/libraryStore'
import { usePlaylistStore } from '../stores/playlistStore'
import { useTidalStore } from '../stores/tidalStore'
import type { ViewMode } from '../types'

type SortKey = 'title' | 'artist' | 'album' | 'duration'
type TabKey = 'tracks' | 'albums' | 'artists' | 'playlists'
type SourceFilter = 'all' | 'local' | 'tidal'

export default function LibraryPage() {
  const navigate = useNavigate()
  const { tracks, loadTracks, importFiles, syncTidalFavorites, syncingFavorites } = useLibraryStore()
  const { appPlaylists, tidalPlaylists, loadPlaylists, createAppPlaylist, createProviderPlaylist } = usePlaylistStore()
  const tidalConnected = useTidalStore(s => s.tidalConnected)
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [sortBy, setSortBy] = useState<SortKey>('title')
  const [tab, setTab] = useState<TabKey>('tracks')
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')

  useEffect(() => {
    void loadTracks()
    void loadPlaylists()
    if (tidalConnected) {
      void syncTidalFavorites()
    }
  }, [loadPlaylists, loadTracks, syncTidalFavorites, tidalConnected])

  const filteredTracks = useMemo(() => {
    if (sourceFilter === 'all') return tracks
    return tracks.filter(track => track.source === sourceFilter)
  }, [sourceFilter, tracks])

  const sortedTracks = useMemo(() => {
    return [...filteredTracks].sort((a, b) => {
      if (sortBy === 'duration') return a.duration - b.duration
      return (a[sortBy] || '').localeCompare(b[sortBy] || '')
    })
  }, [filteredTracks, sortBy])

  const albums = [...new Set(filteredTracks.map(track => track.album))].sort()
  const artists = [...new Set(filteredTracks.map(track => track.artist))].sort()
  const playlistCount = appPlaylists.length + tidalPlaylists.length

  const tabs: { key: TabKey; label: string; count: number }[] = [
    { key: 'tracks', label: 'Tracks', count: tracks.length },
    { key: 'albums', label: 'Albums', count: albums.length },
    { key: 'artists', label: 'Artists', count: artists.length },
    { key: 'playlists', label: 'Playlists', count: playlistCount },
  ]

  async function handleCreateAppPlaylist() {
    const name = window.prompt('Name your new mixed playlist')
    if (!name?.trim()) return
    const playlist = await createAppPlaylist(name.trim())
    navigate(`/playlists/app/${playlist.id}`)
  }

  async function handleCreateTidalPlaylist() {
    const name = window.prompt('Name your new TIDAL playlist')
    if (!name?.trim()) return
    const playlist = await createProviderPlaylist(name.trim())
    navigate(`/playlists/tidal/${playlist.providerPlaylistId}`)
  }

  return (
    <div className="px-4 pt-6 pb-4">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Library</h1>
        <div className="flex items-center gap-2">
          {tidalConnected && (
            <button
              onClick={() => void syncTidalFavorites()}
              className="p-2 hover:bg-white/10 rounded-full transition-colors"
              title="Sync TIDAL favorites"
            >
              <Sparkles size={18} className={`text-cyan-300 ${syncingFavorites ? 'animate-pulse' : ''}`} />
            </button>
          )}
          <button
            onClick={() => void importFiles()}
            className="p-2 hover:bg-white/10 rounded-full transition-colors"
            title="Import local files"
          >
            <FolderOpen size={20} className="text-gray-400" />
          </button>
        </div>
      </div>

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

      {tab !== 'playlists' && (
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
            <HardDrive size={14} />
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
            TIDAL
          </button>
        </div>
      )}

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

      {tab === 'tracks' && (
        <div className="space-y-0.5">
          {sortedTracks.map((track, index) => (
            <TrackRow key={track.id} track={track} tracks={sortedTracks} index={index} showIndex />
          ))}
        </div>
      )}

      {tab === 'albums' && (
        <div className="grid grid-cols-2 gap-3">
          {albums.map(album => {
            const albumTracks = filteredTracks.filter(track => track.album === album)
            const artwork = albumTracks.find(track => track.artworkUrl)?.artworkUrl
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

      {tab === 'artists' && (
        <div className="space-y-1">
          {artists.map(artist => {
            const count = filteredTracks.filter(track => track.artist === artist).length
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

      {tab === 'playlists' && (
        <div className="space-y-6">
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-400">Mixed App Playlists</h2>
              <button
                onClick={() => void handleCreateAppPlaylist()}
                className="text-sm text-accent hover:text-accent-light"
              >
                Create
              </button>
            </div>
            <div className="space-y-2">
              {appPlaylists.length === 0 ? (
                <div className="rounded-xl border border-dashed border-white/10 px-4 py-5 text-sm text-gray-400">
                  Build app-owned playlists that mix local files and TIDAL tracks together.
                </div>
              ) : (
                appPlaylists.map(playlist => (
                  <button
                    key={playlist.id}
                    onClick={() => navigate(`/playlists/app/${playlist.id}`)}
                    className="w-full rounded-xl bg-surface-800 px-4 py-4 text-left hover:bg-surface-700 transition-colors"
                  >
                    <p className="text-sm font-medium">{playlist.name}</p>
                    <p className="text-xs text-gray-400 mt-1">{playlist.items.length} items</p>
                  </button>
                ))
              )}
            </div>
          </section>

          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-400">TIDAL Playlists</h2>
              {tidalConnected && (
                <button
                  onClick={() => void handleCreateTidalPlaylist()}
                  className="text-sm text-accent hover:text-accent-light"
                >
                  Create
                </button>
              )}
            </div>
            <div className="space-y-2">
              {!tidalConnected ? (
                <div className="rounded-xl border border-dashed border-white/10 px-4 py-5 text-sm text-gray-400">
                  Connect TIDAL in Settings to browse and edit your streaming playlists.
                </div>
              ) : tidalPlaylists.length === 0 ? (
                <div className="rounded-xl border border-dashed border-white/10 px-4 py-5 text-sm text-gray-400">
                  No TIDAL playlists yet.
                </div>
              ) : (
                tidalPlaylists.map(playlist => (
                  <button
                    key={playlist.id}
                    onClick={() => navigate(`/playlists/tidal/${playlist.providerPlaylistId}`)}
                    className="w-full rounded-xl bg-surface-800 px-4 py-4 text-left hover:bg-surface-700 transition-colors"
                  >
                    <p className="text-sm font-medium flex items-center gap-2">
                      <Shapes size={14} className="text-cyan-300" />
                      {playlist.name}
                    </p>
                    <p className="text-xs text-gray-400 mt-1">
                      {playlist.trackCount || 0} tracks{playlist.writable ? '' : ' · read only'}
                    </p>
                  </button>
                ))
              )}
            </div>
          </section>
        </div>
      )}

      {tracks.length === 0 && tab !== 'playlists' && (
        <div className="text-center py-16 text-gray-500">
          <p className="mb-3">No tracks in your library yet</p>
          <button
            onClick={() => void importFiles()}
            className="text-accent hover:text-accent-light text-sm"
          >
            Import music files
          </button>
        </div>
      )}
    </div>
  )
}
