import { create } from 'zustand'
import { generateMoodPlaylist } from '../lib/mixGenerator'
import { isLLMConfigured } from '../lib/llm'
import { getTidalTrack } from '../lib/tidal'
import type { Track } from '../types'
import { useLibraryStore } from './libraryStore'
import { useMixStore } from './mixStore'
import { useNotificationStore } from './notificationStore'
import { usePlaylistStore } from './playlistStore'
import { useSettingsStore } from './settingsStore'
import { useTasteStore } from './tasteStore'

interface GeneratedPlaylistResult {
  blurb?: string
  id: string
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

async function materializeMixTracks(mixTrackIds: string[]): Promise<Track[]> {
  const libraryTracks = useLibraryStore.getState().tracks
  const cacheTidalTracks = useLibraryStore.getState().cacheTidalTracks
  const byId = new Map(libraryTracks.map((track) => [track.id, track]))
  const missingIds = mixTrackIds.filter((id) => !byId.has(id))

  if (missingIds.length > 0) {
    const fetched = await Promise.allSettled(
      missingIds.map((id) => getTidalTrack(id.replace(/^tidal-/, ''))),
    )
    const resolved = fetched
      .filter((result): result is PromiseFulfilledResult<Track> => result.status === 'fulfilled')
      .map((result) => result.value)
    const rejectedCount = fetched.length - resolved.length

    if (resolved.length === 0 && rejectedCount > 0) {
      throw new Error('The playlist generated, but TIDAL track lookup failed. Check the backend/TIDAL connection and try again.')
    }

    if (resolved.length > 0) {
      await cacheTidalTracks(resolved)
      for (const track of resolved) {
        byId.set(track.id, track)
      }
    }
  }

  return mixTrackIds.map((id) => byId.get(id)).filter((track): track is Track => !!track)
}

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

      const promise = get().run(pending.prompt, pending.options)
      set({ notifyOnCompletion: true })
      await promise
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

    const runId = makeRunId()
    writePendingGeneration({
      options,
      prompt: trimmed,
      runId,
      startedAt: Date.now(),
    })
    set({
      activeRunId: runId,
      currentPrompt: trimmed,
      error: null,
      notifyOnCompletion: false,
      result: null,
      status: 'running',
    })

    try {
      if (!isLLMConfigured()) {
        throw new Error('Configure an AI provider in Settings before generating playlists.')
      }

      const library = useLibraryStore.getState().tracks
      const cacheResolvedTracks = useLibraryStore.getState().cacheTidalTracks
      const tasteProfile = useTasteStore.getState().profile
      const mix = await generateMoodPlaylist(
        {
          library,
          tasteProfile: options.useTaste ? tasteProfile ?? null : null,
          cacheResolvedTracks,
        },
        trimmed,
        { count: options.count },
      )

      if (!mix) {
        throw new Error('Sauti generated recommendations, but none could be matched to playable tracks. Try a different prompt, or check TIDAL if this keeps happening.')
      }

      await useMixStore.getState().upsert(mix)

      const resolvedTracks = await materializeMixTracks(mix.trackIds)
      if (!resolvedTracks.length) {
        throw new Error('The playlist generated, but no tracks could be loaded.')
      }

      const playlistName = options.titleOverride?.trim() || mix.title
      const playlist = await usePlaylistStore.getState().createAppPlaylist(playlistName, mix.blurb, {
        generatedFromMixId: mix.id,
        generatedPrompt: trimmed,
        origin: 'generated',
      })
      await usePlaylistStore.getState().appendTracksToAppPlaylist(playlist.id, resolvedTracks)
      await useMixStore.getState().markSaved(mix.id)

      const result: GeneratedPlaylistResult = {
        blurb: mix.blurb,
        id: playlist.id,
        name: playlist.name,
        prompt: trimmed,
        trackCount: resolvedTracks.length,
      }

      const shouldNotify = get().notifyOnCompletion
      if (get().activeRunId !== runId) return
      clearPendingGeneration(runId)

      set({
        activeRunId: null,
        error: null,
        notifyOnCompletion: false,
        result,
        status: 'success',
      })

      if (shouldNotify) {
        await useNotificationStore.getState().push({
          kind: 'success',
          title: `"${playlist.name}" is ready`,
          body: `Generated ${resolvedTracks.length} tracks. Find it in Playlists under generated.`,
        })
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Sauti hit an unexpected problem while building the playlist.'

      const shouldNotify = get().notifyOnCompletion
      if (get().activeRunId !== runId) return
      clearPendingGeneration(runId)

      set({
        activeRunId: null,
        error: message,
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
