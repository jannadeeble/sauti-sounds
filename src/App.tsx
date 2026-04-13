import { useEffect } from 'react'
import AuthScreen from './components/AuthScreen'
import WorkspaceShell from './components/WorkspaceShell'
import { useAuthStore } from './stores/authStore'
import { useSettingsStore } from './stores/settingsStore'
import { useTidalStore } from './stores/tidalStore'

export default function App() {
  const initializeServices = useSettingsStore(s => s.initializeServices)
  const initializeAuth = useAuthStore(s => s.initialize)
  const authenticated = useAuthStore(s => s.authenticated)
  const authLoading = useAuthStore(s => s.loading)
  const initializeTidal = useTidalStore(s => s.initialize)
  const resetTidal = useTidalStore(s => s.reset)

  useEffect(() => {
    initializeServices()
    void initializeAuth()
  }, [initializeAuth, initializeServices])

  useEffect(() => {
    if (authenticated) {
      void initializeTidal()
      return
    }

    resetTidal()
  }, [authenticated, initializeTidal, resetTidal])

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
