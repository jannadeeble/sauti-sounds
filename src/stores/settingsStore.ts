import { create } from 'zustand'
import {
  DEFAULT_PERSISTENT_SETTINGS,
  getPersistentSettingsState,
  hydrateAppStateFromBackend,
  pushAppStateSnapshot,
  setPersistentSettingsState,
} from '../lib/appStateSync'
import { configureLLM, type LLMProvider } from '../lib/llm'

interface SettingsState {
  llmProvider: LLMProvider
  llmApiKey: string
  llmModel: string
  extendedThinking: boolean
  autoRadio: boolean
  hydrating: boolean
  hydrate: () => Promise<void>
  reset: () => void
  setLLMConfig: (provider: LLMProvider, apiKey: string, model?: string) => void
  setExtendedThinking: (on: boolean) => void
  setAutoRadio: (on: boolean) => void
  initializeServices: () => void
}

function applyConfig(provider: LLMProvider, apiKey: string, model?: string) {
  if (apiKey) {
    configureLLM(provider, apiKey, model)
  }
}

function settingsSnapshot(state: Pick<SettingsState, 'llmProvider' | 'llmApiKey' | 'llmModel' | 'extendedThinking' | 'autoRadio'>) {
  return {
    llmProvider: state.llmProvider,
    llmApiKey: state.llmApiKey,
    llmModel: state.llmModel,
    extendedThinking: state.extendedThinking,
    autoRadio: state.autoRadio,
  }
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...DEFAULT_PERSISTENT_SETTINGS,
  hydrating: false,

  hydrate: async () => {
    set({ hydrating: true })
    try {
      await hydrateAppStateFromBackend()
      const next = getPersistentSettingsState()
      set({ ...next })
      applyConfig(next.llmProvider, next.llmApiKey, next.llmModel || undefined)
    } finally {
      set({ hydrating: false })
    }
  },

  reset: () => {
    set({ ...DEFAULT_PERSISTENT_SETTINGS, hydrating: false })
    setPersistentSettingsState(DEFAULT_PERSISTENT_SETTINGS)
  },

  setLLMConfig: (provider, apiKey, model) => {
    const next = {
      ...get(),
      llmProvider: provider,
      llmApiKey: apiKey,
      llmModel: model || '',
    }
    set({
      llmProvider: provider,
      llmApiKey: apiKey,
      llmModel: model || '',
    })
    setPersistentSettingsState(settingsSnapshot(next))
    applyConfig(provider, apiKey, model)
    void pushAppStateSnapshot()
  },

  setExtendedThinking: (on) => {
    set({ extendedThinking: on })
    setPersistentSettingsState(settingsSnapshot({ ...get(), extendedThinking: on }))
    void pushAppStateSnapshot()
  },

  setAutoRadio: (on) => {
    set({ autoRadio: on })
    setPersistentSettingsState(settingsSnapshot({ ...get(), autoRadio: on }))
    void pushAppStateSnapshot()
  },

  initializeServices: () => {
    const state = get()
    applyConfig(state.llmProvider, state.llmApiKey, state.llmModel || undefined)
  },
}))
