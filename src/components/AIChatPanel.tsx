import { useEffect, useMemo, useRef, useState } from 'react'
import { Music, Send, Sparkles } from 'lucide-react'
import { chat, isLLMConfigured } from '../lib/llm'
import { useLibraryStore } from '../stores/libraryStore'
import { usePlaybackSessionStore } from '../stores/playbackSessionStore'

interface Message {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

const SUGGESTIONS = [
  'Play something warm and rhythmic',
  'Build me a 45-minute sunset set',
  'Recommend tracks that fit what is playing now',
  'What genres show up most in my library?',
  'Give me a chill work soundtrack',
] as const

export default function AIChatPanel() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const currentTrack = usePlaybackSessionStore((state) => state.currentTrack)
  const libraryTracks = useLibraryStore((state) => state.tracks)
  const tracks = useMemo(
    () => libraryTracks.filter((track) => track.source === 'local'),
    [libraryTracks],
  )

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
        recentTracks: tracks.slice(0, 10),
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

  return (
    <div className="flex h-[68vh] flex-col">
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
                  key={suggestion}
                  type="button"
                  onClick={() => void handleSend(suggestion)}
                  className="block w-full rounded-2xl border border-black/8 bg-[#f8f8f9] px-4 py-3 text-left text-sm text-[#111116] transition-colors hover:bg-[#f1f1f4]"
                >
                  <Music size={14} className="mr-2 inline text-accent" />
                  {suggestion}
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
