import { createGeneration, getGenerationStatus, type GenerationCreateRequest, type GenerationResult, type GenerationStatusResponse } from './generationApi'
import { isLLMConfigured } from './llm'
import { useLibraryStore } from '../stores/libraryStore'
import { useMixStore } from '../stores/mixStore'
import { usePlaylistStore } from '../stores/playlistStore'
import { useTasteStore } from '../stores/tasteStore'

interface RunGenerationOptions {
  onStatus?: (status: GenerationStatusResponse) => void
  pollMs?: number
}

export async function runBackendGeneration(
  payload: GenerationCreateRequest,
  options: RunGenerationOptions = {},
): Promise<GenerationResult> {
  if (!isLLMConfigured()) {
    throw new Error('Configure an AI provider in Settings before generating recommendations.')
  }

  const created = await createGeneration(payload)
  const runId = created.runId
  options.onStatus?.({ ...created, kind: payload.kind })

  while (true) {
    const status = await getGenerationStatus(runId)
    options.onStatus?.(status)

    if (status.status === 'queued' || status.status === 'running') {
      await wait(options.pollMs ?? 1500)
      continue
    }

    if (status.status === 'failed') {
      throw new Error(status.errorMessage || `${status.kind} generation failed.`)
    }

    if (!status.result) {
      throw new Error(`${status.kind} generation succeeded, but the result payload was empty.`)
    }

    await hydrateGeneratedState()
    return status.result
  }
}

export async function hydrateGeneratedState(): Promise<void> {
  await Promise.all([
    useLibraryStore.getState().loadTracks(),
    usePlaylistStore.getState().loadPlaylists(),
    useMixStore.getState().load(),
    useTasteStore.getState().load(),
  ])
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}
