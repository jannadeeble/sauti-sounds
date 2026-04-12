import { useState, useMemo, useCallback, useEffect } from 'react'
import { Loader2, Search, ServerCrash } from 'lucide-react'
import TrackRow from '../components/TrackRow'
import { searchTidal } from '../lib/tidal'
import { useLibraryStore } from '../stores/libraryStore'
import { useTidalStore } from '../stores/tidalStore'
import type { Track } from '../types'

export default function SearchPage() {
  const [query, setQuery] = useState('')
  const [tidalResults, setTidalResults] = useState<Track[]>([])
  const [tidalLoading, setTidalLoading] = useState(false)
  const [tidalSearched, setTidalSearched] = useState(false)
  const tracks = useLibraryStore(s => s.tracks)
  const loadTracks = useLibraryStore(s => s.loadTracks)
  const cacheTidalTracks = useLibraryStore(s => s.cacheTidalTracks)
  const { backendAvailable, backendAuthenticated, tidalConnected } = useTidalStore()

  useEffect(() => {
    void loadTracks()
  }, [loadTracks])

  const localResults = useMemo(() => {
    if (!query.trim()) return []
    const needle = query.toLowerCase()
    return tracks.filter(track =>
      track.title.toLowerCase().includes(needle) ||
      track.artist.toLowerCase().includes(needle) ||
      track.album.toLowerCase().includes(needle) ||
      (track.genre && track.genre.toLowerCase().includes(needle))
    )
  }, [query, tracks])

  const handleSearch = useCallback(async () => {
    if (!query.trim() || !tidalConnected) return
    setTidalLoading(true)
    setTidalSearched(true)
    try {
      const results = await searchTidal(query)
      setTidalResults(results.tracks)
      await cacheTidalTracks(results.tracks)
    } catch (err) {
      console.error('TIDAL search failed:', err)
      setTidalResults([])
    } finally {
      setTidalLoading(false)
    }
  }, [cacheTidalTracks, query, tidalConnected])

  const hasResults = localResults.length > 0 || tidalResults.length > 0

  return (
    <div className="px-4 pt-6 pb-4">
      <h1 className="text-2xl font-bold mb-4">Search</h1>

      <div className="relative mb-6">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          type="text"
          value={query}
          onChange={e => {
            setQuery(e.target.value)
            setTidalSearched(false)
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              void handleSearch()
            }
          }}
          placeholder={tidalConnected ? 'Search library & TIDAL...' : 'Search your library...'}
          className="w-full bg-surface-700 rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder-gray-500 outline-none focus:ring-2 focus:ring-accent/50 transition-shadow"
          autoFocus
        />
      </div>

      {!backendAvailable && (
        <div className="mb-6 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">
          <div className="flex items-center gap-2 mb-1">
            <ServerCrash size={16} />
            Backend unavailable
          </div>
          <p className="text-xs text-red-200/80">
            The Railway/local API is offline. Local search still works, but TIDAL search is disabled.
          </p>
        </div>
      )}

      {query.trim() && !hasResults && !tidalLoading && (
        <p className="text-center text-gray-500 py-12">
          No results for "{query}"
        </p>
      )}

      {localResults.length > 0 && (
        <section className="mb-6">
          <h2 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2 px-1">
            Your Library ({localResults.length})
          </h2>
          <div className="space-y-0.5">
            {localResults.map((track, index) => (
              <TrackRow key={track.id} track={track} tracks={localResults} index={index} />
            ))}
          </div>
        </section>
      )}

      {backendAuthenticated && tidalConnected && query.trim() && (
        <section>
          {!tidalSearched && !tidalLoading && (
            <button
              onClick={() => void handleSearch()}
              className="w-full text-center text-sm text-accent hover:text-accent-light py-3 transition-colors"
            >
              Search TIDAL for "{query}"
            </button>
          )}

          {tidalLoading && (
            <div className="flex items-center justify-center gap-2 py-6 text-gray-400">
              <Loader2 size={16} className="animate-spin" />
              <span className="text-sm">Searching TIDAL...</span>
            </div>
          )}

          {tidalSearched && tidalResults.length > 0 && (
            <>
              <h2 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2 px-1">
                TIDAL ({tidalResults.length})
              </h2>
              <div className="space-y-0.5">
                {tidalResults.map((track, index) => (
                  <TrackRow key={`${track.id}-${index}`} track={track} tracks={tidalResults} index={index} />
                ))}
              </div>
            </>
          )}

          {tidalSearched && !tidalLoading && tidalResults.length === 0 && (
            <p className="text-center text-xs text-gray-600 py-4">No TIDAL results</p>
          )}
        </section>
      )}

      {!query.trim() && (
        <div className="text-center py-16 text-gray-500">
          <p className="text-sm">Search across your local library{tidalConnected ? ' and TIDAL' : ''}</p>
          {!backendAuthenticated && (
            <p className="text-xs text-gray-600 mt-1">Log into the backend in Settings to unlock TIDAL.</p>
          )}
          {backendAuthenticated && !tidalConnected && (
            <p className="text-xs text-gray-600 mt-1">Connect your TIDAL account in Settings to search streaming tracks.</p>
          )}
        </div>
      )}
    </div>
  )
}
