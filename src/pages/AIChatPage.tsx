import { useState, useRef, useEffect } from 'react'
import { ArrowLeft, Send, Sparkles, Music } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { chat, isLLMConfigured } from '../lib/llm'
import { usePlayerStore } from '../stores/playerStore'
import { useLibraryStore } from '../stores/libraryStore'

interface Message {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

const SUGGESTIONS = [
  'Play something chill for working',
  'Build me a 1-hour sunset playlist',
  'What genres am I into?',
  'Something energetic for a workout',
  "Recommend music like Nils Frahm",
]

export default function AIChatPage() {
  const navigate = useNavigate()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const currentTrack = usePlayerStore(s => s.currentTrack)
  const tracks = useLibraryStore(s => s.tracks.filter(track => track.source === 'local'))

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  async function handleSend(text?: string) {
    const message = text || input.trim()
    if (!message) return

    if (!isLLMConfigured()) {
      setMessages(prev => [
        ...prev,
        { role: 'user', content: message, timestamp: Date.now() },
        { role: 'assistant', content: 'Please configure an AI provider in Settings first. I need an API key to help you with recommendations.', timestamp: Date.now() },
      ])
      setInput('')
      return
    }

    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: message, timestamp: Date.now() }])
    setLoading(true)

    try {
      const recentTracks = tracks.slice(0, 10)
      const response = await chat(message, { currentTrack: currentTrack || undefined, recentTracks })
      setMessages(prev => [...prev, { role: 'assistant', content: response, timestamp: Date.now() }])
    } catch (err: any) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Sorry, I encountered an error: ${err.message}. Check your API key in Settings.`,
        timestamp: Date.now(),
      }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5">
        <button onClick={() => navigate(-1)} className="p-2 -ml-2 hover:bg-white/10 rounded-full">
          <ArrowLeft size={20} />
        </button>
        <div className="flex items-center gap-2">
          <Sparkles size={18} className="text-accent" />
          <h1 className="text-lg font-bold">Sauti AI</h1>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center py-8">
            <Sparkles size={40} className="mx-auto text-accent/50 mb-4" />
            <h2 className="text-lg font-medium mb-1">Hey! I'm Sauti</h2>
            <p className="text-sm text-gray-400 mb-6 max-w-xs mx-auto">
              Your AI music assistant. Ask me to create playlists, recommend tracks, or discover new music.
            </p>
            <div className="space-y-2">
              {SUGGESTIONS.map(s => (
                <button
                  key={s}
                  onClick={() => handleSend(s)}
                  className="block w-full text-left bg-surface-800 hover:bg-surface-700 rounded-xl px-4 py-3 text-sm text-gray-300 transition-colors"
                >
                  <Music size={14} className="inline mr-2 text-accent" />
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${
                msg.role === 'user'
                  ? 'bg-accent text-white rounded-br-md'
                  : 'bg-surface-700 text-gray-200 rounded-bl-md'
              }`}
            >
              <div className="whitespace-pre-wrap">{msg.content}</div>
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-surface-700 rounded-2xl rounded-bl-md px-4 py-3">
              <div className="flex gap-1">
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t border-white/5">
        <form
          onSubmit={e => { e.preventDefault(); handleSend() }}
          className="flex items-center gap-2"
        >
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Ask Sauti anything about music..."
            className="flex-1 bg-surface-700 rounded-full px-4 py-2.5 text-sm text-white placeholder-gray-500 outline-none focus:ring-2 focus:ring-accent/50"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="p-2.5 bg-accent rounded-full text-white disabled:opacity-30 hover:bg-accent-dark transition-colors"
          >
            <Send size={18} />
          </button>
        </form>
      </div>
    </div>
  )
}
