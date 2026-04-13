import { useState } from 'react'
import { Brain, Eye, EyeOff, HardDrive, Info, KeyRound, LogOut, Radio, Server, Trash2 } from 'lucide-react'
import { db } from '../db'
import type { LLMProvider } from '../lib/llm'
import { useAuthStore } from '../stores/authStore'
import { useLibraryStore } from '../stores/libraryStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useTidalStore } from '../stores/tidalStore'

export default function SettingsPanel() {
  const { tracks, loadTracks } = useLibraryStore()
  const settings = useSettingsStore()
  const authAvailable = useAuthStore((state) => state.available)
  const currentUser = useAuthStore((state) => state.user)
  const authSubmitting = useAuthStore((state) => state.submitting)
  const logout = useAuthStore((state) => state.logout)
  const {
    backendAvailable,
    tidalConnected,
    tidalUser,
    connecting,
    connectTidal,
    disconnectTidal,
  } = useTidalStore()

  const [clearing, setClearing] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)
  const [llmProvider, setLlmProvider] = useState<LLMProvider>(settings.llmProvider)
  const [llmKey, setLlmKey] = useState(settings.llmApiKey)
  const [llmModel, setLlmModel] = useState(settings.llmModel)

  const inputClass =
    'w-full rounded-2xl border border-black/8 bg-[#f8f8f9] px-3 py-3 text-sm text-[#111116] outline-none placeholder:text-[#9ea0aa] focus:ring-2 focus:ring-accent/20'

  async function clearLibrary() {
    if (!window.confirm('Remove all cached local tracks and app playlists from this prototype?')) return

    setClearing(true)
    await db.tracks.clear()
    await db.playlists.where('kind').equals('app').delete()
    await loadTracks()
    setClearing(false)
  }

  async function handleTidalConnect() {
    try {
      await connectTidal()
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to connect TIDAL')
    }
  }

  function saveLLMConfig() {
    settings.setLLMConfig(llmProvider, llmKey, llmModel || undefined)
  }

  async function handleLogout() {
    try {
      await logout()
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to sign out')
    }
  }

  return (
    <div className="space-y-4 pb-6">
      <section className="rounded-[24px] border border-black/8 bg-white p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-[#686973]">
          <HardDrive size={16} />
          Library
        </h3>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="rounded-2xl bg-[#f8f8f9] p-3">
            <p className="text-2xl font-semibold text-accent">{tracks.length}</p>
            <p className="text-xs text-[#7a7b86]">Tracks</p>
          </div>
          <div className="rounded-2xl bg-[#f8f8f9] p-3">
            <p className="text-2xl font-semibold text-accent">{new Set(tracks.map((track) => track.album)).size}</p>
            <p className="text-xs text-[#7a7b86]">Albums</p>
          </div>
          <div className="rounded-2xl bg-[#f8f8f9] p-3">
            <p className="text-2xl font-semibold text-accent">{new Set(tracks.map((track) => track.artist)).size}</p>
            <p className="text-xs text-[#7a7b86]">Artists</p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => void clearLibrary()}
          disabled={clearing || tracks.length === 0}
          className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300 transition-colors hover:bg-red-500/15 disabled:opacity-40"
        >
          <Trash2 size={16} />
          Clear cached library
        </button>
      </section>

      <section className="rounded-[24px] border border-black/8 bg-white p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-[#686973]">
          <Server size={16} />
          Account
        </h3>
        {!authAvailable ? (
          <p className="mb-3 text-xs text-red-300">
            Backend unreachable. Authentication cannot refresh until the service is back online.
          </p>
        ) : null}

        <div className="space-y-3">
          <div className="rounded-2xl bg-[#f8f8f9] px-4 py-4">
            <p className="text-sm font-medium text-[#111116]">{currentUser?.name || 'Signed in user'}</p>
            <p className="mt-1 text-xs text-[#7a7b86]">{currentUser?.email}</p>
          </div>
          <button
            type="button"
            onClick={() => void handleLogout()}
            disabled={authSubmitting}
            className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-black/8 bg-[#f8f8f9] px-4 py-3 text-sm font-medium text-[#111116] transition-colors hover:bg-[#f1f1f4] disabled:opacity-40"
          >
            <LogOut size={16} />
            Sign out
          </button>
        </div>
      </section>

      <section className="rounded-[24px] border border-black/8 bg-white p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-[#686973]">
          <Radio size={16} />
          TIDAL account
        </h3>

        {!backendAvailable ? (
          <p className="text-xs text-[#7a7b86]">
            The backend is offline right now, so the shared TIDAL connection cannot be checked.
          </p>
        ) : tidalConnected ? (
          <div className="space-y-3">
            <div className="rounded-2xl bg-[#f4fbf4] px-4 py-3">
              <p className="text-sm text-green-700">TIDAL connected</p>
              {tidalUser ? (
                <p className="mt-1 text-xs text-[#7a7b86]">
                  {tidalUser.username || tidalUser.name || tidalUser.email || `User ${tidalUser.id}`}
                </p>
              ) : null}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => void handleTidalConnect()}
                disabled={connecting}
                className="rounded-2xl border border-accent/20 bg-accent/10 px-4 py-3 text-sm font-medium text-accent transition-colors hover:bg-accent/15 disabled:opacity-50"
              >
                Reconnect
              </button>
              <button
                type="button"
                onClick={() => void disconnectTidal()}
                className="rounded-2xl border border-black/8 bg-[#f8f8f9] px-4 py-3 text-sm font-medium text-[#111116] transition-colors hover:bg-[#f1f1f4]"
              >
                Disconnect
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-[#7a7b86]">
              Connecting opens the TIDAL verification link in a new tab and keeps the shared backend session server-side for signed-in users.
            </p>
            <button
              type="button"
              onClick={() => void handleTidalConnect()}
              disabled={connecting || !backendAvailable}
              className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-accent px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-accent-dark disabled:opacity-50"
            >
              {connecting ? 'Waiting for TIDAL login…' : 'Connect TIDAL'}
            </button>
          </div>
        )}
      </section>

      <section className="rounded-[24px] border border-black/8 bg-white p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-[#686973]">
          <Brain size={16} />
          AI recommendations
        </h3>
        <div className="space-y-3">
          <select
            value={llmProvider}
            onChange={(event) => setLlmProvider(event.target.value as LLMProvider)}
            className={inputClass}
          >
            <option value="claude">Claude (Anthropic)</option>
            <option value="openai">GPT (OpenAI)</option>
            <option value="gemini">Gemini (Google)</option>
          </select>

          <div className="relative">
            <input
              type={showApiKey ? 'text' : 'password'}
              value={llmKey}
              onChange={(event) => setLlmKey(event.target.value)}
              placeholder="API key"
              className={`${inputClass} pr-11`}
            />
            <button
              type="button"
              onClick={() => setShowApiKey((current) => !current)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8c8d96] transition-colors hover:text-[#111116]"
            >
              {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          <input
            type="text"
            value={llmModel}
            onChange={(event) => setLlmModel(event.target.value)}
            placeholder={llmProvider === 'claude' ? 'claude-sonnet-4-20250514' : llmProvider === 'openai' ? 'gpt-4o' : 'gemini-2.0-flash'}
            className={inputClass}
          />

          <button
            type="button"
            onClick={saveLLMConfig}
            className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-accent/20 bg-accent/10 px-4 py-3 text-sm font-medium text-accent transition-colors hover:bg-accent/15"
          >
            {settings.llmApiKey ? 'Update AI config' : 'Enable AI'}
          </button>
        </div>
      </section>

      <section className="rounded-[24px] border border-black/8 bg-white p-4">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-medium text-[#686973]">
          <Info size={16} />
          About
        </h3>
        <p className="text-xs text-[#686973]">Sauti Sounds v0.2 prototype</p>
        <p className="mt-1 text-xs text-[#8c8d96]">Single-workspace hybrid local + TIDAL player</p>
        <p className="mt-2 flex items-center gap-1 text-xs text-[#8c8d96]">
          <KeyRound size={12} />
          Set `VITE_API_BASE_URL`, `AUTH_INVITE_CODE`, and the session secrets before deploying.
        </p>
      </section>
    </div>
  )
}
