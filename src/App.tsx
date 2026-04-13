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
    return (
      <div className="workspace-shell flex min-h-screen items-center justify-center px-6">
        <div className="rounded-[28px] border border-black/8 bg-white px-8 py-6 text-center shadow-[0_1px_0_rgba(17,17,22,0.03)]">
          <p className="text-xs font-semibold uppercase tracking-[0.35em] text-[#9c9da5]">Sauti</p>
          <p className="deezer-display mt-3 text-[2.1rem] leading-none text-[#111116]">Checking session</p>
        </div>
      </div>
    )
  }

  if (!authenticated) {
    return <AuthScreen />
  }

  return (
    <WorkspaceShell />
  )
}
