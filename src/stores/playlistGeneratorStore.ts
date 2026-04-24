import { create } from 'zustand'
import { generateMoodPlaylist } from '../lib/mixGenerator'
import { isLLMConfigured } from '../lib/llm'
import { getTidalTrack } from '../lib/tidal'
import type { Track } from '../types'
import { useLibraryStore } from './libraryStore'
import { useMixStore } from './mixStore'
import { useNotificationStore } from './notificationStore'
import { usePlaylistStore } from './playlistStore'
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
  run: (prompt: string, options?: RunPlaylistGenerationOptions) => Promise<void>
}

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
    set({
      activeRunId: null,
      currentPrompt: '',
      error: null,
      notifyOnCompletion: false,
      result: null,
      status: 'idle',
    })
  },

  run: async (prompt, options = {}) => {
    const trimmed = prompt.trim()
    if (!trimmed || get().status === 'running') return

    const runId = makeRunId()
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
