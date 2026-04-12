import { useEffect } from 'react'
import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import HomePage from './pages/HomePage'
import LibraryPage from './pages/LibraryPage'
import NowPlayingPage from './pages/NowPlayingPage'
import SearchPage from './pages/SearchPage'
import SettingsPage from './pages/SettingsPage'
import ImportPage from './pages/ImportPage'
import AIChatPage from './pages/AIChatPage'
import PlaylistPage from './pages/PlaylistPage'
import { useSettingsStore } from './stores/settingsStore'
import { useTidalStore } from './stores/tidalStore'

export default function App() {
  const initializeServices = useSettingsStore(s => s.initializeServices)
  const initializeTidal = useTidalStore(s => s.initialize)

  useEffect(() => {
    initializeServices()
    initializeTidal()
  }, [initializeServices, initializeTidal])

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/library" element={<LibraryPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
      <Route path="/now-playing" element={<NowPlayingPage />} />
      <Route path="/import" element={<ImportPage />} />
      <Route path="/ai" element={<AIChatPage />} />
      <Route path="/playlists/:kind/:playlistId" element={<PlaylistPage />} />
    </Routes>
  )
}
