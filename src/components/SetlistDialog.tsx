import { useCallback, useEffect, useState } from 'react'
import BottomSheet from './BottomSheet'
import SuggestionsPanel from './SuggestionsPanel'
import { useLibraryStore } from '../stores/libraryStore'
import { useNotificationStore } from '../stores/notificationStore'
import { isLLMConfigured } from '../lib/llm'
import type { SetlistResult, SuggestionContext } from '../lib/suggestions'
import { getSetlistSeeds } from '../lib/suggestions'
import type { Track } from '../types'

interface SetlistDialogProps {
  seed: Track | null
  onClose: () => void
}

export default function SetlistDialog({ seed, onClose }: SetlistDialogProps) {
  const library = useLibraryStore((state) => state.tracks)
  const push = useNotificationStore((state) => state.push)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<SetlistResult | null>(null)

  const generate = useCallback(
    async (force: boolean) => {
      if (!seed) return
      if (!isLLMConfigured()) {
        setError('Connect an AI provider in Settings first.')
        return
      }
      setLoading(true)
      setError(null)
      try {
        const context: SuggestionContext = { library }
        const next = await getSetlistSeeds({ seed, context, force })
        setResult(next)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        setError(message)
        push({ level: 'warning', title: 'Setlist generation failed', body: message })
      } finally {
        setLoading(false)
      }
    },
    [library, push, seed],
  )

  useEffect(() => {
    if (seed) {
      setResult(null)
      void generate(false)
    }
  }, [generate, seed])

  const open = seed !== null

  return (
    <BottomSheet
      open={open}
      title={seed ? `Setlist from "${seed.title}"` : 'Setlist seeds'}
      description={seed ? `Sonnet 4.5 thinking mode, ${seed.artist}` : 'AI-curated DJ setlist'}
      onClose={onClose}
      maxHeightClassName="max-h-[88vh]"
    >
      <div className="space-y-4">
        {error ? (
          <div className="rounded-2xl border border-[#f4c6cc] bg-[#fff4f6] px-4 py-3 text-sm text-[#8d3140]">
            {error}
          </div>
        ) : null}

        {loading && !result ? (
          <div className="rounded-2xl border border-black/6 bg-[#f8f8f9] px-4 py-4 text-sm text-[#686973]">
            Generating 15 picks with extended thinking… this can take 20–40 seconds.
          </div>
        ) : null}

        {result ? (
          <SuggestionsPanel
            result={result}
            heading="15-track setlist"
            subheading={seed ? `Seed: ${seed.artist} — ${seed.title}` : undefined}
            playContext="suggestion-setlist"
            loading={loading}
            onRefresh={() => void generate(true)}
          />
        ) : null}
      </div>
    </BottomSheet>
  )
}
