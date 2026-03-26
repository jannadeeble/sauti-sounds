import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { configureTidal } from '../lib/tidal'
import { configureLLM, type LLMProvider } from '../lib/llm'

interface SettingsState {
  // Tidal
  tidalClientId: string
  tidalClientSecret: string

  // LLM
  llmProvider: LLMProvider
  llmApiKey: string
  llmModel: string

  // Actions
  setTidalCredentials: (clientId: string, clientSecret: string) => void
  setLLMConfig: (provider: LLMProvider, apiKey: string, model?: string) => void
  initializeServices: () => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      tidalClientId: '',
      tidalClientSecret: '',
      llmProvider: 'claude',
      llmApiKey: '',
      llmModel: '',

      setTidalCredentials: (clientId, clientSecret) => {
        set({ tidalClientId: clientId, tidalClientSecret: clientSecret })
        if (clientId && clientSecret) {
          configureTidal(clientId, clientSecret)
        }
      },

      setLLMConfig: (provider, apiKey, model) => {
        set({ llmProvider: provider, llmApiKey: apiKey, llmModel: model || '' })
        if (apiKey) {
          configureLLM(provider, apiKey, model)
        }
      },

      initializeServices: () => {
        const state = get()
        if (state.tidalClientId && state.tidalClientSecret) {
          configureTidal(state.tidalClientId, state.tidalClientSecret)
        }
        if (state.llmApiKey) {
          configureLLM(state.llmProvider, state.llmApiKey, state.llmModel || undefined)
        }
      },
    }),
    {
      name: 'sauti-settings',
    }
  )
)
