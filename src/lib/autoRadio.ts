import { isLLMConfigured } from './llm'
import { tagTrackContext } from './listenContextRegistry'
import { generateAutoRadioBatch } from './mixGenerator'
import { useLibraryStore } from '../stores/libraryStore'
import { usePlaybackSessionStore } from '../stores/playbackSessionStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useTasteStore } from '../stores/tasteStore'
import type { Track } from '../types'

const COOLDOWN_MS = 60_000
const autoAdded = new Set<string>()
let lastRunAt = 0
let inFlight = false

export function isAutoRadioTrack(trackId: string): boolean {
  return autoAdded.has(trackId)
}

export async function maybeFillAutoRadio(seedTrack: Track | null): Promise<void> {
  if (!seedTrack) return
  if (!useSettingsStore.getState().autoRadio) return
  if (!isLLMConfigured()) return
  if (inFlight) return
  if (Date.now() - lastRunAt < COOLDOWN_MS) return

  inFlight = true
  try {
    const library = useLibraryStore.getState().tracks
    const tasteProfile = useTasteStore.getState().profile
    const exclude = new Set<string>()
    for (const t of library) {
      if (t.providerTrackId) exclude.add(t.providerTrackId)
      exclude.add(t.id)
    }
    const next = await generateAutoRadioBatch(
      { library, tasteProfile, excludeLibraryIds: exclude },
      seedTrack,
      10,
    )
    if (!next.length) return
    const session = usePlaybackSessionStore.getState()
    for (const t of next) {
      autoAdded.add(t.id)
      tagTrackContext(t.id, 'auto-radio')
      session.appendTrack(t)
    }
    lastRunAt = Date.now()
  } catch (err) {
    console.error('Auto-radio failed', err)
  } finally {
    inFlight = false
  }
}
