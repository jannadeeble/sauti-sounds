import { useEffect, useRef, useState } from 'react'
import { Music, Send, Sparkles, User } from 'lucide-react'
import { chat, isLLMConfigured } from '../lib/llm'
import { generateSetlistSeed } from '../lib/mixGenerator'
import { useLibraryStore } from '../stores/libraryStore'
import { useMixStore } from '../stores/mixStore'
import { usePlaybackSessionStore } from '../stores/playbackSessionStore'
import { useTasteStore } from '../stores/tasteStore'

interface Message {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

interface ChatSuggestion {
  label: string
  kind: 'chat' | 'song-radio' | 'taste-on'
}

const SUGGESTIONS: ChatSuggestion[] = [
  { label: 'Play something warm and rhythmic', kind: 'chat' },
  { label: 'Build me a 45-minute sunset set', kind: 'chat' },
  { label: 'Give me a chill work soundtrack', kind: 'chat' },
  { label: 'Recommend tracks that fit what is playing now', kind: 'song-radio' },
  { label: 'Recommend based on my taste', kind: 'taste-on' },
]

export default function AIChatPanel() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [useTaste, setUseTaste] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const currentTrack = usePlaybackSessionStore((state) => state.currentTrack)
  const libraryTracks = useLibraryStore((state) => state.tracks)
  const tasteProfile = useTasteStore((state) => state.profile)
  const upsertMix = useMixStore((state) => state.upsert)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  async function handleSend(text?: string) {
    const message = text || input.trim()
    if (!message) return

    if (!isLLMConfigured()) {
      setMessages((current) => [
        ...current,
        { role: 'user', content: message, timestamp: Date.now() },
        {
          role: 'assistant',
          content: 'Configure an AI provider in Settings before asking Sauti for recommendations.',
          timestamp: Date.now(),
        },
      ])
      setInput('')
      return
    }

    setInput('')
    setMessages((current) => [...current, { role: 'user', content: message, timestamp: Date.now() }])
    setLoading(true)

    try {
      const response = await chat(message, {
        currentTrack: currentTrack || undefined,
        tasteProfile: useTaste ? tasteProfile ?? undefined : undefined,
      })

      setMessages((current) => [
        ...current,
        { role: 'assistant', content: response, timestamp: Date.now() },
      ])
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Sauti hit an unexpected problem while reaching the language model.'

      setMessages((current) => [
        ...current,
        {
          role: 'assistant',
          content: `I ran into an error: ${message}`,
          timestamp: Date.now(),
        },
      ])
    } finally {
      setLoading(false)
    }
  }

  async function handleSuggestion(suggestion: ChatSuggestion) {
    if (suggestion.kind === 'taste-on') {
      setUseTaste(true)
      void handleSend('Recommend new music based on my taste profile.')
      return
    }
    if (suggestion.kind === 'song-radio') {
      if (!currentTrack) return
      setMessages((current) => [
        ...current,
        { role: 'user', content: suggestion.label, timestamp: Date.now() },
      ])
      setLoading(true)
      try {
        const mix = await generateSetlistSeed(
          { library: libraryTracks, tasteProfile },
          currentTrack,
          { count: 12, useProfile: useTaste },
        )
        if (mix) {
          await upsertMix(mix)
          setMessages((current) => [
            ...current,
            {
              role: 'assistant',
              content: `Built a ${mix.trackIds.length}-track radio mix from "${currentTrack.title}". Open the home tab to preview or save it.`,
              timestamp: Date.now(),
            },
          ])
        } else {
          setMessages((current) => [
            ...current,
            {
              role: 'assistant',
              content: "Couldn't build a radio mix right now — try again.",
              timestamp: Date.now(),
            },
          ])
        }
      } finally {
        setLoading(false)
      }
      return
    }
    void handleSend(suggestion.label)
  }

  return (
    <div className="flex h-full min-h-[60vh] flex-col">
      <div className="mb-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setUseTaste((on) => !on)}
          className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
            useTaste
              ? 'bg-[#ef5466] text-white'
              : 'border border-black/8 bg-white text-[#555661] hover:border-black/16'
          }`}
          title={tasteProfile ? 'Toggle taste profile context' : 'No taste profile yet — re-analyze in Settings'}
          disabled={!tasteProfile}
        >
          <User size={12} />
          {useTaste ? 'Using my taste' : 'Use my taste'}
        </button>
        {!tasteProfile ? (
          <span className="text-xs text-[#9a9ba3]">Analyze your library in Settings to enable.</span>
        ) : null}
      </div>
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto pb-4">
        {messages.length === 0 ? (
          <div className="space-y-4 py-6">
            <div className="text-center">
              <Sparkles size={38} className="mx-auto mb-3 text-accent/70" />
              <h3 className="deezer-display text-[1.8rem] leading-none text-[#111116]">Ask Sauti</h3>
              <p className="mx-auto mt-3 max-w-sm text-sm text-[#7a7b86]">
                Chat about what to play, ask for a playlist, or use the current queue as context.
              </p>
            </div>

            {currentTrack ? (
              <div className="rounded-2xl border border-accent/20 bg-accent/10 px-4 py-3 text-sm text-[#a33a4b]">
                Currently playing: <span className="font-medium text-[#111116]">{currentTrack.title}</span> by{' '}
                {currentTrack.artist}
              </div>
            ) : null}

            <div className="space-y-2">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion.label}
                  type="button"
                  onClick={() => void handleSuggestion(suggestion)}
                  disabled={suggestion.kind === 'song-radio' && !currentTrack}
                  className="block w-full rounded-2xl border border-black/8 bg-[#f8f8f9] px-4 py-3 text-left text-sm text-[#111116] transition-colors hover:bg-[#f1f1f4] disabled:opacity-40"
                >
                  <Music size={14} className="mr-2 inline text-accent" />
                  {suggestion.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {messages.map((message) => (
          <div
            key={`${message.role}-${message.timestamp}`}
            className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[88%] rounded-2xl px-4 py-3 text-sm ${
                message.role === 'user'
                  ? 'rounded-br-md bg-accent text-white'
                  : 'rounded-bl-md border border-black/8 bg-[#f8f8f9] text-[#111116]'
              }`}
            >
              <div className="whitespace-pre-wrap">{message.content}</div>
            </div>
          </div>
        ))}

        {loading ? (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-md border border-black/8 bg-[#f8f8f9] px-4 py-3">
              <div className="flex gap-1">
                <span className="h-2 w-2 animate-bounce rounded-full bg-[#8c8d96]" style={{ animationDelay: '0ms' }} />
                <span className="h-2 w-2 animate-bounce rounded-full bg-[#8c8d96]" style={{ animationDelay: '150ms' }} />
                <span className="h-2 w-2 animate-bounce rounded-full bg-[#8c8d96]" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault()
          void handleSend()
        }}
        className="mt-3 flex items-center gap-2 border-t border-black/6 pt-4"
      >
        <input
          type="text"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Ask Sauti anything about music..."
          className="flex-1 rounded-full border border-black/8 bg-[#f8f8f9] px-4 py-3 text-sm text-[#111116] outline-none ring-0 placeholder:text-[#9ea0aa] focus:ring-2 focus:ring-accent/20"
          disabled={loading}
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="rounded-full bg-accent p-3 text-white transition-colors hover:bg-accent-dark disabled:opacity-30"
        >
          <Send size={18} />
        </button>
      </form>
    </div>
  )
}
