import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { configureLLM, type LLMProvider } from '../lib/llm'

interface SettingsState {
  llmProvider: LLMProvider
  llmApiKey: string
  llmModel: string
  extendedThinking: boolean
  autoRadio: boolean
  setLLMConfig: (provider: LLMProvider, apiKey: string, model?: string) => void
  setExtendedThinking: (on: boolean) => void
  setAutoRadio: (on: boolean) => void
  initializeServices: () => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      llmProvider: 'claude',
      llmApiKey: '',
      llmModel: '',
      extendedThinking: true,
      autoRadio: true,

      setLLMConfig: (provider, apiKey, model) => {
        set({ llmProvider: provider, llmApiKey: apiKey, llmModel: model || '' })
        if (apiKey) {
          configureLLM(provider, apiKey, model)
        }
      },

      setExtendedThinking: (on) => set({ extendedThinking: on }),
      setAutoRadio: (on) => set({ autoRadio: on }),

      initializeServices: () => {
        const state = get()
        if (state.llmApiKey) {
          configureLLM(state.llmProvider, state.llmApiKey, state.llmModel || undefined)
        }
      },
    }),
    { name: 'sauti-settings' },
  ),
)
