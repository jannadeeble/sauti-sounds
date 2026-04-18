import { db } from '../db'
import { isLLMConfigured, tagTracks } from './llm'
import { useLibraryStore } from '../stores/libraryStore'
import { useNotificationStore } from '../stores/notificationStore'
import { useTasteStore } from '../stores/tasteStore'
import type { Track } from '../types'

const BATCH_SIZE = 20
const PROFILE_REBUILD_EVERY = 20

let running = false
let queuedRun = false

/**
 * Tag any untagged tracks in the library in 20-track batches, write tags
 * back to Dexie, and rebuild the taste profile whenever enough new tracks
 * have been tagged. Safe to call multiple times — coalesces.
 */
export async function runTagJob(): Promise<void> {
  if (!isLLMConfigured()) return
  if (running) {
    queuedRun = true
    return
  }
  running = true
  try {
    do {
      queuedRun = false
      await tagPending()
    } while (queuedRun)
  } finally {
    running = false
  }
}

async function tagPending(): Promise<void> {
  const library = useLibraryStore.getState().tracks
  const untagged = library.filter(t => !t.tags)
  if (!untagged.length) return

  const notify = useNotificationStore.getState().push
  const total = untagged.length
  let tagged = 0
  let sinceRebuild = 0
  const startedAt = Date.now()

  if (total >= BATCH_SIZE) {
    await notify({
      kind: 'info',
      title: 'Analyzing your library',
      body: `Tagging ${total} tracks in the background — this runs in ${BATCH_SIZE}-track batches and keeps going if you close the app.`,
    })
  }

  for (let i = 0; i < untagged.length; i += BATCH_SIZE) {
    const batch = untagged.slice(i, i + BATCH_SIZE)
    const tagMap = await tagTracks(batch)
    if (!tagMap.size) continue

    const updates: Track[] = []
    for (const track of batch) {
      const tags = tagMap.get(track.id)
      if (!tags) continue
      updates.push({ ...track, tags })
      tagged += 1
      sinceRebuild += 1
    }
    if (updates.length) {
      await db.tracks.bulkPut(updates)
      await useLibraryStore.getState().loadTracks()
    }

    if (sinceRebuild >= PROFILE_REBUILD_EVERY) {
      sinceRebuild = 0
      const fresh = useLibraryStore.getState().tracks
      await useTasteStore.getState().maybeAutoRebuild(fresh)
    }
  }

  if (tagged) {
    await notify({
      kind: 'success',
      title: 'Library analysis complete',
      body: `Analyzed ${tagged} of ${total} tracks in ${Math.round((Date.now() - startedAt) / 1000)}s. Suggestions will get sharper.`,
    })
    const fresh = useLibraryStore.getState().tracks
    await useTasteStore.getState().maybeAutoRebuild(fresh)
  }
}
