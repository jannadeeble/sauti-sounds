import { useMemo } from 'react'
import { AlertTriangle, CheckCircle2, HelpCircle, Play, Plus, RotateCw, Sparkles } from 'lucide-react'
import type { PlaybackContext } from '../stores/playbackSessionStore'
import type { PlaylistFooterResult, ResolvedCandidate, SetlistResult, SimilarArtistCardResult } from '../lib/suggestions'
import { extractPlayableTracks } from '../lib/suggestions'
import { usePlaybackSessionStore } from '../stores/playbackSessionStore'
import { useLibraryStore } from '../stores/libraryStore'
import { usePlaylistStore } from '../stores/playlistStore'

export type SuggestionResult = SetlistResult | PlaylistFooterResult | SimilarArtistCardResult

interface SuggestionsPanelProps {
  result: SuggestionResult
  heading: string
  subheading?: string
  playContext: PlaybackContext
  loading?: boolean
  onRefresh?: () => void
  addToPlaylistId?: string
}

function statusIcon(entry: ResolvedCandidate) {
  switch (entry.outcome.status) {
    case 'matched':
      return <CheckCircle2 size={14} className="text-emerald-600" />
    case 'owned':
      return <CheckCircle2 size={14} className="text-sky-600" />
    case 'ambiguous':
      return <HelpCircle size={14} className="text-amber-500" />
    case 'veto':
    case 'error':
      return <AlertTriangle size={14} className="text-rose-500" />
  }
}

function statusLabel(entry: ResolvedCandidate): string {
  switch (entry.outcome.status) {
    case 'matched':
      return 'Found on TIDAL'
    case 'owned':
      return 'Already in library'
    case 'ambiguous':
      return 'Multiple possible matches'
    case 'veto':
      return `Vetoed: ${entry.outcome.reason}`
    case 'error':
      return `Lookup error: ${entry.outcome.error}`
  }
}

export default function SuggestionsPanel({
  result,
  heading,
  subheading,
  playContext,
  loading = false,
  onRefresh,
  addToPlaylistId,
}: SuggestionsPanelProps) {
  const playTracks = usePlaybackSessionStore((state) => state.playTracks)
  const cacheTidalTracks = useLibraryStore((state) => state.cacheTidalTracks)
  const appendItemsToPlaylist = usePlaylistStore((state) => state.appendItemsToPlaylist)

  const playable = useMemo(() => extractPlayableTracks(result), [result])
  const matchedCount = playable.length
  const vetoCount = result.resolved.filter(
    (entry) => entry.outcome.status === 'veto' || entry.outcome.status === 'error',
  ).length

  async function handlePlayAll() {
    if (playable.length === 0) return
    const tidalTracks = playable.filter((t) => t.source === 'tidal')
    if (tidalTracks.length > 0) {
      await cacheTidalTracks(tidalTracks)
    }
    playTracks(playable, playContext, 0, result.id)
  }

  async function handleAddToPlaylist() {
    if (!addToPlaylistId) return
    if (playable.length === 0) return
    await appendItemsToPlaylist(addToPlaylistId, playable)
  }

  return (
    <section className="rounded-[28px] border border-black/8 bg-white shadow-[0_1px_0_rgba(17,17,22,0.03)]">
      <header className="flex flex-wrap items-start justify-between gap-3 px-5 py-4 sm:px-6">
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 rounded-full bg-[#fce5e8] p-2 text-[#b03a4d]">
            <Sparkles size={16} />
          </div>
          <div className="min-w-0">
            <h3 className="deezer-display text-[1.45rem] leading-none text-[#111116]">{heading}</h3>
            {subheading ? <p className="mt-1.5 text-xs text-[#7a7b86]">{subheading}</p> : null}
            <p className="mt-1.5 text-xs text-[#8b8c95]">
              {matchedCount} playable · {vetoCount} vetoed
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {onRefresh ? (
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-full border border-black/8 bg-white px-3 py-1.5 text-xs text-[#111116] hover:bg-[#f8f8f9] disabled:opacity-40"
            >
              <RotateCw size={12} className={loading ? 'animate-spin' : ''} />
              Regenerate
            </button>
          ) : null}
          {addToPlaylistId ? (
            <button
              type="button"
              onClick={() => void handleAddToPlaylist()}
              disabled={matchedCount === 0}
              className="inline-flex items-center gap-1.5 rounded-full border border-black/8 bg-white px-3 py-1.5 text-xs text-[#111116] hover:bg-[#f8f8f9] disabled:opacity-40"
            >
              <Plus size={12} />
              Add matched to playlist
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void handlePlayAll()}
            disabled={matchedCount === 0}
            className="inline-flex items-center gap-1.5 rounded-full bg-[#ef5466] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#e0364a] disabled:opacity-40"
          >
            <Play size={12} />
            Play matched
          </button>
        </div>
      </header>

      <ol className="divide-y divide-black/6 border-t border-black/6">
        {result.resolved.map((entry, index) => (
          <li key={`${entry.candidate.title}-${index}`} className="px-5 py-3 text-sm sm:px-6">
            <div className="flex items-start gap-3">
              <span className="mt-1">{statusIcon(entry)}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[#111116]">
                  <span className="font-medium">
                    {entry.outcome.status === 'matched' || entry.outcome.status === 'owned'
                      ? entry.outcome.track.title
                      : entry.candidate.title}
                  </span>
                  <span className="text-[#7a7b86]"> — </span>
                  <span className="text-[#7a7b86]">
                    {entry.outcome.status === 'matched' || entry.outcome.status === 'owned'
                      ? entry.outcome.track.artist
                      : entry.candidate.artist}
                  </span>
                </p>
                <p className="mt-0.5 text-xs text-[#8b8c95]">
                  {entry.candidate.reason}
                </p>
                <p className="mt-0.5 text-[11px] text-[#a2a3ad]">{statusLabel(entry)}</p>
              </div>
            </div>
          </li>
        ))}
        {result.resolved.length === 0 ? (
          <li className="px-5 py-6 text-center text-sm text-[#8b8c95] sm:px-6">
            No suggestions returned.
          </li>
        ) : null}
      </ol>
    </section>
  )
}
