import { useCallback, useEffect, useState } from 'react'
import { Disc3, RotateCw, Sparkles } from 'lucide-react'
import SuggestionsPanel from './SuggestionsPanel'
import TrackRow from './TrackRow'
import { useLibraryStore } from '../stores/libraryStore'
import { useNotificationStore } from '../stores/notificationStore'
import { isLLMConfigured } from '../lib/llm'
import type { HomeFeedCard } from '../lib/suggestions'
import { getHomeFeed } from '../lib/suggestions'

export default function HomeFeed() {
  const library = useLibraryStore((state) => state.tracks)
  const push = useNotificationStore((state) => state.push)
  const [cards, setCards] = useState<HomeFeedCard[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasLoaded, setHasLoaded] = useState(false)

  const load = useCallback(
    async (force: boolean) => {
      if (!isLLMConfigured()) {
        setError('Connect an AI provider in Settings to unlock suggestions.')
        return
      }
      if (library.length === 0) {
        setCards([])
        setError('Import music or connect TIDAL to unlock suggestions.')
        return
      }
      setLoading(true)
      setError(null)
      try {
        const next = await getHomeFeed({ context: { library }, force })
        setCards(next)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        setError(message)
        push({ level: 'warning', title: 'Home feed failed', body: message })
      } finally {
        setLoading(false)
        setHasLoaded(true)
      }
    },
    [library, push],
  )

  useEffect(() => {
    if (!hasLoaded) void load(false)
  }, [hasLoaded, load])

  if (!hasLoaded && !loading && !error) {
    return null
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="deezer-display text-[1.6rem] leading-none text-[#111116]">For you</h2>
        <button
          type="button"
          onClick={() => void load(true)}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-full border border-black/8 bg-white px-3 py-1.5 text-xs text-[#111116] hover:bg-[#f8f8f9] disabled:opacity-40"
        >
          <RotateCw size={12} className={loading ? 'animate-spin' : ''} />
          Refresh feed
        </button>
      </div>

      {error ? (
        <div className="rounded-[22px] border border-[#f4c6cc] bg-[#fff4f6] px-5 py-4 text-sm text-[#8d3140]">
          {error}
        </div>
      ) : null}

      {loading && cards.length === 0 ? (
        <div className="rounded-[22px] border border-black/6 bg-[#f8f8f9] px-5 py-6 text-sm text-[#686973]">
          <Sparkles size={16} className="mr-2 inline text-[#b03a4d]" />
          Thinking through your listening patterns…
        </div>
      ) : null}

      {cards.map((card) =>
        card.kind === 'home-rediscovery' ? (
          <section
            key={card.id}
            className="rounded-[28px] border border-black/8 bg-white shadow-[0_1px_0_rgba(17,17,22,0.03)]"
          >
            <header className="flex items-start justify-between gap-3 px-5 py-4 sm:px-6">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 rounded-full bg-[#e5f2ff] p-2 text-[#1a5fbf]">
                  <Disc3 size={16} />
                </div>
                <div>
                  <h3 className="deezer-display text-[1.45rem] leading-none text-[#111116]">
                    Rediscover from your library
                  </h3>
                  <p className="mt-1 text-xs text-[#7a7b86]">
                    Tracks you used to love but haven't played in a while.
                  </p>
                </div>
              </div>
            </header>
            <div className="divide-y divide-black/6 border-t border-black/6">
              {card.tracks.map((track, index) => (
                <TrackRow
                  key={track.id}
                  track={track}
                  tracks={card.tracks}
                  playContext="suggestion-home"
                  index={index}
                  showIndex
                />
              ))}
            </div>
          </section>
        ) : (
          <SuggestionsPanel
            key={card.id}
            result={card}
            heading={`Similar to ${card.seedArtist}: ${card.artist}`}
            subheading={card.characterization}
            playContext="suggestion-home"
          />
        ),
      )}
    </section>
  )
}
