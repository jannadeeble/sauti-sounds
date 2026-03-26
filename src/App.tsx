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
import DJModePage from './pages/DJModePage'
import { useSettingsStore } from './stores/settingsStore'

export default function App() {
  const initializeServices = useSettingsStore(s => s.initializeServices)

  useEffect(() => {
    initializeServices()
  }, [initializeServices])

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
      <Route path="/dj" element={<DJModePage />} />
    </Routes>
  )
}
