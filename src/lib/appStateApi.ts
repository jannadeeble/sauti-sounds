import type {
  AppNotification,
  HistoryEntry,
  ListenEvent,
  Mix,
  PersistedPlaybackState,
  TasteProfileRecord,
} from '../types'
import type { LLMProvider } from './llm'
import { apiFetch } from './api'

export type WorkspaceTab = 'home' | 'library'
export type LibraryFilter = 'tracks' | 'playlists' | 'artists'

export interface PersistentSettingsState {
  llmProvider: LLMProvider
  llmApiKey: string
  llmModel: string
  extendedThinking: boolean
  autoRadio: boolean
}

export interface PersistentUiState {
  activeTab?: WorkspaceTab
  libraryFilter?: LibraryFilter
  lastHomeFeedRun?: number
  mixSwapLog?: number[]
}

export interface AppStateSnapshot {
  notifications: AppNotification[]
  history: HistoryEntry[]
  listenEvents: ListenEvent[]
  mixes: Mix[]
  tasteProfile: TasteProfileRecord | null
  playback: PersistedPlaybackState | null
  settings: PersistentSettingsState
  ui: PersistentUiState
}

export async function getAppStateSnapshot(): Promise<Partial<AppStateSnapshot>> {
  return apiFetch<Partial<AppStateSnapshot>>('/api/state/snapshot')
}

export async function saveAppStateSnapshot(snapshot: AppStateSnapshot): Promise<AppStateSnapshot> {
  return apiFetch<AppStateSnapshot>('/api/state/snapshot', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(snapshot),
  })
}
