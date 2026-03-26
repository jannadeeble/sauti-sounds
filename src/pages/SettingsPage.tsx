import { useState } from 'react'
import { Disc3, HardDrive, Trash2, Info, Brain, Music, Upload, Eye, EyeOff } from 'lucide-react'
import { useLibraryStore } from '../stores/libraryStore'
import { useSettingsStore } from '../stores/settingsStore'
import { db } from '../db'
import type { LLMProvider } from '../lib/llm'

export default function SettingsPage() {
  const { tracks, loadTracks } = useLibraryStore()
  const settings = useSettingsStore()
  const [clearing, setClearing] = useState(false)
  const [showTidalSecret, setShowTidalSecret] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)

  // Local form state
  const [tidalId, setTidalId] = useState(settings.tidalClientId)
  const [tidalSecret, setTidalSecret] = useState(settings.tidalClientSecret)
  const [llmProvider, setLlmProvider] = useState<LLMProvider>(settings.llmProvider)
  const [llmKey, setLlmKey] = useState(settings.llmApiKey)
  const [llmModel, setLlmModel] = useState(settings.llmModel)

  async function clearLibrary() {
    if (!confirm('Are you sure? This will remove all tracks from your library.')) return
    setClearing(true)
    await db.tracks.clear()
    await loadTracks()
    setClearing(false)
  }

  function saveTidal() {
    settings.setTidalCredentials(tidalId, tidalSecret)
  }

  function saveLLM() {
    settings.setLLMConfig(llmProvider, llmKey, llmModel || undefined)
  }

  const inputClass = "w-full bg-surface-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 outline-none focus:ring-2 focus:ring-accent/50"

  return (
    <div className="px-4 pt-6 pb-4 space-y-4">
      <h1 className="text-2xl font-bold mb-6">Settings</h1>

      {/* Library stats */}
      <section className="bg-surface-800 rounded-xl p-4">
        <h2 className="text-sm font-medium text-gray-300 mb-3 flex items-center gap-2">
          <HardDrive size={16} />
          Library
        </h2>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="bg-surface-700 rounded-lg p-3">
            <p className="text-2xl font-bold text-accent">{tracks.length}</p>
            <p className="text-xs text-gray-400">Tracks</p>
          </div>
          <div className="bg-surface-700 rounded-lg p-3">
            <p className="text-2xl font-bold text-accent">
              {[...new Set(tracks.map(t => t.album))].length}
            </p>
            <p className="text-xs text-gray-400">Albums</p>
          </div>
          <div className="bg-surface-700 rounded-lg p-3">
            <p className="text-2xl font-bold text-accent">
              {[...new Set(tracks.map(t => t.artist))].length}
            </p>
            <p className="text-xs text-gray-400">Artists</p>
          </div>
        </div>
        <button
          onClick={clearLibrary}
          disabled={clearing || tracks.length === 0}
          className="mt-3 w-full flex items-center justify-center gap-2 text-red-400 hover:text-red-300 text-sm py-2 rounded-lg hover:bg-red-500/10 transition-colors disabled:opacity-30"
        >
          <Trash2 size={14} />
          Clear Library
        </button>
      </section>

      {/* Tidal */}
      <section className="bg-surface-800 rounded-xl p-4">
        <h2 className="text-sm font-medium text-gray-300 mb-3 flex items-center gap-2">
          <Music size={16} />
          Tidal Integration
        </h2>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Client ID</label>
            <input
              type="text"
              value={tidalId}
              onChange={e => setTidalId(e.target.value)}
              placeholder="Your Tidal API client ID"
              className={inputClass}
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Client Secret</label>
            <div className="relative">
              <input
                type={showTidalSecret ? 'text' : 'password'}
                value={tidalSecret}
                onChange={e => setTidalSecret(e.target.value)}
                placeholder="Your Tidal API client secret"
                className={inputClass + ' pr-10'}
              />
              <button
                onClick={() => setShowTidalSecret(!showTidalSecret)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
              >
                {showTidalSecret ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          <button
            onClick={saveTidal}
            className="w-full bg-accent/10 hover:bg-accent/20 text-accent border border-accent/20 rounded-lg py-2 text-sm font-medium transition-colors"
          >
            {settings.tidalClientId ? 'Update Tidal Credentials' : 'Connect Tidal'}
          </button>
          {settings.tidalClientId && (
            <p className="text-xs text-green-400/70 flex items-center gap-1">
              <Disc3 size={12} /> Tidal connected
            </p>
          )}
        </div>
      </section>

      {/* LLM */}
      <section className="bg-surface-800 rounded-xl p-4">
        <h2 className="text-sm font-medium text-gray-300 mb-3 flex items-center gap-2">
          <Brain size={16} />
          AI Recommendations
        </h2>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Provider</label>
            <select
              value={llmProvider}
              onChange={e => setLlmProvider(e.target.value as LLMProvider)}
              className={inputClass + ' cursor-pointer'}
            >
              <option value="claude">Claude (Anthropic)</option>
              <option value="openai">GPT (OpenAI)</option>
              <option value="gemini">Gemini (Google)</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">API Key</label>
            <div className="relative">
              <input
                type={showApiKey ? 'text' : 'password'}
                value={llmKey}
                onChange={e => setLlmKey(e.target.value)}
                placeholder={`Your ${llmProvider === 'claude' ? 'Anthropic' : llmProvider === 'openai' ? 'OpenAI' : 'Google AI'} API key`}
                className={inputClass + ' pr-10'}
              />
              <button
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
              >
                {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">Model (optional)</label>
            <input
              type="text"
              value={llmModel}
              onChange={e => setLlmModel(e.target.value)}
              placeholder={llmProvider === 'claude' ? 'claude-sonnet-4-20250514' : llmProvider === 'openai' ? 'gpt-4o' : 'gemini-2.0-flash'}
              className={inputClass}
            />
          </div>
          <button
            onClick={saveLLM}
            className="w-full bg-accent/10 hover:bg-accent/20 text-accent border border-accent/20 rounded-lg py-2 text-sm font-medium transition-colors"
          >
            {settings.llmApiKey ? 'Update AI Config' : 'Enable AI'}
          </button>
          {settings.llmApiKey && (
            <p className="text-xs text-green-400/70 flex items-center gap-1">
              <Brain size={12} /> AI enabled ({settings.llmProvider})
            </p>
          )}
        </div>
      </section>

      {/* Spotify Import */}
      <section className="bg-surface-800 rounded-xl p-4">
        <h2 className="text-sm font-medium text-gray-300 mb-3 flex items-center gap-2">
          <Upload size={16} />
          Spotify Import
        </h2>
        <p className="text-xs text-gray-500 mb-3">
          Import your Spotify data export to match tracks on Tidal and recreate your playlists.
        </p>
        <a
          href="/import"
          className="block w-full text-center bg-green-500/10 hover:bg-green-500/20 text-green-400 border border-green-500/20 rounded-lg py-2 text-sm font-medium transition-colors"
        >
          Start Spotify Import
        </a>
      </section>

      {/* About */}
      <section className="bg-surface-800 rounded-xl p-4">
        <h2 className="text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
          <Info size={16} />
          About
        </h2>
        <p className="text-xs text-gray-500">Sauti Sounds v0.1</p>
        <p className="text-xs text-gray-600 mt-1">music is the remedy</p>
      </section>
    </div>
  )
}
