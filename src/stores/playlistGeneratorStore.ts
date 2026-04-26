import { create } from 'zustand'
import { createPlaylistGeneration, getPlaylistGenerationStatus, type GenerationPhase } from '../lib/generationApi'
import { isLLMConfigured } from '../lib/llm'
import { useLibraryStore } from './libraryStore'
import { useMixStore } from './mixStore'
import { useNotificationStore } from './notificationStore'
import { usePlaylistStore } from './playlistStore'
import { useSettingsStore } from './settingsStore'
import { useTasteStore } from './tasteStore'

interface GeneratedPlaylistResult {
  blurb?: string
  id: string
  mixId?: string
  name: string
  prompt: string
  trackCount: number
}

interface RunPlaylistGenerationOptions {
  count?: number
  titleOverride?: string
  useTaste?: boolean
}

interface PendingPlaylistGeneration {
  options: RunPlaylistGenerationOptions
  prompt: string
  runId: string
  startedAt: number
}

interface PlaylistGeneratorState {
  activeRunId: string | null
  currentPrompt: string
  error: string | null
  phase: GenerationPhase | null
  notifyOnCompletion: boolean
  result: GeneratedPlaylistResult | null
  status: 'idle' | 'running' | 'success' | 'error'
  clearCompletionNotification: () => void
  requestCompletionNotification: () => void
  reset: () => void
  resumePending: () => Promise<void>
  run: (prompt: string, options?: RunPlaylistGenerationOptions) => Promise<void>
}

const PENDING_GENERATION_KEY = 'sauti.playlistGenerator.pending'
const PENDING_MAX_AGE_MS = 6 * 60 * 60 * 1000
let resumePendingPromise: Promise<void> | null = null

