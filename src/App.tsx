import { useEffect } from 'react'
import AuthScreen from './components/AuthScreen'
import WorkspaceShell from './components/WorkspaceShell'
import { useAuthStore } from './stores/authStore'
import { useLibraryStore } from './stores/libraryStore'
import { useSettingsStore } from './stores/settingsStore'
import { useTidalStore } from './stores/tidalStore'

export default function App() {
  const initializeServices = useSettingsStore(s => s.initializeServices)
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
      void initializeTidal()
      void checkR2Status()
      return
    }

    resetTidal()
  }, [authenticated, initializeTidal, resetTidal, checkR2Status])

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
