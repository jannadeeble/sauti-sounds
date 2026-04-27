import { db } from '../db'
import type { AppNotification, HistoryEntry, ListenEvent, Mix, PersistedPlaybackState } from '../types'
import {
  getAppStateSnapshot,
  saveAppStateSnapshot,
  type AppStateSnapshot,
  type PersistentSettingsState,
  type PersistentUiState,
} from './appStateApi'

const SETTINGS_STORAGE_KEY = 'sauti-settings'
const ACTIVE_TAB_STORAGE_KEY = 'sauti.activeTab'
const LIBRARY_FILTER_STORAGE_KEY = 'sauti.libraryFilter'
const LAST_RUN_KEY = 'sauti.homeFeed.lastRun'
const SWAP_KEY = 'sauti.mixSwap.log'
const UI_ACTIVE_TAB_VALUES = new Set(['home', 'library'])
const UI_LIBRARY_FILTER_VALUES = new Set(['tracks', 'playlists', 'artists'])

export const DEFAULT_PERSISTENT_SETTINGS: PersistentSettingsState = {
  llmProvider: 'claude',
  llmApiKey: '',
  llmModel: '',
  extendedThinking: true,
  autoRadio: true,
}

let persistentSettingsState: PersistentSettingsState = { ...DEFAULT_PERSISTENT_SETTINGS }
let persistentUiState: PersistentUiState = {}
let persistentPlaybackState: PersistedPlaybackState | null = null
let hydrated = false
let hydrationPromise: Promise<AppStateSnapshot> | null = null