function makeRunId() {
  return `playlist-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function readPendingGeneration(): PendingPlaylistGeneration | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(PENDING_GENERATION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PendingPlaylistGeneration>
    if (!parsed.prompt || !parsed.runId || typeof parsed.startedAt !== 'number') return null
    if (Date.now() - parsed.startedAt > PENDING_MAX_AGE_MS) {
      window.localStorage.removeItem(PENDING_GENERATION_KEY)
      return null
    }
    return {
      options: parsed.options ?? {},
      prompt: parsed.prompt,
      runId: parsed.runId,
      startedAt: parsed.startedAt,
    }
  } catch {
    return null
  }
}

function writePendingGeneration(pending: PendingPlaylistGeneration): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(PENDING_GENERATION_KEY, JSON.stringify(pending))
  } catch {
    // Generation can still run without local resume support.
  }
}

function clearPendingGeneration(runId?: string): void {
  if (typeof window === 'undefined') return
  try {
    if (runId) {
      const pending = readPendingGeneration()
      if (pending && pending.runId !== runId) return
    }
    window.localStorage.removeItem(PENDING_GENERATION_KEY)
  } catch {
    // Ignore local cleanup failures.
  }
}

export const usePlaylistGeneratorStore = create<PlaylistGeneratorState>((set, get) => ({
  activeRunId: null,
  currentPrompt: '',
  error: null,
  phase: null,
  notifyOnCompletion: false,
  result: null,
  status: 'idle',

  requestCompletionNotification: () => {
    if (get().status !== 'running') return
    set({ notifyOnCompletion: true })
  },

  clearCompletionNotification: () => set({ notifyOnCompletion: false }),

  reset: () => {
    if (get().status === 'running') return
    clearPendingGeneration()
    set({
      activeRunId: null,
      currentPrompt: '',
      error: null,
      phase: null,
      notifyOnCompletion: false,
      result: null,
      status: 'idle',
    })
  },

  resumePending: async () => {
    if (get().status === 'running') return
    if (resumePendingPromise) return resumePendingPromise
    const pending = readPendingGeneration()
    if (!pending) return

    resumePendingPromise = (async () => {
      await useSettingsStore.getState().hydrate()
      await Promise.all([
        useLibraryStore.getState().loadTracks(),
        usePlaylistStore.getState().loadPlaylists(),
        useTasteStore.getState().load(),
      ])

      const existing = usePlaylistStore.getState().appPlaylists.find((playlist) =>
        playlist.origin === 'generated'
        && playlist.generatedPrompt === pending.prompt
        && (playlist.trackCount ?? playlist.items.length) > 0
        && playlist.createdAt >= pending.startedAt - 60_000,
      )

      if (existing) {
        clearPendingGeneration(pending.runId)
        set({
          activeRunId: null,
          currentPrompt: pending.prompt,
          error: null,
          phase: null,
          notifyOnCompletion: false,
          result: {
            blurb: existing.description,
            id: existing.id,
            name: existing.name,
            prompt: pending.prompt,
            trackCount: existing.trackCount ?? existing.items.length,
          },
          status: 'success',
        })
        return
      }

      set({
        activeRunId: pending.runId,
        currentPrompt: pending.prompt,
        error: null,
        phase: 'recommendations',
        notifyOnCompletion: true,
        result: null,
        status: 'running',
      })
      await pollGeneration(pending.runId, pending.prompt)
    })()

    try {
      await resumePendingPromise
    } finally {
      resumePendingPromise = null
    }
  },

  run: async (prompt, options = {}) => {
    const trimmed = prompt.trim()
    if (!trimmed || get().status === 'running') return

    const localRunId = makeRunId()
    let activeRunId = localRunId
    writePendingGeneration({
      options,
      prompt: trimmed,
      runId: localRunId,
      startedAt: Date.now(),
    })
    set({
      activeRunId: localRunId,
      currentPrompt: trimmed,
      error: null,
      phase: 'recommendations',
      notifyOnCompletion: true,
      result: null,
      status: 'running',
    })

    try {
      if (!isLLMConfigured()) {
        throw new Error('Configure an AI provider in Settings before generating playlists.')
      }

      const created = await createPlaylistGeneration({
        count: options.count ?? 15,
        prompt: trimmed,
        source: 'playlist-generator',
        titleOverride: options.titleOverride,
        useTaste: Boolean(options.useTaste && useTasteStore.getState().profile),
      })
      writePendingGeneration({
        options,
        prompt: trimmed,
        runId: created.runId,
        startedAt: Date.now(),
      })
      if (get().activeRunId !== localRunId) return
      activeRunId = created.runId
      set({ activeRunId: created.runId, phase: created.phase })
      await pollGeneration(created.runId, trimmed)
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Sauti hit an unexpected problem while building the playlist.'

      const shouldNotify = get().notifyOnCompletion
      if (get().activeRunId !== activeRunId) return
      const pendingRunId = get().activeRunId || activeRunId
      clearPendingGeneration(pendingRunId)

      set({
        activeRunId: null,
        error: message,
        phase: null,
        notifyOnCompletion: false,
        result: null,
        status: 'error',
      })

      if (shouldNotify) {
        await useNotificationStore.getState().push({
          kind: 'error',
          title: 'Playlist generation failed',
          body: message,
        })
      }
    }
  },
}))

async function hydrateGeneratedState(): Promise<void> {
  await Promise.all([
    useLibraryStore.getState().loadTracks(),
    usePlaylistStore.getState().loadPlaylists(),
    useMixStore.getState().load(),
    useTasteStore.getState().load(),
  ])
}

async function pollGeneration(runId: string, prompt: string): Promise<void> {
  while (true) {
    const status = await getPlaylistGenerationStatus(runId)
    if (usePlaylistGeneratorStore.getState().activeRunId !== runId) return
    if (status.status === 'queued' || status.status === 'running') {
      usePlaylistGeneratorStore.setState({ phase: status.phase, status: 'running' })
      await wait(1500)
      continue
    }

    if (status.status === 'failed') {
      throw new Error(status.errorMessage || 'Playlist generation failed.')
    }

    await hydrateGeneratedState()
    const result = status.result
    if (!result) {
      throw new Error('Playlist generation succeeded, but the result payload was empty.')
    }
    const shouldNotify = usePlaylistGeneratorStore.getState().notifyOnCompletion
    clearPendingGeneration(runId)
    usePlaylistGeneratorStore.setState({
      activeRunId: null,
      currentPrompt: prompt,
      error: null,
      phase: null,
      notifyOnCompletion: false,
      result: {
        blurb: result.blurb,
        id: result.playlistId,
        mixId: result.mixId,
        name: result.name,
        prompt,
        trackCount: result.trackCount,
      },
      status: 'success',
    })
    if (shouldNotify) {
      await useNotificationStore.getState().push({
        kind: 'success',
        title: `"${result.name}" is ready`,
        body: `Generated ${result.trackCount} tracks. Find it in Playlists under generated.`,
      })
    }
    return
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}
