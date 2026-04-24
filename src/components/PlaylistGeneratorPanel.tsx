import { useState } from 'react'
import { Bell, ExternalLink, Music, RefreshCw, Sparkles } from 'lucide-react'
import { isLLMConfigured } from '../lib/llm'
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
  const cardClass = 'sauti-modal-card p-5'
  const inputClass = 'sauti-modal-input mt-2 px-4 py-3 text-sm'
  const secondaryButtonClass = 'sauti-modal-secondary-button px-4 py-2.5 text-sm font-medium'
  const primaryButtonClass = 'sauti-modal-primary-button px-4 py-2.5 text-sm font-medium'

  function handleSubmit(nextPrompt?: string) {
    const prompt = (nextPrompt ?? input).trim()
    if (!prompt || status === 'running') return
    setInput(prompt)
    void run(prompt, { count, titleOverride, useTaste })
  }

  if (!isLLMConfigured()) {
    return (
      <section className="sauti-modal-card px-6 py-10 text-center">
        <Sparkles size={34} className="mx-auto text-accent" />
        <h3 className="sauti-title mt-4 text-[1.8rem] leading-none text-[#111116]">Playlist generator</h3>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-[#7a7b86]">
          Configure an AI provider in Settings before generating playlists from prompts.
        </p>
      </section>
    )
  }

  return (
    <div className={`flex flex-col ${isInline ? 'gap-4' : 'h-full min-h-[60vh]'}`}>
      {status === 'running' ? (
        <div className={`flex flex-1 flex-col items-center justify-center text-center ${isInline ? 'gap-4 py-2' : 'gap-6 py-8'}`}>
          <div className={`${isInline ? 'h-20 w-20' : 'h-24 w-24'} flex items-center justify-center rounded-full border border-[var(--sauti-border)] bg-[var(--sauti-panel)] text-accent shadow-[0_20px_54px_rgba(17,17,22,0.10)]`}>
            <Bell size={isInline ? 28 : 34} />
          </div>
          <div className="space-y-2">
            <h3 className={`sauti-title leading-none text-[#111116] ${isInline ? 'text-[1.55rem]' : 'text-[1.9rem]'}`}>Cool, thank you.</h3>
            <p className="mx-auto max-w-md text-sm leading-6 text-[#7a7b86]">
              You can leave this screen. A notification will appear here when the playlist is ready, and it will show up in Playlists.
            </p>
            <p className="sauti-modal-card-muted mx-auto max-w-lg px-4 py-3 text-sm text-[#555661]">
              {currentPrompt}
            </p>
          </div>
        </div>
      ) : status === 'success' && result ? (
        <div className={`flex flex-1 flex-col justify-center ${isInline ? 'py-1' : 'py-8'}`}>
          <div className="sauti-modal-card p-6">
            <p className="sauti-modal-kicker">Generated playlist</p>
            <h3 className="sauti-title mt-3 text-[2rem] leading-none text-[#111116]">{result.name}</h3>
            <p className="mt-3 text-sm text-[#7a7b86]">
              {result.trackCount} tracks built from your prompt.
            </p>
            {result.blurb ? (
              <p className="sauti-modal-card-muted mt-4 px-4 py-4 text-sm leading-6 text-[#555661]">
                {result.blurb}
              </p>
            ) : null}
            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onOpenPlaylist?.(result.id)}
                className={primaryButtonClass}
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
                className={secondaryButtonClass}
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
            <Sparkles size={isInline ? 28 : 36} className="mx-auto text-accent" />
            <h3 className={`sauti-title mt-3 leading-none text-[#111116] ${isInline ? 'text-[1.55rem]' : 'text-[1.9rem]'}`}>Playlist generator</h3>
            <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-[#7a7b86]">
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
                className="sauti-modal-card-muted block w-full px-4 py-3 text-left text-sm text-[#555661] transition-colors hover:bg-[#f3f3f6]"
              >
                <Music size={14} className="mr-2 inline text-accent" />
                {suggestion}
              </button>
            ))}
          </div>

          <div className={cardClass}>
            <label className="block">
              <span className="sauti-modal-kicker">Name your playlist</span>
              <input
                type="text"
                value={titleOverride}
                onChange={(event) => setTitleOverride(event.target.value)}
                placeholder="Optional custom title"
                className={inputClass}
              />
            </label>

            <label className="mt-4 block">
              <span className="sauti-modal-kicker">Prompt</span>
              <textarea
                rows={4}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="A spacious late-night set that starts in Lagos, drifts through Lisbon, and lands in dubby house before sunrise."
                className={inputClass}
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
                    : 'border border-black/8 bg-[#f8f8f9] text-[#555661] hover:bg-[#f3f3f6]'
                }`}
                title={tasteProfile ? 'Toggle taste profile context' : 'No taste profile yet'}
                disabled={!tasteProfile}
              >
                <Sparkles size={14} />
                {useTaste ? 'Using my taste' : 'Use my taste'}
              </button>
            </div>

            {!tasteProfile ? (
              <p className="mt-3 text-xs text-[#8b8c95]">Analyze your library in Settings to use taste profile context.</p>
            ) : null}

            {error ? (
              <p className="mt-4 rounded-[22px] border border-[var(--sauti-accent-border)] bg-[var(--sauti-accent-soft)] px-4 py-3 text-sm text-[var(--sauti-accent-text)]">
                {error}
              </p>
            ) : null}

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => handleSubmit()}
                disabled={!input.trim()}
                className={`${primaryButtonClass} disabled:opacity-40`}
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
