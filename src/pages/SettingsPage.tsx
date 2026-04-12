import { useState } from 'react'
import { Brain, Eye, EyeOff, HardDrive, Info, KeyRound, LogIn, LogOut, Radio, Server, Trash2 } from 'lucide-react'
import { db } from '../db'
import type { LLMProvider } from '../lib/llm'
import { useLibraryStore } from '../stores/libraryStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useTidalStore } from '../stores/tidalStore'

export default function SettingsPage() {
  const { tracks, loadTracks } = useLibraryStore()
  const settings = useSettingsStore()
  const {
    backendAvailable,
    backendAuthenticated,
    tidalConnected,
    tidalUser,
    connecting,
    loginToBackend,
    logoutFromBackend,
    connectTidal,
    disconnectTidal,
  } = useTidalStore()
  const [backendPassword, setBackendPassword] = useState('')
  const [clearing, setClearing] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)
  const [llmProvider, setLlmProvider] = useState<LLMProvider>(settings.llmProvider)
  const [llmKey, setLlmKey] = useState(settings.llmApiKey)
  const [llmModel, setLlmModel] = useState(settings.llmModel)

  async function clearLibrary() {
    if (!window.confirm('Are you sure? This will remove all locally cached tracks and playlists from the app.')) return
    setClearing(true)
    await db.tracks.clear()
    await db.playlists.where('kind').equals('app').delete()
    await loadTracks()
    setClearing(false)
  }

  async function handleBackendLogin() {
    try {
      await loginToBackend(backendPassword)
      setBackendPassword('')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to log into backend'
      alert(message)
    }
  }

  async function handleBackendLogout() {
    await logoutFromBackend()
  }

  async function handleTidalConnect() {
    try {
      await connectTidal()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to connect TIDAL'
      alert(message)
    }
  }

  async function handleTidalDisconnect() {
    await disconnectTidal()
  }

  function saveLLM() {
    settings.setLLMConfig(llmProvider, llmKey, llmModel || undefined)
  }

  const inputClass = 'w-full bg-surface-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 outline-none focus:ring-2 focus:ring-accent/50'

  return (
    <div className="px-4 pt-6 pb-4 space-y-4">
      <h1 className="text-2xl font-bold mb-6">Settings</h1>

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
              {[...new Set(tracks.map(track => track.album))].length}
            </p>
            <p className="text-xs text-gray-400">Albums</p>
          </div>
          <div className="bg-surface-700 rounded-lg p-3">
            <p className="text-2xl font-bold text-accent">
              {[...new Set(tracks.map(track => track.artist))].length}
            </p>
            <p className="text-xs text-gray-400">Artists</p>
          </div>
        </div>
        <button
          onClick={() => void clearLibrary()}
          disabled={clearing || tracks.length === 0}
          className="mt-3 w-full flex items-center justify-center gap-2 text-red-400 hover:text-red-300 text-sm py-2 rounded-lg hover:bg-red-500/10 transition-colors disabled:opacity-30"
        >
          <Trash2 size={14} />
          Clear Cached Library
        </button>
      </section>

      <section className="bg-surface-800 rounded-xl p-4">
        <h2 className="text-sm font-medium text-gray-300 mb-3 flex items-center gap-2">
          <Server size={16} />
          Private Backend
        </h2>
        {!backendAvailable && (
          <p className="text-xs text-red-300 mb-3">
            Backend unreachable. Start it locally or deploy it to Railway before using TIDAL.
          </p>
        )}
        {!backendAuthenticated ? (
          <div className="space-y-3">
            <div>
              <label className="text-xs text-gray-400 mb-1 block">App Password</label>
              <input
                type="password"
                value={backendPassword}
                onChange={e => setBackendPassword(e.target.value)}
                placeholder="Enter the backend password"
                className={inputClass}
              />
            </div>
            <button
              onClick={() => void handleBackendLogin()}
              disabled={!backendPassword.trim() || !backendAvailable}
              className="w-full bg-accent hover:bg-accent-dark text-white rounded-lg py-2 text-sm font-medium transition-colors disabled:opacity-40 inline-flex items-center justify-center gap-2"
            >
              <LogIn size={16} />
              Log Into Backend
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-green-300">Connected to your private backend.</p>
            <button
              onClick={() => void handleBackendLogout()}
              className="w-full bg-surface-700 hover:bg-surface-600 rounded-lg py-2 text-sm font-medium transition-colors inline-flex items-center justify-center gap-2"
            >
              <LogOut size={16} />
              Log Out Of Backend
            </button>
          </div>
        )}
      </section>

      <section className="bg-surface-800 rounded-xl p-4">
        <h2 className="text-sm font-medium text-gray-300 mb-3 flex items-center gap-2">
          <Radio size={16} />
          TIDAL Account
        </h2>
        {!backendAuthenticated ? (
          <p className="text-xs text-gray-400">
            Log into your backend first. TIDAL auth is handled server-side so your access and refresh tokens never touch the browser.
          </p>
        ) : (
          <div className="space-y-3">
            {tidalConnected ? (
              <>
                <div className="rounded-lg bg-surface-700 px-3 py-3">
                  <p className="text-sm text-green-300">TIDAL connected</p>
                  {tidalUser && (
                    <p className="text-xs text-gray-400 mt-1">
                      {tidalUser.username || tidalUser.name || tidalUser.email || `User ${tidalUser.id}`}
                    </p>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => void handleTidalConnect()}
                    disabled={connecting}
                    className="bg-accent/10 hover:bg-accent/20 text-accent border border-accent/20 rounded-lg py-2 text-sm font-medium transition-colors disabled:opacity-50"
                  >
                    Reconnect
                  </button>
                  <button
                    onClick={() => void handleTidalDisconnect()}
                    className="bg-surface-700 hover:bg-surface-600 rounded-lg py-2 text-sm font-medium transition-colors"
                  >
                    Disconnect
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-xs text-gray-400">
                  Connecting opens the TIDAL verification link in a new tab, then this app polls your backend until the account is ready.
                </p>
                <button
                  onClick={() => void handleTidalConnect()}
                  disabled={connecting}
                  className="w-full bg-accent hover:bg-accent-dark text-white rounded-lg py-2 text-sm font-medium transition-colors disabled:opacity-50"
                >
                  {connecting ? 'Waiting for TIDAL login...' : 'Connect TIDAL'}
                </button>
              </>
            )}
          </div>
        )}
      </section>

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
        </div>
      </section>

      <section className="bg-surface-800 rounded-xl p-4">
        <h2 className="text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
          <Info size={16} />
          About
        </h2>
        <p className="text-xs text-gray-500">Sauti Sounds v0.2</p>
        <p className="text-xs text-gray-600 mt-1">Personal-use hybrid local + TIDAL player</p>
        <p className="text-xs text-gray-600 mt-2 flex items-center gap-1">
          <KeyRound size={12} /> Set `VITE_API_BASE_URL` in the frontend and `APP_PASSWORD` in the backend before deploying.
        </p>
      </section>
    </div>
  )
}
