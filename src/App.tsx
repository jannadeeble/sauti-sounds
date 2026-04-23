import { useEffect } from 'react'
import AuthScreen from './components/AuthScreen'
import WorkspaceShell from './components/WorkspaceShell'
import { resetPersistentAppStateCache } from './lib/appStateSync'
import { useAuthStore } from './stores/authStore'
import { useLibraryStore } from './stores/libraryStore'
import { useSettingsStore } from './stores/settingsStore'
import { useTidalStore } from './stores/tidalStore'

export default function App() {
  const hydrateSettings = useSettingsStore(s => s.hydrate)
  const initializeServices = useSettingsStore(s => s.initializeServices)
  const resetSettings = useSettingsStore(s => s.reset)
  const initializeAuth = useAuthStore(s => s.initialize)
  const authenticated = useAuthStore(s => s.authenticated)
  const authLoading = useAuthStore(s => s.loading)
  const initializeTidal = useTidalStore(s => s.initialize)
  const resetTidal = useTidalStore(s => s.reset)
  const checkR2Status = useLibraryStore(s => s.checkR2Status)

  useEffect(() => {
    initializeServices()
    void initializeAuth()
  }, [initializeAuth, initializeServices])

  useEffect(() => {
    if (authenticated) {
      void hydrateSettings()
      void initializeTidal()
      void checkR2Status()
      return
    }

    resetSettings()
    resetTidal()
    void resetPersistentAppStateCache()
  }, [authenticated, hydrateSettings, initializeTidal, resetSettings, resetTidal, checkR2Status])

  if (authLoading) {
    return null
  }

  if (!authenticated) {
    return <AuthScreen />
  }

  return (
    <WorkspaceShell />
  )
}
