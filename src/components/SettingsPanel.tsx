import { type MouseEvent, useEffect, useMemo, useState } from 'react'
import { Bell, Brain, Download, Eye, EyeOff, HardDrive, Info, KeyRound, LogOut, Radio, RefreshCw, Server, Trash2, Upload } from 'lucide-react'
import AIStatsPanel from './AIStatsPanel'
import NotificationBell from './NotificationBell'
import { clearPersistedLibrary } from '../lib/librarySync'
import { listOpenRouterModels, type LLMProvider, type OpenRouterModel } from '../lib/llm'
import { promptPwaInstall, subscribePwaInstall } from '../lib/pwaInstall'
import { runTagJob } from '../lib/tagJob'
import { useAuthStore } from '../stores/authStore'
import { useLibraryStore } from '../stores/libraryStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useTasteStore } from '../stores/tasteStore'
import { useTidalStore } from '../stores/tidalStore'

interface SettingsPanelProps {
  onOpenUpload: (event: MouseEvent<HTMLButtonElement>) => void
}

export default function SettingsPanel({ onOpenUpload }: SettingsPanelProps) {
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

  const tasteProfile = useTasteStore((s) => s.profile)
  const tasteBuiltAt = useTasteStore((s) => s.builtAt)
  const tasteBuiltFromCount = useTasteStore((s) => s.builtFromTrackCount)
  const tasteRebuilding = useTasteStore((s) => s.rebuilding)
  const rebuildTaste = useTasteStore((s) => s.rebuild)

  const [clearing, setClearing] = useState(false)
  const [reanalyzing, setReanalyzing] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)
  const [llmProvider, setLlmProvider] = useState<LLMProvider>(settings.llmProvider)
  const [llmKey, setLlmKey] = useState(settings.llmApiKey)
  const [llmModel, setLlmModel] = useState(settings.llmModel)
  const [savedFlash, setSavedFlash] = useState(false)
  const [installPromptAvailable, setInstallPromptAvailable] = useState(false)
  const [appInstalled, setAppInstalled] = useState(false)

  const [openRouterModels, setOpenRouterModels] = useState<OpenRouterModel[]>([])
  const [openRouterLoading, setOpenRouterLoading] = useState(false)
  const [openRouterError, setOpenRouterError] = useState<string | null>(null)

  // Lazy-load the OpenRouter catalog the first time the user selects that
  // provider. The helper caches across mounts so re-opening Settings is free.
  useEffect(() => {
    if (llmProvider !== 'openrouter') return
    if (openRouterModels.length > 0 || openRouterLoading) return
    setOpenRouterLoading(true)
    setOpenRouterError(null)
    listOpenRouterModels()
      .then((models) => setOpenRouterModels(models))
      .catch((err) => setOpenRouterError(err instanceof Error ? err.message : 'Failed to load models'))
      .finally(() => setOpenRouterLoading(false))
  }, [llmProvider, openRouterModels.length, openRouterLoading])

  useEffect(() => {
    return subscribePwaInstall((state) => {
      setInstallPromptAvailable(state.promptAvailable)
      setAppInstalled(state.installed)
    })
  }, [])

  // Group models by provider prefix (e.g. "anthropic/claude-…" → "anthropic")
  // so the dropdown reads like a menu instead of a 300-row flat list.
  const openRouterModelsByProvider = useMemo(() => {
    const groups = new Map<string, OpenRouterModel[]>()
    for (const model of openRouterModels) {
      const prefix = model.id.split('/')[0] || 'other'
      const list = groups.get(prefix) ?? []
      list.push(model)
      groups.set(prefix, list)
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [openRouterModels])

  const inputClass =
    'w-full rounded-2xl border border-black/8 bg-[#f8f8f9] px-3 py-3 text-sm text-[#111116] outline-none placeholder:text-[#9ea0aa] focus:ring-2 focus:ring-accent/20'

  async function clearLibrary() {
    if (!window.confirm('Remove your synced library tracks and app playlists from this account?')) return

    setClearing(true)
    await clearPersistedLibrary()
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

  function saveLLMConfig(
    providerOverride?: LLMProvider,
    keyOverride?: string,
    modelOverride?: string,
  ) {
    const p = providerOverride ?? llmProvider
    const k = keyOverride ?? llmKey
    const m = modelOverride ?? llmModel
    settings.setLLMConfig(p, k, m || undefined)
    setSavedFlash(true)
    window.setTimeout(() => setSavedFlash(false), 1800)
  }

  async function handleLogout() {
    try {
      await logout()
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to sign out')
    }
  }

  async function handleInstallApp() {
    await promptPwaInstall()
  }

  async function handleReanalyze() {
    if (reanalyzing || tasteRebuilding) return
    setReanalyzing(true)
    try {
      await runTagJob()
      const fresh = useLibraryStore.getState().tracks
      await rebuildTaste(fresh)
    } finally {
      setReanalyzing(false)
    }
  }

  const taggedCount = useMemo(() => tracks.filter((t) => !!t.tags).length, [tracks])

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
          onClick={onOpenUpload}
          className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-black/8 bg-[#f8f8f9] px-4 py-3 text-sm font-medium text-[#111116] transition-colors hover:bg-[#f1f1f4]"
        >
          <Upload size={16} />
          Upload music
        </button>

        <button
          type="button"
          onClick={() => void clearLibrary()}
          disabled={clearing || tracks.length === 0}
          className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300 transition-colors hover:bg-red-500/15 disabled:opacity-40"
        >
          <Trash2 size={16} />
          Clear synced library
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
          <Download size={16} />
          Install app
        </h3>
        <div className="rounded-2xl bg-[#f8f8f9] px-4 py-4">
          <p className="text-sm font-medium text-[#111116]">
            {appInstalled ? 'Installed on this device' : installPromptAvailable ? 'Install Sauti on this device' : 'Install available from the browser'}
          </p>
          <p className="mt-1 text-xs text-[#7a7b86]">
            {appInstalled ? 'Sauti opens in its own app window.' : 'Keeps the player available from your home screen.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleInstallApp()}
          disabled={!installPromptAvailable || appInstalled}
          className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-black/8 bg-[#f8f8f9] px-4 py-3 text-sm font-medium text-[#111116] transition-colors hover:bg-[#f1f1f4] disabled:opacity-40"
        >
          <Download size={16} />
          {appInstalled ? 'Installed' : 'Install Sauti'}
        </button>
      </section>

      <section className="rounded-[24px] border border-black/8 bg-white p-4 sm:hidden">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 text-sm font-medium text-[#686973]">
              <Bell size={16} />
              Notifications
            </h3>
            <p className="mt-1 text-xs text-[#7a7b86]">Review recent app updates and import messages.</p>
          </div>
          <NotificationBell buttonClassName="relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-black/8 bg-[#f8f8f9] text-[#555661] transition-colors hover:bg-[#f1f1f4] hover:text-[#111116]" />
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
            onChange={(event) => {
              const next = event.target.value as LLMProvider
              setLlmProvider(next)
              saveLLMConfig(next, undefined, undefined)
            }}
            className={inputClass}
          >
            <option value="claude">Claude (Anthropic)</option>
            <option value="openai">GPT (OpenAI)</option>
            <option value="gemini">Gemini (Google)</option>
            <option value="openrouter">OpenRouter (any model)</option>
          </select>

          <div className="relative">
            <input
              type={showApiKey ? 'text' : 'password'}
              value={llmKey}
              onChange={(event) => setLlmKey(event.target.value)}
              onBlur={(event) => {
                if (event.target.value !== settings.llmApiKey) {
                  saveLLMConfig(undefined, event.target.value, undefined)
                }
              }}
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

          {llmProvider === 'openrouter' ? (
            <div className="space-y-2">
              <select
                value={llmModel}
                onChange={(event) => {
                  const next = event.target.value
                  setLlmModel(next)
                  if (next) saveLLMConfig(undefined, undefined, next)
                }}
                disabled={openRouterLoading || openRouterModels.length === 0}
                className={inputClass}
              >
                <option value="">
                  {openRouterLoading
                    ? 'Loading models…'
                    : openRouterError
                      ? 'Failed to load — enter a model slug below'
                      : `Pick a model (${openRouterModels.length} available)`}
                </option>
                {openRouterModelsByProvider.map(([provider, models]) => (
                  <optgroup key={provider} label={provider}>
                    {models.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              {openRouterError ? (
                <input
                  type="text"
                  value={llmModel}
                  onChange={(event) => setLlmModel(event.target.value)}
                  onBlur={(event) => {
                    if (event.target.value !== settings.llmModel) {
                      saveLLMConfig(undefined, undefined, event.target.value)
                    }
                  }}
                  placeholder="anthropic/claude-3.5-sonnet"
                  className={inputClass}
                />
              ) : null}
            </div>
          ) : (
            <input
              type="text"
              value={llmModel}
              onChange={(event) => setLlmModel(event.target.value)}
              onBlur={(event) => {
                if (event.target.value !== settings.llmModel) {
                  saveLLMConfig(undefined, undefined, event.target.value)
                }
              }}
              placeholder={
                llmProvider === 'claude'
                  ? 'claude-sonnet-4-6 (default)'
                  : llmProvider === 'openai'
                    ? 'gpt-4o'
                    : 'gemini-2.0-flash'
              }
              className={inputClass}
            />
          )}

          <button
            type="button"
            onClick={() => saveLLMConfig()}
            className={`inline-flex w-full items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm font-medium transition-colors ${
              savedFlash
                ? 'border-green-500/20 bg-green-500/10 text-green-700'
                : 'border-accent/20 bg-accent/10 text-accent hover:bg-accent/15'
            }`}
          >
            {savedFlash ? 'Saved ✓' : settings.llmApiKey ? 'Update AI config' : 'Save AI config'}
          </button>

          <label className="flex items-start justify-between gap-3 rounded-2xl bg-[#f8f8f9] px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-[#111116]">Extended thinking</p>
              <p className="mt-0.5 text-xs text-[#7a7b86]">Let Sauti reason longer on suggestions. Costs more tokens; better picks.</p>
            </div>
            <input
              type="checkbox"
              checked={settings.extendedThinking}
              onChange={(e) => settings.setExtendedThinking(e.target.checked)}
              className="mt-1 h-4 w-4 accent-[#ef5466]"
            />
          </label>

          <label className="flex items-start justify-between gap-3 rounded-2xl bg-[#f8f8f9] px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-[#111116]">Auto-radio</p>
              <p className="mt-0.5 text-xs text-[#7a7b86]">When the queue runs dry, Sauti keeps playing with tracks that fit.</p>
            </div>
            <input
              type="checkbox"
              checked={settings.autoRadio}
              onChange={(e) => settings.setAutoRadio(e.target.checked)}
              className="mt-1 h-4 w-4 accent-[#ef5466]"
            />
          </label>

          <div className="rounded-2xl bg-[#f8f8f9] px-4 py-3">
            <p className="text-sm font-medium text-[#111116]">Library analysis</p>
            <p className="mt-0.5 text-xs text-[#7a7b86]">
              {taggedCount} of {tracks.length} tracks analyzed
              {tasteProfile && tasteBuiltAt
                ? ` · taste profile built from ${tasteBuiltFromCount ?? 0} tracks`
                : ' · no taste profile yet'}
            </p>
            <button
              type="button"
              onClick={() => void handleReanalyze()}
              disabled={reanalyzing || tasteRebuilding || !settings.llmApiKey}
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-black/8 bg-white px-4 py-3 text-sm font-medium text-[#111116] transition-colors hover:bg-[#f1f1f4] disabled:opacity-50"
            >
              <RefreshCw size={14} className={reanalyzing || tasteRebuilding ? 'animate-spin' : ''} />
              {reanalyzing || tasteRebuilding ? 'Analyzing…' : 'Re-analyze library'}
            </button>
          </div>
        </div>
      </section>

      {import.meta.env.DEV ? <AIStatsPanel /> : null}

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