function readLocalStorageString(key: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function hasSettingsData(settings: PersistentSettingsState): boolean {
  return Boolean(
    settings.llmApiKey
    || settings.llmModel
    || settings.llmProvider !== DEFAULT_PERSISTENT_SETTINGS.llmProvider
    || settings.extendedThinking !== DEFAULT_PERSISTENT_SETTINGS.extendedThinking
    || settings.autoRadio !== DEFAULT_PERSISTENT_SETTINGS.autoRadio,
  )
}

function hasUiData(ui: PersistentUiState): boolean {
  return Boolean(
    ui.activeTab
    || ui.libraryFilter
    || ui.lastHomeFeedRun
    || (ui.mixSwapLog && ui.mixSwapLog.length > 0),
  )
}

function normalizeSettings(settings?: Partial<PersistentSettingsState> | null): PersistentSettingsState {
  return {
    llmProvider: settings?.llmProvider ?? DEFAULT_PERSISTENT_SETTINGS.llmProvider,
    llmApiKey: settings?.llmApiKey ?? DEFAULT_PERSISTENT_SETTINGS.llmApiKey,
    llmModel: settings?.llmModel ?? DEFAULT_PERSISTENT_SETTINGS.llmModel,
    extendedThinking: settings?.extendedThinking ?? DEFAULT_PERSISTENT_SETTINGS.extendedThinking,
    autoRadio: settings?.autoRadio ?? DEFAULT_PERSISTENT_SETTINGS.autoRadio,
  }
}

function normalizeUi(ui?: PersistentUiState | null): PersistentUiState {
  return {
    activeTab: ui?.activeTab && UI_ACTIVE_TAB_VALUES.has(ui.activeTab) ? ui.activeTab : undefined,
    libraryFilter: ui?.libraryFilter && UI_LIBRARY_FILTER_VALUES.has(ui.libraryFilter) ? ui.libraryFilter : undefined,
    lastHomeFeedRun: typeof ui?.lastHomeFeedRun === 'number' ? ui.lastHomeFeedRun : undefined,
    mixSwapLog: Array.isArray(ui?.mixSwapLog)
      ? ui.mixSwapLog.filter((value): value is number => typeof value === 'number')
      : undefined,
  }
}

function normalizeSnapshot(snapshot?: Partial<AppStateSnapshot> | null): AppStateSnapshot {
  return {
    notifications: Array.isArray(snapshot?.notifications) ? snapshot.notifications as AppNotification[] : [],
    history: Array.isArray(snapshot?.history) ? snapshot.history as HistoryEntry[] : [],
    listenEvents: Array.isArray(snapshot?.listenEvents) ? snapshot.listenEvents as ListenEvent[] : [],
    mixes: Array.isArray(snapshot?.mixes) ? snapshot.mixes as Mix[] : [],
    tasteProfile: snapshot?.tasteProfile ?? null,
    playback: snapshot?.playback ?? null,
    settings: normalizeSettings(snapshot?.settings),
    ui: normalizeUi(snapshot?.ui),
  }
}

function backendHasData(snapshot: AppStateSnapshot): boolean {
  return Boolean(
    snapshot.notifications.length
    || snapshot.history.length
    || snapshot.listenEvents.length
    || snapshot.mixes.length
    || snapshot.tasteProfile
    || snapshot.playback
    || hasSettingsData(snapshot.settings)
    || hasUiData(snapshot.ui),
  )
}

function parseLegacySettings(): PersistentSettingsState {
  const raw = readLocalStorageString(SETTINGS_STORAGE_KEY)
  if (!raw) return { ...DEFAULT_PERSISTENT_SETTINGS }
  try {
    const parsed = JSON.parse(raw) as unknown
    let state: Partial<PersistentSettingsState> | undefined
    if (parsed && typeof parsed === 'object' && 'state' in parsed) {
      state = (parsed as { state?: Partial<PersistentSettingsState> }).state
    } else if (parsed && typeof parsed === 'object') {
      state = parsed as Partial<PersistentSettingsState>
    }
    return normalizeSettings(state ?? undefined)
  } catch {
    return { ...DEFAULT_PERSISTENT_SETTINGS }
  }
}

function parseLegacyUi(): PersistentUiState {
  const activeTab = readLocalStorageString(ACTIVE_TAB_STORAGE_KEY)
  const libraryFilter = readLocalStorageString(LIBRARY_FILTER_STORAGE_KEY)
  const rawLastRun = readLocalStorageString(LAST_RUN_KEY)
  const rawSwapLog = readLocalStorageString(SWAP_KEY)
  let mixSwapLog: number[] | undefined

  if (rawSwapLog) {
    try {
      mixSwapLog = (JSON.parse(rawSwapLog) as unknown[]).filter((value): value is number => typeof value === 'number')
    } catch {
      mixSwapLog = undefined
    }
  }

  return normalizeUi({
    activeTab: activeTab && UI_ACTIVE_TAB_VALUES.has(activeTab) ? activeTab as 'home' | 'library' : undefined,
    libraryFilter: libraryFilter && UI_LIBRARY_FILTER_VALUES.has(libraryFilter) ? libraryFilter as 'tracks' | 'playlists' | 'artists' : undefined,
    lastHomeFeedRun: rawLastRun ? Number(rawLastRun) : undefined,
    mixSwapLog,
  })
}

function clearLegacyLocalStorage(): void {
  if (typeof window === 'undefined') return
  for (const key of [SETTINGS_STORAGE_KEY, ACTIVE_TAB_STORAGE_KEY, LIBRARY_FILTER_STORAGE_KEY, LAST_RUN_KEY, SWAP_KEY]) {
    try {
      window.localStorage.removeItem(key)
    } catch {
      // ignore local cleanup failures
    }
  }
}

async function writeSnapshotToDexie(snapshot: AppStateSnapshot): Promise<void> {
  await db.transaction('rw', [db.notifications, db.history, db.listenEvents, db.mixes, db.tasteProfile], async () => {
    await db.notifications.clear()
    await db.history.clear()
    await db.listenEvents.clear()
    await db.mixes.clear()
    await db.tasteProfile.clear()

    if (snapshot.notifications.length > 0) {
      await db.notifications.bulkPut(snapshot.notifications)
    }
    if (snapshot.history.length > 0) {
      await db.history.bulkPut(snapshot.history)
    }
    if (snapshot.listenEvents.length > 0) {
      await db.listenEvents.bulkPut(snapshot.listenEvents)
    }
    if (snapshot.mixes.length > 0) {
      await db.mixes.bulkPut(snapshot.mixes)
    }
    if (snapshot.tasteProfile) {
      await db.tasteProfile.put(snapshot.tasteProfile)
    }
  })
}

async function readSnapshotFromClient(): Promise<AppStateSnapshot> {
  const [notifications, history, listenEvents, mixes, tasteProfile] = await Promise.all([
    db.notifications.orderBy('createdAt').reverse().toArray(),
    db.history.orderBy('playedAt').reverse().toArray(),
    db.listenEvents.orderBy('startedAt').reverse().toArray(),
    db.mixes.orderBy('generatedAt').reverse().toArray(),
    db.tasteProfile.get('current'),
  ])

  return {
    notifications,
    history,
    listenEvents,
    mixes,
    tasteProfile: tasteProfile ?? null,
    playback: persistentPlaybackState,
    settings: { ...persistentSettingsState },
    ui: {
      ...persistentUiState,
      mixSwapLog: persistentUiState.mixSwapLog ? [...persistentUiState.mixSwapLog] : undefined,
    },
  }
}

async function readLegacyClientSnapshot(): Promise<AppStateSnapshot> {
  const [notifications, history, listenEvents, mixes, tasteProfile] = await Promise.all([
    db.notifications.orderBy('createdAt').reverse().toArray(),
    db.history.orderBy('playedAt').reverse().toArray(),
    db.listenEvents.orderBy('startedAt').reverse().toArray(),
    db.mixes.orderBy('generatedAt').reverse().toArray(),
    db.tasteProfile.get('current'),
  ])

  return {
    notifications,
    history,
    listenEvents,
    mixes,
    tasteProfile: tasteProfile ?? null,
    playback: null,
    settings: parseLegacySettings(),
    ui: parseLegacyUi(),
  }
}

function applyInMemorySnapshot(snapshot: AppStateSnapshot): void {
  persistentSettingsState = normalizeSettings(snapshot.settings)
  persistentUiState = normalizeUi(snapshot.ui)
  persistentPlaybackState = snapshot.playback ?? null
}

async function ensureHydrated(): Promise<AppStateSnapshot> {
  if (hydrated) {
    return readSnapshotFromClient()
  }
  return hydrateAppStateFromBackend()
}

export function getPersistentSettingsState(): PersistentSettingsState {
  return { ...persistentSettingsState }
}

export function setPersistentSettingsState(settings: PersistentSettingsState): void {
  persistentSettingsState = normalizeSettings(settings)
}

export function getPersistentUiState(): PersistentUiState {
  return {
    ...persistentUiState,
    mixSwapLog: persistentUiState.mixSwapLog ? [...persistentUiState.mixSwapLog] : undefined,
  }
}

export function setPersistentUiState(patch: Partial<PersistentUiState>): void {
  persistentUiState = normalizeUi({ ...persistentUiState, ...patch })
}

export function getPersistentPlaybackState(): PersistedPlaybackState | null {
  return persistentPlaybackState
}

export function setPersistentPlaybackState(snapshot: PersistedPlaybackState | null): void {
  persistentPlaybackState = snapshot
}

export async function hydrateAppStateFromBackend(force = false): Promise<AppStateSnapshot> {
  if (hydrationPromise && !force) return hydrationPromise

  hydrationPromise = (async () => {
    const backendSnapshot = normalizeSnapshot(await getAppStateSnapshot())
    let snapshot = backendSnapshot

    if (!backendHasData(backendSnapshot)) {
      const legacySnapshot = normalizeSnapshot(await readLegacyClientSnapshot())
      if (backendHasData(legacySnapshot)) {
        snapshot = normalizeSnapshot(await saveAppStateSnapshot(legacySnapshot))
        clearLegacyLocalStorage()
      }
    }

    await writeSnapshotToDexie(snapshot)
    applyInMemorySnapshot(snapshot)
    hydrated = true
    return snapshot
  })()

  try {
    return await hydrationPromise
  } finally {
    hydrationPromise = null
  }
}

export async function pushAppStateSnapshot(): Promise<AppStateSnapshot> {
  await ensureHydrated()
  const snapshot = await readSnapshotFromClient()
  const saved = normalizeSnapshot(await saveAppStateSnapshot(snapshot))
  applyInMemorySnapshot(saved)
  clearLegacyLocalStorage()
  return saved
}

export async function resetPersistentAppStateCache(): Promise<void> {
  hydrated = false
  hydrationPromise = null
  persistentSettingsState = { ...DEFAULT_PERSISTENT_SETTINGS }
  persistentUiState = {}
  persistentPlaybackState = null
  await db.transaction('rw', [db.notifications, db.history, db.listenEvents, db.mixes, db.tasteProfile], async () => {
    await db.notifications.clear()
    await db.history.clear()
    await db.listenEvents.clear()
    await db.mixes.clear()
    await db.tasteProfile.clear()
  })
}
