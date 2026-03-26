import { useState, useMemo, useCallback } from 'react'
import { Search, Loader2 } from 'lucide-react'
import { useLibraryStore } from '../stores/libraryStore'
import { searchTidal, isTidalConfigured } from '../lib/tidal'
import TrackRow from '../components/TrackRow'
import type { Track } from '../types'

export default function SearchPage() {
  const [query, setQuery] = useState('')
  const tracks = useLibraryStore(s => s.tracks)
  const [tidalResults, setTidalResults] = useState<Track[]>([])
  const [tidalLoading, setTidalLoading] = useState(false)
  const [tidalSearched, setTidalSearched] = useState(false)

  const localResults = useMemo(() => {
    if (!query.trim()) return []
    const q = query.toLowerCase()
    return tracks.filter(
      t =>
        t.title.toLowerCase().includes(q) ||
        t.artist.toLowerCase().includes(q) ||
        t.album.toLowerCase().includes(q) ||
        (t.genre && t.genre.toLowerCase().includes(q))
    )
  }, [query, tracks])

  const handleSearch = useCallback(async () => {
    if (!query.trim()) return
    if (!isTidalConfigured()) return

    setTidalLoading(true)
    setTidalSearched(true)
    try {
      const results = await searchTidal(query)
      setTidalResults(results.tracks)
    } catch {
      setTidalResults([])
    } finally {
      setTidalLoading(false)
    }
  }, [query])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch()
  }

  const hasResults = localResults.length > 0 || tidalResults.length > 0
  const tidalEnabled = isTidalConfigured()

  return (
    <div className="px-4 pt-6 pb-4">
      <h1 className="text-2xl font-bold mb-4">Search</h1>

      {/* Search input */}
      <div className="relative mb-6">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          type="text"
          value={query}
          onChange={e => { setQuery(e.target.value); setTidalSearched(false) }}
          onKeyDown={handleKeyDown}
          placeholder={tidalEnabled ? 'Search library & Tidal...' : 'Search your library...'}
          className="w-full bg-surface-700 rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder-gray-500 outline-none focus:ring-2 focus:ring-accent/50 transition-shadow"
          autoFocus
        />
      </div>

      {/* No results */}
      {query.trim() && !hasResults && !tidalLoading && (
        <p className="text-center text-gray-500 py-12">
          No results for "{query}"
        </p>
      )}

      {/* Local results */}
      {localResults.length > 0 && (
        <section className="mb-6">
          <h2 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2 px-1">
            Your Library ({localResults.length})
          </h2>
          <div className="space-y-0.5">
            {localResults.map((track, i) => (
              <TrackRow key={track.id} track={track} tracks={localResults} index={i} />
            ))}
          </div>
        </section>
      )}

      {/* Tidal results */}
      {tidalEnabled && query.trim() && (
        <section>
          {!tidalSearched && !tidalLoading && (
            <button
              onClick={handleSearch}
              className="w-full text-center text-sm text-accent hover:text-accent-light py-3 transition-colors"
            >
              Search Tidal for "{query}"
            </button>
          )}

          {tidalLoading && (
            <div className="flex items-center justify-center gap-2 py-6 text-gray-400">
              <Loader2 size={16} className="animate-spin" />
              <span className="text-sm">Searching Tidal...</span>
            </div>
          )}

          {tidalSearched && tidalResults.length > 0 && (
            <>
              <h2 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2 px-1">
                Tidal ({tidalResults.length})
              </h2>
              <div className="space-y-0.5">
                {tidalResults.map((track, i) => (
                  <TrackRow key={track.id} track={track} tracks={tidalResults} index={i} />
                ))}
              </div>
            </>
          )}

          {tidalSearched && !tidalLoading && tidalResults.length === 0 && (
            <p className="text-center text-xs text-gray-600 py-4">No Tidal results</p>
          )}
        </section>
      )}

      {/* Empty state */}
      {!query.trim() && (
        <div className="text-center py-16 text-gray-500">
          <p className="text-sm">Search across your library{tidalEnabled ? ' & Tidal catalog' : ''}</p>
          {!tidalEnabled && (
            <p className="text-xs text-gray-600 mt-1">Connect Tidal in Settings to search their catalog</p>
          )}
        </div>
      )}
    </div>
  )
}
