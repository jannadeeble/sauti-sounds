import { useCallback, useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import SuggestionsPanel from './SuggestionsPanel'
import { useLibraryStore } from '../stores/libraryStore'
import { useNotificationStore } from '../stores/notificationStore'
import { isLLMConfigured } from '../lib/llm'
import type { PlaylistFooterResult } from '../lib/suggestions'
import { getPlaylistFooterSuggestions } from '../lib/suggestions'
import type { Track } from '../types'

interface PlaylistFooterSuggestionsProps {
  playlistId: string
  playlistName: string
  playlistTracks: Track[]
  appendable: boolean
}

export default function PlaylistFooterSuggestions({
  playlistId,
  playlistName,
  playlistTracks,
  appendable,
}: PlaylistFooterSuggestionsProps) {
  const library = useLibraryStore((state) => state.tracks)
  const push = useNotificationStore((state) => state.push)
  const [result, setResult] = useState<PlaylistFooterResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [opened, setOpened] = useState(false)

  const generate = useCallback(
    async (force: boolean) => {
      if (!isLLMConfigured()) {
        setError('Connect an AI provider in Settings to generate suggestions.')
        return
      }
      if (playlistTracks.length === 0) return
      setLoading(true)
      setError(null)
      try {
        const next = await getPlaylistFooterSuggestions({
          playlistId,
          playlistName,
          playlistTracks,
          context: { library },
          force,
        })
        setResult(next)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        setError(message)
        push({ level: 'warning', title: 'Playlist suggestions failed', body: message })
      } finally {
        setLoading(false)
      }
    },
    [library, playlistId, playlistName, playlistTracks, push],
  )

  useEffect(() => {
    if (opened && !result && !loading) {
      void generate(false)
    }
  }, [generate, loading, opened, result])

  if (!opened) {
    return (
      <button
        type="button"
        onClick={() => setOpened(true)}
        className="inline-flex items-center gap-2 rounded-full border border-black/8 bg-white px-4 py-2 text-sm text-[#111116] transition-colors hover:bg-[#f8f8f9]"
      >
        <Sparkles size={14} className="text-[#b03a4d]" />
        Suggest tracks to add
      </button>
    )
  }

  return (
    <div className="space-y-3">
      {error ? (
        <div className="rounded-2xl border border-[#f4c6cc] bg-[#fff4f6] px-4 py-3 text-sm text-[#8d3140]">
          {error}
        </div>
      ) : null}
      {loading && !result ? (
        <div className="rounded-2xl border border-black/6 bg-[#f8f8f9] px-4 py-4 text-sm text-[#686973]">
          Thinking through the vibe of "{playlistName}"…
        </div>
      ) : null}
      {result ? (
        <SuggestionsPanel
          result={result}
          heading={`Suggestions for "${playlistName}"`}
          playContext="suggestion-playlist-footer"
          loading={loading}
          onRefresh={() => void generate(true)}
          addToPlaylistId={appendable ? playlistId : undefined}
        />
      ) : null}
    </div>
  )
}
