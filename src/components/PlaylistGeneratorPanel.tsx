import { useState } from 'react'
import { ExternalLink, Music, RefreshCw, Sparkles } from 'lucide-react'
import { isLLMConfigured } from '../lib/llm'
import NetworkLoadingAnimation from './NetworkLoadingAnimation'
import { usePlaylistGeneratorStore } from '../stores/playlistGeneratorStore'
import { useTasteStore } from '../stores/tasteStore'

const PROMPT_SUGGESTIONS = [
  'A 45-minute sunset set with warm percussion and soft peaks',
  'Low-lit dinner music with African jazz, dub, and no obvious hits',
  'A focused deep-work playlist with movement but no vocals',
  'A late-night dancefloor arc that starts patient and ends sweaty',
]

export default function PlaylistGeneratorPanel({
  onOpenPlaylist,
  variant = 'sheet',
}: {
  onOpenPlaylist?: (playlistId: string) => void
  variant?: 'sheet' | 'inline'
}) {
  const [count, setCount] = useState(15)
  const [input, setInput] = useState('')
  const [titleOverride, setTitleOverride] = useState('')
  const [useTaste, setUseTaste] = useState(false)
  const isInline = variant === 'inline'

  const tasteProfile = useTasteStore((state) => state.profile)
  const currentPrompt = usePlaylistGeneratorStore((state) => state.currentPrompt)
  const error = usePlaylistGeneratorStore((state) => state.error)
  const result = usePlaylistGeneratorStore((state) => state.result)
  const run = usePlaylistGeneratorStore((state) => state.run)
  const status = usePlaylistGeneratorStore((state) => state.status)
  const reset = usePlaylistGeneratorStore((state) => state.reset)

  function handleSubmit(nextPrompt?: string) {
    const prompt = (nextPrompt ?? input).trim()
    if (!prompt || status === 'running') return
    setInput(prompt)
    void run(prompt, { count, titleOverride, useTaste })
  }

  if (!isLLMConfigured()) {
    return (
      <section className="rounded-[28px] border border-black/8 bg-white px-6 py-10 text-center shadow-[0_1px_0_rgba(17,17,22,0.03)]">
        <Sparkles size={34} className="mx-auto text-accent/70" />
        <h3 className="deezer-display mt-4 text-[1.8rem] leading-none text-[#111116]">Playlist generator</h3>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-[#686973]">
          Configure an AI provider in Settings before generating playlists from prompts.
        </p>
      </section>
    )
  }

  return (
    <div className={`flex flex-col ${isInline ? 'gap-4' : 'h-full min-h-[60vh]'}`}>
      {status === 'running' ? (
        <div className={`flex flex-1 flex-col items-center justify-center text-center ${isInline ? 'gap-4 py-2' : 'gap-6 py-8'}`}>
          <div className={`${isInline ? 'h-36 w-36' : 'h-44 w-44'} rounded-full border border-[#f2d8dd] bg-[radial-gradient(circle_at_top,rgba(239,84,102,0.16),rgba(255,255,255,0.85)_65%)] p-5 shadow-[0_16px_48px_rgba(239,84,102,0.14)]`}>
            <NetworkLoadingAnimation />
          </div>
          <div className="space-y-2">
            <h3 className={`deezer-display leading-none text-[#111116] ${isInline ? 'text-[1.55rem]' : 'text-[1.9rem]'}`}>Building your playlist</h3>
            <p className="mx-auto max-w-md text-sm leading-6 text-[#686973]">
              Sauti is resolving tracks and shaping the arc.
            </p>
            <p className="mx-auto max-w-lg rounded-2xl border border-black/6 bg-[#f8f8f9] px-4 py-3 text-sm text-[#111116]">
              {currentPrompt}
            </p>
          </div>
        </div>
      ) : status === 'success' && result ? (
        <div className={`flex flex-1 flex-col justify-center ${isInline ? 'py-1' : 'py-8'}`}>
          <div className="rounded-[28px] border border-black/8 bg-white p-6 shadow-[0_1px_0_rgba(17,17,22,0.03)]">
            <p className="text-xs uppercase tracking-[0.24em] text-[#8b8c95]">Generated playlist</p>
            <h3 className="deezer-display mt-3 text-[2rem] leading-none text-[#111116]">{result.name}</h3>
            <p className="mt-3 text-sm text-[#686973]">
              {result.trackCount} tracks built from your prompt.
            </p>
            {result.blurb ? (
              <p className="mt-4 rounded-2xl border border-black/6 bg-[#f8f8f9] px-4 py-4 text-sm leading-6 text-[#555661]">
                {result.blurb}
              </p>
            ) : null}
            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onOpenPlaylist?.(result.id)}
                className="inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-dark"
              >
                <Music size={15} />
                Open playlist
                <ExternalLink size={13} />
              </button>
              <button
                type="button"
                onClick={() => {
                  setInput(result.prompt)
                  setTitleOverride(result.name)
                  reset()
                }}
                className="inline-flex items-center gap-2 rounded-full border border-black/8 bg-white px-4 py-2.5 text-sm font-medium text-[#111116] transition-colors hover:bg-[#f8f8f9]"
              >
                <RefreshCw size={15} />
                Generate another
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className={`flex-1 space-y-5 ${isInline ? 'pb-1' : 'pb-4'}`}>
          <div className="text-center">
            <Sparkles size={isInline ? 28 : 36} className="mx-auto text-accent/70" />
            <h3 className={`deezer-display mt-3 leading-none text-[#111116] ${isInline ? 'text-[1.55rem]' : 'text-[1.9rem]'}`}>Playlist generator</h3>
            <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-[#686973]">
              Describe the mood, the flow, the edge cases, and Sauti will file the result into your playlists.
            </p>
          </div>

          <div className="space-y-2">
            {PROMPT_SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => {
                  setInput(suggestion)
                  handleSubmit(suggestion)
                }}
                className="block w-full rounded-2xl border border-black/8 bg-[#f8f8f9] px-4 py-3 text-left text-sm text-[#111116] transition-colors hover:bg-[#f1f1f4]"
              >
                <Music size={14} className="mr-2 inline text-accent" />
                {suggestion}
              </button>
            ))}
          </div>

          <div className="rounded-[28px] border border-black/8 bg-white p-5 shadow-[0_1px_0_rgba(17,17,22,0.03)]">
            <label className="block">
              <span className="text-xs uppercase tracking-[0.24em] text-[#8b8c95]">Name your playlist</span>
              <input
                type="text"
                value={titleOverride}
                onChange={(event) => setTitleOverride(event.target.value)}
                placeholder="Optional custom title"
                className="mt-2 w-full rounded-2xl border border-black/8 bg-[#f8f8f9] px-4 py-3 text-sm text-[#111116] outline-none placeholder:text-[#9ea0aa] focus:ring-2 focus:ring-accent/20"
              />
            </label>

            <label className="mt-4 block">
              <span className="text-xs uppercase tracking-[0.24em] text-[#8b8c95]">Prompt</span>
              <textarea
                rows={4}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="A spacious late-night set that starts in Lagos, drifts through Lisbon, and lands in dubby house before sunrise."
                className="mt-2 w-full rounded-2xl border border-black/8 bg-[#f8f8f9] px-4 py-3 text-sm text-[#111116] outline-none placeholder:text-[#9ea0aa] focus:ring-2 focus:ring-accent/20"
              />
            </label>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <label className="inline-flex items-center gap-2 rounded-full border border-black/8 bg-[#f8f8f9] px-3 py-2 text-sm text-[#555661]">
                Tracks
                <input
                  type="number"
                  min={8}
                  max={30}
                  value={count}
                  onChange={(event) => setCount(Math.max(8, Math.min(30, Number(event.target.value) || 15)))}
                  className="w-14 bg-transparent text-[#111116] outline-none"
                />
              </label>

              <button
                type="button"
                onClick={() => setUseTaste((value) => !value)}
                className={`inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm transition-colors ${
                  useTaste
                    ? 'bg-[#ef5466] text-white'
                    : 'border border-black/8 bg-white text-[#555661] hover:border-black/16'
                }`}
                title={tasteProfile ? 'Toggle taste profile context' : 'No taste profile yet'}
                disabled={!tasteProfile}
              >
                <Sparkles size={14} />
                {useTaste ? 'Using my taste' : 'Use my taste'}
              </button>
            </div>

            {!tasteProfile ? (
              <p className="mt-3 text-xs text-[#9a9ba3]">Analyze your library in Settings to use taste profile context.</p>
            ) : null}

            {error ? (
              <p className="mt-4 rounded-2xl border border-[#f4c6cc] bg-[#fff4f6] px-4 py-3 text-sm text-[#8d3140]">
                {error}
              </p>
            ) : null}

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => handleSubmit()}
                disabled={!input.trim()}
                className="inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-dark disabled:opacity-40"
              >
                <Sparkles size={15} />
                Generate playlist
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
