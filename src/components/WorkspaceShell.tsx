import { type ReactNode, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  ChevronRight,
  Grid3X3,
  List,
  LoaderCircle,
  Play,
  Plus,
  Radio,
  Search,
  Settings,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react'
import AIModalHost from './AIModalHost'
import BatchActionsBar from './BatchActionsBar'
import BottomSheet from './BottomSheet'
import HomeSuggestions from './HomeSuggestions'
import ImportPanel, { type ImportDoneResult } from './ImportPanel'
import NotificationBell from './NotificationBell'
import PlaylistGeneratorPanel from './PlaylistGeneratorPanel'
import QueueSheet from './QueueSheet'
import SettingsPanel from './SettingsPanel'
import TrackRow, { type TrackAction } from './TrackRow'
import WorkspacePlayer from './WorkspacePlayer'
import {
  getPersistentUiState,
  hydrateAppStateFromBackend,
  pushAppStateSnapshot,
  setPersistentUiState,
} from '../lib/appStateSync'
import { useTrackArtworkUrl } from '../lib/artwork'
import { rectFromElement, type RectLike } from '../lib/rect'
import { searchTidal } from '../lib/tidal'
import { runTagJob } from '../lib/tagJob'
import { useHistoryStore } from '../stores/historyStore'
import { useLibraryStore } from '../stores/libraryStore'
import { useMixStore } from '../stores/mixStore'
import { useNotificationStore } from '../stores/notificationStore'
import { usePlaybackSessionStore } from '../stores/playbackSessionStore'
import { usePlaylistGeneratorStore } from '../stores/playlistGeneratorStore'
import { usePlaylistStore } from '../stores/playlistStore'
import { useSelectionStore } from '../stores/selectionStore'
import { useTasteStore } from '../stores/tasteStore'
import { useTidalStore } from '../stores/tidalStore'
import type { Playlist, Track } from '../types'

type WorkspaceTab = 'home' | 'library'
type LibraryFilter = 'tracks' | 'playlists' | 'artists'
type LibrarySort = 'recent' | 'title' | 'artist' | 'tracks'
type LibraryViewMode = 'list' | 'grid'
type LibraryDetail =
  | { kind: 'artist'; artist: string }
  | { kind: 'playlist'; playlistKind: 'app' | 'tidal'; playlistId: string }

type ModalState =
  | { kind: 'search'; originRect: RectLike | null }
  | { kind: 'upload'; originRect: RectLike | null }
  | { kind: 'settings'; originRect: RectLike | null }
  | { kind: 'generator'; originRect: RectLike | null }

const WORKSPACE_TAB_VALUES: readonly WorkspaceTab[] = ['home', 'library']
const LIBRARY_FILTER_VALUES: readonly LibraryFilter[] = ['tracks', 'playlists', 'artists']

const LIBRARY_FILTERS: { value: LibraryFilter; label: string }[] = [
  { value: 'playlists', label: 'Playlists' },
  { value: 'artists', label: 'Artists' },
  { value: 'tracks', label: 'Tracks' },
]

function normalizeLibrarySort(filter: LibraryFilter, sort: LibrarySort): LibrarySort {
  if (filter === 'artists') {
    return sort === 'artist' ? 'recent' : sort
  }
  if (filter === 'playlists') {
    return sort === 'artist' ? 'recent' : sort
  }
  return sort === 'tracks' ? 'recent' : sort
}

function sortTracks(tracks: Track[], sort: LibrarySort): Track[] {
  const next = [...tracks]
  if (sort === 'title') {
    next.sort((left, right) => left.title.localeCompare(right.title))
  } else if (sort === 'artist') {
    next.sort((left, right) => left.artist.localeCompare(right.artist) || left.title.localeCompare(right.title))
  } else {
    next.sort((left, right) => (right.addedAt || 0) - (left.addedAt || 0))
  }
  return next
}

export default function WorkspaceShell() {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('home')
  const [libraryFilter, setLibraryFilter] = useState<LibraryFilter>('tracks')
  const [librarySort, setLibrarySort] = useState<LibrarySort>('recent')
  const [libraryViewMode, setLibraryViewMode] = useState<LibraryViewMode>('list')
  const [libraryDetail, setLibraryDetail] = useState<LibraryDetail | null>(null)
  const [query, setQuery] = useState('')
  const [tidalResults, setTidalResults] = useState<Track[]>([])
  const [tidalLoading, setTidalLoading] = useState(false)
  const [tidalSearched, setTidalSearched] = useState(false)
  const [importNotice, setImportNotice] = useState<string | null>(null)
  const [highlightedImportIds, setHighlightedImportIds] = useState<string[]>([])
  const [modal, setModal] = useState<ModalState | null>(null)
  const [prefsReady, setPrefsReady] = useState(false)

  const tracks = useLibraryStore((state) => state.tracks)
  const libraryLoading = useLibraryStore((state) => state.loading)
  const loadTracks = useLibraryStore((state) => state.loadTracks)
  const cacheTidalTracks = useLibraryStore((state) => state.cacheTidalTracks)
  const importing = useLibraryStore((state) => state.importing)
  const importProgress = useLibraryStore((state) => state.importProgress)

  const {
    appPlaylists,
    tidalPlaylists,
    tidalPlaylistDetails,
    loadPlaylists,
    loadTidalPlaylistDetail,
    createAppPlaylist,
    createProviderPlaylist,
    deleteAppPlaylist,
    renameAppPlaylist,
    moveAppPlaylistItem,
    removeTrackFromPlaylist,
  } = usePlaylistStore()

  const tidalConnected = useTidalStore((state) => state.tidalConnected)
  const selectedPlaylist = usePlaybackSessionStore((state) => state.selectedPlaylist)
  const playPlaylist = usePlaybackSessionStore((state) => state.playPlaylist)
  const playTracks = usePlaybackSessionStore((state) => state.playTracks)
  const errorMessage = usePlaybackSessionStore((state) => state.errorMessage)
  const queuedTracks = usePlaybackSessionStore((state) => state.tracks)
  const playerOpen = usePlaybackSessionStore((state) => state.playerOpen)
  const setPlayerOpen = usePlaybackSessionStore((state) => state.setPlayerOpen)

  const loadHistory = useHistoryStore((state) => state.loadHistory)
  const historyEntries = useHistoryStore((state) => state.entries)
  const notifications = useNotificationStore((state) => state.notifications)
  const loadNotifications = useNotificationStore((state) => state.loadNotifications)
  const loadMixes = useMixStore((state) => state.load)
  const loadTasteProfile = useTasteStore((state) => state.load)

  const selecting = useSelectionStore((state) => state.selecting)
  const exitSelection = useSelectionStore((state) => state.exit)
  const requestGeneratorCompletionNotification = usePlaylistGeneratorStore((state) => state.requestCompletionNotification)
  const resumePendingGeneration = usePlaylistGeneratorStore((state) => state.resumePending)
  const playlistGenerationStatus = usePlaylistGeneratorStore((state) => state.status)
  const playlistGenerationError = usePlaylistGeneratorStore((state) => state.error)
  const playlistGenerating = playlistGenerationStatus === 'running'
  const effectiveLibraryFilter = libraryDetail ? 'tracks' : libraryFilter
  const showGenerateAction = playlistGenerating || activeTab === 'home' || (activeTab === 'library' && libraryFilter === 'playlists')
  const showNewPlaylistAction = activeTab === 'library' && libraryFilter === 'playlists' && !libraryDetail
  const showNotificationsAction = notifications.length > 0

  useEffect(() => {
    void loadTracks()
    void loadPlaylists()
    void loadHistory()
    void loadNotifications()
    void loadMixes()
    void loadTasteProfile()
  }, [loadHistory, loadMixes, loadNotifications, loadPlaylists, loadTasteProfile, loadTracks])

  const trackCount = tracks.length
  useEffect(() => {
    if (!trackCount) return
    void runTagJob()
  }, [trackCount])

  useEffect(() => {
    void hydrateAppStateFromBackend()
      .then(() => {
        const persisted = getPersistentUiState()
        if (persisted.activeTab && WORKSPACE_TAB_VALUES.includes(persisted.activeTab)) {
          setActiveTab(persisted.activeTab)
        }
        if (persisted.libraryFilter && LIBRARY_FILTER_VALUES.includes(persisted.libraryFilter)) {
          setLibraryFilter(persisted.libraryFilter)
        }
        void resumePendingGeneration()
      })
      .finally(() => {
        setPrefsReady(true)
      })
  }, [resumePendingGeneration])

  useEffect(() => {
    function handleHidden() {
      if (usePlaylistGeneratorStore.getState().status === 'running') {
        requestGeneratorCompletionNotification()
      }
    }

    function handleVisible() {
      void resumePendingGeneration()
    }

    function handleVisibilityChange() {
      if (document.visibilityState === 'hidden') {
        handleHidden()
        return
      }
      handleVisible()
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('pagehide', handleHidden)
    window.addEventListener('pageshow', handleVisible)
    window.addEventListener('focus', handleVisible)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('pagehide', handleHidden)
      window.removeEventListener('pageshow', handleVisible)
      window.removeEventListener('focus', handleVisible)
    }
  }, [requestGeneratorCompletionNotification, resumePendingGeneration])

  useEffect(() => {
    if (!prefsReady) return
    setPersistentUiState({ activeTab })
    void pushAppStateSnapshot()
  }, [activeTab, prefsReady])

  useEffect(() => {
    if (!prefsReady) return
    setPersistentUiState({ libraryFilter })
    void pushAppStateSnapshot()
  }, [libraryFilter, prefsReady])

  useEffect(() => {
    const normalizedSort = normalizeLibrarySort(effectiveLibraryFilter, librarySort)
    if (normalizedSort !== librarySort) {
      setLibrarySort(normalizedSort)
    }
  }, [effectiveLibraryFilter, librarySort])

  useEffect(() => {
    if (activeTab !== 'library' && selecting) {
      exitSelection()
    }
  }, [activeTab, exitSelection, selecting])

  useEffect(() => {
    if (libraryDetail?.kind === 'playlist' && libraryDetail.playlistKind === 'tidal' && !tidalPlaylistDetails[libraryDetail.playlistId]) {
      void loadTidalPlaylistDetail(libraryDetail.playlistId)
    }
  }, [libraryDetail, loadTidalPlaylistDetail, tidalPlaylistDetails])

  useEffect(() => {
    if (!importNotice && highlightedImportIds.length === 0) return
    const timeoutId = window.setTimeout(() => {
      setImportNotice(null)
      setHighlightedImportIds([])
    }, 4200)
    return () => window.clearTimeout(timeoutId)
  }, [highlightedImportIds, importNotice])

  const libraryTrackIds = useMemo(() => new Set(tracks.map((track) => track.id)), [tracks])

  const trackById = useMemo(() => new Map(tracks.map((track) => [track.id, track])), [tracks])
  const providerTrackById = useMemo(
    () => new Map(tracks.filter((track) => track.providerTrackId).map((track) => [track.providerTrackId!, track])),
    [tracks],
  )

  const artistGroups = useMemo(() => {
    const groups = new Map<string, Track[]>()
    for (const track of tracks) {
      const key = track.artist || 'Unknown artist'
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(track)
    }
    return Array.from(groups.entries())
      .map(([artist, list]) => ({ artist, tracks: list }))
      .sort((a, b) => a.artist.localeCompare(b.artist))
  }, [tracks])

  const recentTracks = useMemo(() => {
    if (historyEntries.length > 0) {
      const seen = new Set<string>()
      const result: Track[] = []
      for (const entry of historyEntries) {
        if (seen.has(entry.trackId)) continue
        seen.add(entry.trackId)
        const libraryMatch = tracks.find((track) => track.id === entry.trackId)
        if (libraryMatch) {
          result.push(libraryMatch)
        } else {
          result.push({
            id: entry.trackId,
            title: entry.title,
            artist: entry.artist,
            album: entry.album ?? '',
            duration: entry.duration,
            source: entry.source,
            providerTrackId: entry.providerTrackId,
            artworkUrl: entry.artworkUrl,
          })
        }
        if (result.length >= 8) break
      }
      return result
    }

    return [...tracks]
      .sort((left, right) => (right.addedAt || 0) - (left.addedAt || 0))
      .slice(0, 8)
  }, [historyEntries, tracks])

  const sortedTracks = useMemo(() => {
    return sortTracks(tracks, librarySort)
  }, [librarySort, tracks])

  const localSearchResults = useMemo(() => {
    if (!query.trim()) return []
    const needle = query.toLowerCase()
    return tracks.filter((track) =>
      [track.title, track.artist, track.album, track.genre]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(needle)),
    )
  }, [query, tracks])

  const playlistRows = useMemo(() => {
    const app = appPlaylists.map((playlist) => ({
      ...playlist,
      label: playlist.origin === 'generated' ? 'Generated' : playlist.origin === 'imported' ? 'Imported' : 'Playlist',
      trackCount: playlist.trackCount ?? playlist.items.length,
      sourceKind: 'app' as const,
    }))
    const tidal = tidalPlaylists
      .filter((playlist) => Boolean(playlist.providerPlaylistId))
      .map((playlist) => ({
        ...playlist,
        id: playlist.providerPlaylistId!,
        label: 'TIDAL',
        trackCount: playlist.trackCount ?? playlist.items.length,
        sourceKind: 'tidal' as const,
      }))
    return [...app, ...tidal].sort((left, right) => right.updatedAt - left.updatedAt)
  }, [appPlaylists, tidalPlaylists])

  const sortedArtistGroups = useMemo(() => {
    const next = [...artistGroups]
    if (librarySort === 'tracks') {
      next.sort((left, right) => right.tracks.length - left.tracks.length || left.artist.localeCompare(right.artist))
    } else if (librarySort === 'recent') {
      next.sort((left, right) => {
        const leftRecent = Math.max(...left.tracks.map((track) => track.addedAt || 0))
        const rightRecent = Math.max(...right.tracks.map((track) => track.addedAt || 0))
        return rightRecent - leftRecent || left.artist.localeCompare(right.artist)
      })
    } else {
      next.sort((left, right) => left.artist.localeCompare(right.artist))
    }
    return next
  }, [artistGroups, librarySort])

  const sortedPlaylistRows = useMemo(() => {
    const next = [...playlistRows]
    if (librarySort === 'title') {
      next.sort((left, right) => left.name.localeCompare(right.name))
    } else if (librarySort === 'tracks') {
      next.sort((left, right) => right.trackCount - left.trackCount || left.name.localeCompare(right.name))
    } else {
      next.sort((left, right) => right.updatedAt - left.updatedAt)
    }
    return next
  }, [librarySort, playlistRows])

  const artistDetail = libraryDetail?.kind === 'artist' ? libraryDetail : null
  const artistDetailTracks = useMemo(() => {
    if (!artistDetail) return []
    return sortTracks(
      tracks.filter((track) => (track.artist || 'Unknown artist') === artistDetail.artist),
      librarySort,
    )
  }, [artistDetail, librarySort, tracks])

  const playlistDetail = libraryDetail?.kind === 'playlist' ? libraryDetail : null
  const selectedAppPlaylist = playlistDetail?.playlistKind === 'app'
    ? appPlaylists.find((playlist) => playlist.id === playlistDetail.playlistId)
    : undefined
  const appPlaylistTracks = useMemo(() => {
    if (!selectedAppPlaylist) return []
    return selectedAppPlaylist.items
      .map((item, index) => {
        const track = item.source === 'local'
          ? trackById.get(item.trackId)
          : providerTrackById.get(item.providerTrackId)

        return track ? { item, track, index } : null
      })
      .filter((value): value is { item: Playlist['items'][number]; track: Track; index: number } => value !== null)
  }, [providerTrackById, selectedAppPlaylist, trackById])
  const selectedTidalDetail = playlistDetail?.playlistKind === 'tidal'
    ? tidalPlaylistDetails[playlistDetail.playlistId]
    : undefined

  function openModal(kind: ModalState['kind'], originRect: RectLike | null, payload?: Partial<ModalState>) {
    setModal({ kind, originRect, ...(payload ?? {}) } as ModalState)
  }

  function closeModal() {
    if (modal?.kind === 'generator' && usePlaylistGeneratorStore.getState().status === 'running') {
      requestGeneratorCompletionNotification()
    }
    setModal(null)
  }

  async function handleTidalSearch() {
    if (!query.trim() || !tidalConnected) return
    setTidalLoading(true)
    setTidalSearched(true)
    try {
      const results = await searchTidal(query)
      setTidalResults(results.tracks)
    } catch (error) {
      console.error('TIDAL search failed:', error)
      setTidalResults([])
    } finally {
      setTidalLoading(false)
    }
  }

  async function handleCreatePlaylist(kind: 'app' | 'tidal') {
    const name = window.prompt(kind === 'app' ? 'Name your new playlist' : 'Name your new TIDAL playlist')
    if (!name?.trim()) return

    if (kind === 'app') {
      const playlist = await createAppPlaylist(name.trim())
      setActiveTab('library')
      setLibraryFilter('playlists')
      setLibraryDetail({ kind: 'playlist', playlistKind: 'app', playlistId: playlist.id })
      return
    }

    const playlist = await createProviderPlaylist(name.trim())
    if (playlist.providerPlaylistId) {
      setActiveTab('library')
      setLibraryFilter('playlists')
      setLibraryDetail({ kind: 'playlist', playlistKind: 'tidal', playlistId: playlist.providerPlaylistId })
    }
  }

  function handlePlaylistPlayback(kind: 'app' | 'tidal', playlistId: string, playlistTracks: Track[]) {
    if (playlistTracks.length === 0) return
    playPlaylist(kind, playlistId, playlistTracks, 0)
  }

  async function handlePlaylistRowPlayback(playlist: Playlist & { label: string; trackCount: number; sourceKind: 'app' | 'tidal' }) {
    if (playlist.sourceKind === 'app') {
      const current = appPlaylists.find((candidate) => candidate.id === playlist.id)
      if (!current) return
      const playlistTracks = current.items
        .map((item) => item.source === 'local'
          ? trackById.get(item.trackId)
          : providerTrackById.get(item.providerTrackId))
        .filter((track): track is Track => !!track)
      handlePlaylistPlayback('app', playlist.id, playlistTracks)
      return
    }

    const detail = tidalPlaylistDetails[playlist.id] ?? await loadTidalPlaylistDetail(playlist.id)
    handlePlaylistPlayback('tidal', playlist.id, detail.tracks)
  }

  function finalizeImport(result?: ImportDoneResult) {
    const importedTracks = result?.importedTracks ?? []
    closeModal()
    setActiveTab('library')
    setLibraryFilter('tracks')
    setLibrarySort('recent')

    if (importedTracks.length > 0) {
      playTracks(importedTracks, 'library', 0)
      setHighlightedImportIds(importedTracks.map((track) => track.id))
      setImportNotice(
        importedTracks.length === 1
          ? `Added "${importedTracks[0].title}" to your library.`
          : `Added ${importedTracks.length} tracks to your library.`,
      )
    }

    void loadTracks()
    void loadPlaylists()
  }

  function selectLibraryFilter(filter: LibraryFilter) {
    setActiveTab('library')
    setLibraryFilter(filter)
    setLibrarySort((current) => normalizeLibrarySort(filter, current))
    setLibraryDetail(null)
  }

  function openGeneratedPlaylist(playlistId: string) {
    closeModal()
    setActiveTab('library')
    setLibraryFilter('playlists')
    setLibraryDetail({ kind: 'playlist', playlistKind: 'app', playlistId })
  }

  const playerVisible = queuedTracks.length > 0

  return (
    <div className="workspace-shell min-h-[100dvh]">
      <div className="min-h-[100dvh]">
        <div className={`mx-auto flex min-h-[100dvh] max-w-[1460px] flex-col px-2 pt-2 sm:px-6 sm:pt-4 lg:px-8 ${
          playerVisible
            ? 'pb-[calc(16rem+env(safe-area-inset-bottom))]'
            : 'pb-[calc(7rem+env(safe-area-inset-bottom))]'
        }`}>
          <header className="pointer-events-none fixed inset-x-0 top-0 z-30 border-b border-transparent bg-white px-2 py-2 sm:px-6 sm:py-4 lg:px-8">
            <div className="pointer-events-auto mx-auto flex max-w-[1180px] flex-col items-start gap-2 px-1 sm:px-3 lg:px-6">
              <div className="flex w-full justify-start">
                <div className="flex shrink-0 items-center gap-2">
                  <TabButton active={activeTab === 'home'} onClick={() => setActiveTab('home')}>Discover</TabButton>
                  <TabButton active={activeTab === 'library'} onClick={() => setActiveTab('library')}>Library</TabButton>
                </div>
              </div>
              {activeTab === 'library' ? (
                <div className="flex w-full justify-start overflow-x-auto">
                  <div className="flex min-w-max gap-2">
                    {LIBRARY_FILTERS.map((filter) => (
                      <button
                        key={filter.value}
                        type="button"
                        data-active={libraryFilter === filter.value}
                        onClick={() => selectLibraryFilter(filter.value)}
                        className="sauti-nav-pill"
                      >
                        {filter.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </header>

          <main className={`flex-1 ${activeTab === 'home' ? 'pt-[100px] sm:pt-[112px]' : 'pt-[104px] sm:pt-[116px]'}`}>
            <div className="mx-auto w-full max-w-[1180px] space-y-8 px-1 sm:px-3 lg:px-6">
              {errorMessage ? <Banner>{errorMessage}</Banner> : null}
              {playlistGenerationStatus === 'error' && playlistGenerationError ? (
                <Banner>Playlist generation failed: {playlistGenerationError}</Banner>
              ) : null}
              {importNotice ? <Banner>{importNotice}</Banner> : null}

              {importing && importProgress && modal?.kind !== 'upload' ? (
                <div className="rounded-[24px] border border-black/8 bg-white px-5 py-4 shadow-[0_1px_0_rgba(17,17,22,0.03)]">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-[#111116]">Uploading music…</p>
                      <p className="mt-1 text-xs text-[#7a7b86]">
                        {importProgress.currentFile ? `Processing ${importProgress.currentFile}` : 'Preparing files'}
                      </p>
                    </div>
                    <span className="text-xs text-[#8c8d96]">
                      {importProgress.current}/{importProgress.total}
                    </span>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#efeff2]">
                    <div
                      className="h-full rounded-full bg-[linear-gradient(90deg,#ef5466,#f36f7e)] transition-[width] duration-300"
                      style={{ width: `${(importProgress.current / importProgress.total) * 100}%` }}
                    />
                  </div>
                </div>
              ) : null}

              {activeTab === 'home' ? (
                <div className="space-y-8">
                  <SectionHeader
                    title="Recently played"
                    subtitle="Jump straight back in"
                  />

                  {recentTracks.length === 0 ? (
                    <EmptyState
                      title="No plays yet"
                      description="Upload music or connect TIDAL to start filling this surface."
                    />
                  ) : (
                    <div className="grid grid-cols-3 gap-3">
                      {recentTracks.map((track) => (
                        <RecentTrackCard
                          key={track.id}
                          track={track}
                          onClick={() => playTracks(recentTracks, 'library', recentTracks.findIndex((item) => item.id === track.id))}
                        />
                      ))}
                    </div>
                  )}

                  <HomeSuggestions onPlayTracks={(list) => playTracks(list, 'library', 0)} />
                </div>
              ) : null}

              {activeTab === 'library' ? (
                <div className="space-y-6">
                  <div className="flex flex-wrap items-center justify-end gap-3">
                    <LibraryToolbar
                      filter={effectiveLibraryFilter}
                      sort={librarySort}
                      viewMode={libraryViewMode}
                      onSortChange={setLibrarySort}
                      onViewModeChange={setLibraryViewMode}
                    />
                  </div>

                  {libraryDetail ? (
                    <LibraryDetailView
                      detail={libraryDetail}
                      artistTracks={artistDetailTracks}
                      playlistRow={playlistDetail ? playlistRows.find((item) => item.sourceKind === playlistDetail.playlistKind && item.id === playlistDetail.playlistId) : undefined}
                      playlistDetail={playlistDetail}
                      appPlaylist={selectedAppPlaylist}
                      appPlaylistTracks={appPlaylistTracks}
                      tidalDetail={selectedTidalDetail}
                      viewMode={libraryViewMode}
                      sort={librarySort}
                      onBack={() => setLibraryDetail(null)}
                      onPlayPlaylist={handlePlaylistPlayback}
                      onRenameAppPlaylist={(playlistId, currentName, currentDescription) => void renamePlaylist(playlistId, currentName, currentDescription, renameAppPlaylist)}
                      onDeleteAppPlaylist={async (playlistId) => {
                        if (!window.confirm('Delete this playlist?')) return
                        await deleteAppPlaylist(playlistId)
                        setLibraryDetail(null)
                      }}
                      onMoveItem={(playlistId, fromIndex, toIndex) => void moveAppPlaylistItem(playlistId, fromIndex, toIndex)}
                      onRemoveItem={(playlist, item, index) => void removeTrackFromPlaylist(playlist, item, index)}
                    />
                  ) : libraryFilter === 'tracks' ? (
                    libraryLoading && sortedTracks.length === 0 ? (
                      <EmptyState
                        title="Loading your library..."
                        description="Reading tracks from the local cache before the list appears."
                      />
                    ) : sortedTracks.length === 0 ? (
                      <EmptyState
                        title="Your library is empty"
                        description="Upload local files or connect TIDAL in Settings to fill the library."
                      />
                    ) : libraryViewMode === 'grid' ? (
                      <TrackGrid
                        tracks={sortedTracks}
                        playContext="library"
                        highlightedImportIds={highlightedImportIds}
                      />
                    ) : (
                      <PlainListCard>
                        <div className="divide-y divide-black/6">
                          {sortedTracks.map((track, index) => (
                            <TrackRow
                              key={track.id}
                              track={track}
                              tracks={sortedTracks}
                              playContext="library"
                              index={index}
                              highlighted={highlightedImportIds.includes(track.id)}
                            />
                          ))}
                        </div>
                      </PlainListCard>
                    )
                  ) : null}

                  {!libraryDetail && libraryFilter === 'artists' ? (
                    sortedArtistGroups.length === 0 ? (
                      <EmptyState
                        title="No artists yet"
                        description="Upload tracks or connect TIDAL to group your library by artist."
                      />
                    ) : libraryViewMode === 'grid' ? (
                      <div className="grid grid-cols-3 gap-3">
                        {sortedArtistGroups.map((group) => (
                          <ArtistCard
                            key={group.artist}
                            artist={group.artist}
                            tracks={group.tracks}
                            onClick={() => setLibraryDetail({ kind: 'artist', artist: group.artist })}
                          />
                        ))}
                      </div>
                    ) : (
                      <PlainListCard>
                        <div className="divide-y divide-black/6">
                          {sortedArtistGroups.map((group) => (
                            <ArtistRow
                            key={group.artist}
                            artist={group.artist}
                            tracks={group.tracks}
                            onOpen={() => setLibraryDetail({ kind: 'artist', artist: group.artist })}
                          />
                          ))}
                        </div>
                      </PlainListCard>
                    )
                  ) : null}

                  {!libraryDetail && libraryFilter === 'playlists' ? (
                    sortedPlaylistRows.length === 0 ? (
                      <EmptyState
                        title="No playlists yet"
                        description="Create a playlist, generate one from a prompt, or connect TIDAL to pull in synced collections."
                      />
                    ) : libraryViewMode === 'list' ? (
                      <PlainListCard>
                        <div className="divide-y divide-black/6">
                          {sortedPlaylistRows.map((playlist) => (
                            <PlaylistRow
                              key={`${playlist.sourceKind}-${playlist.id}`}
                              playlist={playlist}
                              active={Boolean(selectedPlaylist?.kind === playlist.sourceKind && selectedPlaylist.id === playlist.id)}
                              onOpen={() => setLibraryDetail({ kind: 'playlist', playlistKind: playlist.sourceKind, playlistId: playlist.id })}
                              onPlay={() => void handlePlaylistRowPlayback(playlist)}
                            />
                          ))}
                        </div>
                      </PlainListCard>
                    ) : (
                      <div className="grid grid-cols-3 gap-4">
                        {sortedPlaylistRows.map((playlist) => (
                          <PlaylistCard
                            key={`${playlist.sourceKind}-${playlist.id}`}
                            playlist={playlist}
                            active={Boolean(selectedPlaylist?.kind === playlist.sourceKind && selectedPlaylist.id === playlist.id)}
                            onOpen={() => setLibraryDetail({ kind: 'playlist', playlistKind: playlist.sourceKind, playlistId: playlist.id })}
                            onPlay={() => void handlePlaylistRowPlayback(playlist)}
                          />
                        ))}
                      </div>
                    )
                  ) : null}
                </div>
              ) : null}
            </div>
          </main>
        </div>

        <div className="workspace-action-cluster" data-player-visible={playerVisible ? 'true' : 'false'}>
          {showGenerateAction ? (
            <BottomActionButton
              label="Generate"
              icon={playlistGenerating ? <LoaderCircle size={17} className="animate-spin" /> : <Sparkles size={17} />}
              active={playlistGenerating}
              onClick={(event) => openModal('generator', rectFromElement(event.currentTarget))}
            />
          ) : null}
          {showNewPlaylistAction ? (
            <BottomActionButton
              label="New playlist"
              icon={<Plus size={17} />}
              onClick={() => void handleCreatePlaylist('app')}
            />
          ) : null}
          <BottomActionButton
            label="Search"
            icon={<Search size={17} />}
            onClick={(event) => openModal('search', rectFromElement(event.currentTarget))}
          />
          {showNotificationsAction ? (
            <NotificationBell buttonClassName="workspace-action-button workspace-action-button--icon relative" />
          ) : null}
          <BottomActionButton
            label="Settings"
            icon={<Settings size={17} />}
            iconOnly
            onClick={(event) => openModal('settings', rectFromElement(event.currentTarget))}
          />
        </div>

        <WorkspacePlayer />

        <BottomSheet
          open={modal?.kind === 'search'}
          title="Search"
          description="Local results appear instantly. Extend to TIDAL on demand."
          onClose={closeModal}
          variant="light"
          originRect={modal?.kind === 'search' ? modal.originRect : null}
          size="full"
          maxHeightClassName="max-h-[94vh]"
        >
          <SearchPanel
            query={query}
            setQuery={(value) => {
              setQuery(value)
              setTidalSearched(false)
            }}
            localResults={localSearchResults}
            tidalResults={tidalResults}
            tidalConnected={tidalConnected}
            tidalLoading={tidalLoading}
            tidalSearched={tidalSearched}
            onTidalSearch={() => void handleTidalSearch()}
            libraryTrackIds={libraryTrackIds}
            onAddTidalTrack={(track) => void cacheTidalTracks([track])}
          />
        </BottomSheet>

        <BottomSheet
          open={modal?.kind === 'upload'}
          title="Upload music"
          description="Bring local files or Spotify exports into the prototype."
          onClose={closeModal}
          variant="light"
          originRect={modal?.kind === 'upload' ? modal.originRect : null}
          size="xl"
        >
          <ImportPanel onDone={finalizeImport} />
        </BottomSheet>

        <BottomSheet
          open={modal?.kind === 'settings'}
          title="Settings"
          description="Account, TIDAL, and AI configuration for this workspace."
          onClose={closeModal}
          variant="light"
          originRect={modal?.kind === 'settings' ? modal.originRect : null}
          size="lg"
          maxHeightClassName="max-h-[88vh]"
        >
          <SettingsPanel onOpenUpload={(event) => openModal('upload', rectFromElement(event.currentTarget))} />
        </BottomSheet>

        <BottomSheet
          open={modal?.kind === 'generator'}
          title="Playlist generator"
          description="Turn a prompt into a saved playlist."
          onClose={closeModal}
          variant="light"
          originRect={modal?.kind === 'generator' ? modal.originRect : null}
          size="lg"
          maxHeightClassName="max-h-[88vh]"
        >
          <PlaylistGeneratorPanel onOpenPlaylist={openGeneratedPlaylist} />
        </BottomSheet>

        <QueueSheet open={playerOpen} onClose={() => setPlayerOpen(false)} />

        <BatchActionsBar />
        <AIModalHost />
      </div>
    </div>
  )
}

function TabButton({
  active,
  children,
  onClick,
}: {
  active: boolean
  children: ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-active={active ? 'true' : 'false'}
      className="sauti-nav-pill sauti-nav-pill--primary"
    >
      {children}
    </button>
  )
}

function BottomActionButton({
  label,
  icon,
  active = false,
  iconOnly = false,
  onClick,
}: {
  label: string
  icon: ReactNode
  active?: boolean
  iconOnly?: boolean
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      data-active={active ? 'true' : 'false'}
      className={`workspace-action-button ${iconOnly ? 'workspace-action-button--icon' : ''}`}
    >
      {icon}
      {iconOnly ? null : <span className="workspace-action-button__label">{label}</span>}
    </button>
  )
}

function SectionHeader({
  title,
  subtitle,
  action,
}: {
  title: string
  subtitle: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h2 className="deezer-display text-[2rem] leading-none text-[#111116]">{title}</h2>
        <p className="mt-2 text-sm text-[#7a7b86]">{subtitle}</p>
      </div>
      {action}
    </div>
  )
}

function Banner({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-[22px] border border-[#f4c6cc] bg-[#fff4f6] px-5 py-4 text-sm text-[#8d3140]">
      {children}
    </div>
  )
}

function LibraryToolbar({
  filter,
  sort,
  viewMode,
  onSortChange,
  onViewModeChange,
}: {
  filter: LibraryFilter
  sort: LibrarySort
  viewMode: LibraryViewMode
  onSortChange: (sort: LibrarySort) => void
  onViewModeChange: (mode: LibraryViewMode) => void
}) {
  const options = filter === 'artists'
    ? [
        { value: 'recent', label: 'Recent' },
        { value: 'title', label: 'Artist' },
        { value: 'tracks', label: 'Tracks' },
      ]
    : filter === 'playlists'
      ? [
          { value: 'recent', label: 'Recent' },
          { value: 'title', label: 'Title' },
          { value: 'tracks', label: 'Tracks' },
        ]
      : [
          { value: 'recent', label: 'Recent' },
          { value: 'title', label: 'Title' },
          { value: 'artist', label: 'Artist' },
        ]

  const validSort = options.some((option) => option.value === sort) ? sort : 'recent'

  return (
    <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
      <label className="inline-flex items-center gap-2 rounded-full border border-black/8 bg-white px-3 py-2 text-sm text-[#555661]">
        <SlidersHorizontal size={14} />
        <select
          value={validSort}
          onChange={(event) => onSortChange(event.target.value as LibrarySort)}
          className="bg-transparent text-[#111116] outline-none"
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>
      <div className="inline-flex rounded-full border border-black/8 bg-white p-1">
        <button
          type="button"
          aria-label="List view"
          title="List view"
          data-active={viewMode === 'list'}
          onClick={() => onViewModeChange('list')}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[#686973] transition-colors data-[active=true]:bg-[#111116] data-[active=true]:text-white"
        >
          <List size={15} />
        </button>
        <button
          type="button"
          aria-label="Grid view"
          title="Grid view"
          data-active={viewMode === 'grid'}
          onClick={() => onViewModeChange('grid')}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[#686973] transition-colors data-[active=true]:bg-[#111116] data-[active=true]:text-white"
        >
          <Grid3X3 size={15} />
        </button>
      </div>
    </div>
  )
}

function PlainListCard({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-[24px] border border-black/8 bg-white shadow-[0_1px_0_rgba(17,17,22,0.03)]">
      {children}
    </div>
  )
}

function SurfaceCard({
  title,
  meta,
  children,
}: {
  title: string
  meta?: string
  children: ReactNode
}) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="deezer-display text-[1.6rem] leading-none text-[#111116]">{title}</h3>
        {meta ? <p className="mt-2 text-sm text-[#7a7b86]">{meta}</p> : null}
      </div>
      <div className="overflow-hidden rounded-[24px] border border-black/8 bg-white shadow-[0_1px_0_rgba(17,17,22,0.03)]">{children}</div>
    </section>
  )
}

function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="rounded-[28px] border border-black/8 bg-white px-6 py-12 text-center shadow-[0_1px_0_rgba(17,17,22,0.03)]">
      <h3 className="deezer-display text-[1.9rem] leading-none text-[#111116]">{title}</h3>
      <p className="mx-auto mt-3 max-w-[42rem] text-sm leading-6 text-[#686973]">{description}</p>
      {action ? <div className="mt-6 flex justify-center">{action}</div> : null}
    </div>
  )
}

function ActionButton({
  children,
  icon,
  onClick,
  accent = false,
}: {
  children: ReactNode
  icon: ReactNode
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void | Promise<void>
  accent?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium transition-colors ${
        accent
          ? 'bg-accent text-white hover:bg-accent-dark'
          : 'border border-black/8 bg-white text-[#555661] hover:border-black/14 hover:text-[#111116]'
      }`}
    >
      {icon}
      {children}
    </button>
  )
}

function SearchPanel({
  query,
  setQuery,
  localResults,
  tidalResults,
  tidalConnected,
  tidalLoading,
  tidalSearched,
  onTidalSearch,
  libraryTrackIds,
  onAddTidalTrack,
}: {
  query: string
  setQuery: (value: string) => void
  localResults: Track[]
  tidalResults: Track[]
  tidalConnected: boolean
  tidalLoading: boolean
  tidalSearched: boolean
  onTidalSearch: () => void
  libraryTrackIds: Set<string>
  onAddTidalTrack: (track: Track) => void
}) {
  return (
    <div className="space-y-5 pb-2">
      <label className="deezer-search-shell">
        <Search size={18} className="shrink-0 text-white/36" />
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onTidalSearch()
          }}
          placeholder="Artists, tracks, playlists..."
          autoFocus
        />
      </label>

      {!query.trim() ? (
        <div className="rounded-[22px] border border-black/8 bg-[#f8f8f9] px-4 py-5 text-sm text-[#7a7b86]">
          Start typing to search your library. Press enter to extend the search to TIDAL.
        </div>
      ) : null}

      {query.trim() && localResults.length > 0 ? (
        <SurfaceCard title="Library results" meta={`${localResults.length} matches`}>
          <div className="divide-y divide-black/6">
            {localResults.map((track, index) => (
              <TrackRow
                key={track.id}
                track={track}
                tracks={localResults}
                playContext="search-local"
                index={index}
              />
            ))}
          </div>
        </SurfaceCard>
      ) : null}

      {query.trim() && tidalConnected ? (
        <div className="space-y-3">
          {!tidalSearched && !tidalLoading ? (
            <button
              type="button"
              onClick={onTidalSearch}
              className="inline-flex items-center gap-2 rounded-full border border-black/8 bg-white px-4 py-2 text-sm text-accent transition-colors hover:bg-[#fafafb]"
            >
              <Radio size={15} />
              Search TIDAL for "{query}"
            </button>
          ) : null}

          {tidalLoading ? (
            <div className="rounded-[22px] border border-black/8 bg-[#f8f8f9] px-4 py-4 text-sm text-[#7a7b86]">Searching TIDAL...</div>
          ) : null}

          {tidalSearched && tidalResults.length > 0 ? (
            <SurfaceCard title="TIDAL results" meta={`${tidalResults.length} matches`}>
              <div className="divide-y divide-black/6">
                {tidalResults.map((track, index) => {
                  const inLibrary = libraryTrackIds.has(track.id)
                  return (
                    <TrackRow
                      key={`${track.id}-${index}`}
                      track={track}
                      tracks={tidalResults}
                      playContext="search-tidal"
                      index={index}
                      onAddToLibrary={inLibrary ? undefined : onAddTidalTrack}
                    />
                  )
                })}
              </div>
            </SurfaceCard>
          ) : null}
        </div>
      ) : null}

      {query.trim() && !localResults.length && (!tidalSearched || !tidalResults.length) && !tidalLoading ? (
        <div className="rounded-[22px] border border-black/8 bg-[#f8f8f9] px-4 py-5 text-sm text-[#7a7b86]">
          No matches yet. {tidalConnected ? 'Try another term or run the TIDAL search.' : 'Connect TIDAL to widen the catalog.'}
        </div>
      ) : null}
    </div>
  )
}

function TrackGrid({
  tracks,
  playContext,
  highlightedImportIds = [],
}: {
  tracks: Track[]
  playContext: 'library' | 'search-local' | 'search-tidal' | 'app-playlist' | 'tidal-playlist'
  highlightedImportIds?: string[]
}) {
  const playTracks = usePlaybackSessionStore((state) => state.playTracks)

  return (
    <div className="grid grid-cols-3 gap-3">
      {tracks.map((track, index) => (
        <RecentTrackCard
          key={`${track.id}-${index}`}
          track={track}
          highlighted={highlightedImportIds.includes(track.id)}
          onClick={() => playTracks(tracks, playContext, index)}
        />
      ))}
    </div>
  )
}

function RecentTrackCard({ track, onClick, highlighted = false }: { track: Track; onClick: () => void; highlighted?: boolean }) {
  const artworkUrl = useTrackArtworkUrl(track)
  return (
    <button type="button" onClick={onClick} className="group flex min-w-0 flex-col gap-2 text-left">
      <div className={`overflow-hidden rounded-[20px] border bg-white ${highlighted ? 'border-[#f4aebb] ring-2 ring-[#fff0f3]' : 'border-black/8'}`}>
        <div className="aspect-square w-full">
          {artworkUrl ? (
            <img src={artworkUrl} alt="" className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]" />
          ) : (
            <GradientArtwork seed={track.title} className="h-full w-full" />
          )}
        </div>
      </div>
      <div className="min-w-0 px-1">
        <p className="truncate text-sm font-medium text-[#111116]">{track.title}</p>
        <p className="truncate text-xs text-[#7a7b86]">{track.artist}</p>
      </div>
    </button>
  )
}

function ArtistCard({
  artist,
  tracks,
  onClick,
}: {
  artist: string
  tracks: Track[]
  onClick: () => void
}) {
  const artworkUrl = useTrackArtworkUrl(tracks[0] ?? {})
  return (
    <button type="button" onClick={onClick} className="group rounded-[22px] border border-black/8 bg-white p-3 text-left transition-colors hover:bg-[#fafafb]">
      <div className="overflow-hidden rounded-[18px]">
        <div className="aspect-square w-full">
          {artworkUrl ? (
            <img src={artworkUrl} alt="" className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]" />
          ) : (
            <GradientArtwork seed={artist} className="h-full w-full" />
          )}
        </div>
      </div>
      <div className="mt-3 min-w-0">
        <p className="truncate text-sm font-medium text-[#111116]">{artist}</p>
        <p className="truncate text-xs text-[#7a7b86]">{tracks.length} tracks</p>
      </div>
    </button>
  )
}

function ArtistRow({
  artist,
  tracks,
  onOpen,
}: {
  artist: string
  tracks: Track[]
  onOpen: () => void
}) {
  const artworkUrl = useTrackArtworkUrl(tracks[0] ?? {})
  return (
    <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-[#fafafb]">
      <div className="h-11 w-11 shrink-0 overflow-hidden rounded-xl bg-[#f1f1f4]">
        {artworkUrl ? (
          <img src={artworkUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <GradientArtwork seed={artist} className="h-full w-full" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-[#111116]">{artist}</p>
        <p className="truncate text-xs text-[#7a7b86]">{tracks.length} tracks</p>
      </div>
      <ChevronRight size={16} className="text-[#9ea0aa]" />
    </button>
  )
}

function PlaylistCard({
  playlist,
  active,
  onOpen,
  onPlay,
}: {
  playlist: Playlist & { label: string; trackCount: number; sourceKind: 'app' | 'tidal' }
  active: boolean
  onOpen: () => void
  onPlay: () => void
}) {
  return (
    <article className={`rounded-[24px] border p-4 transition-colors ${active ? 'border-accent/22 bg-accent/5' : 'border-black/8 bg-white hover:bg-[#fafafb]'}`}>
      <div className="grid grid-cols-2 gap-1 overflow-hidden rounded-[18px] bg-[#f3f3f6]">
        <GradientArtwork seed={`${playlist.name}-a`} className="aspect-square" />
        <GradientArtwork seed={`${playlist.name}-b`} className="aspect-square" />
        <GradientArtwork seed={`${playlist.name}-c`} className="aspect-square" />
        <GradientArtwork seed={`${playlist.name}-d`} className="aspect-square" />
      </div>
      <div className="mt-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-[#111116]">{playlist.name}</p>
          <p className="mt-1 text-xs text-[#7a7b86]">
            {playlist.trackCount} tracks · {playlist.label}
          </p>
        </div>
        <button type="button" onClick={onPlay} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-black/8 bg-[#f8f8f9] text-[#555661] transition-colors hover:text-[#111116]">
          <Play size={14} />
        </button>
      </div>
      <button
        type="button"
        onClick={onOpen}
        className="mt-4 inline-flex items-center gap-2 rounded-full border border-black/8 bg-white px-3 py-2 text-sm text-[#555661] transition-colors hover:border-black/14 hover:text-[#111116]"
      >
        Open collection
        <ChevronRight size={14} />
      </button>
    </article>
  )
}

function PlaylistRow({
  playlist,
  active,
  onOpen,
  onPlay,
}: {
  playlist: Playlist & { label: string; trackCount: number; sourceKind: 'app' | 'tidal' }
  active: boolean
  onOpen: () => void
  onPlay: () => void
}) {
  return (
    <article className={`flex items-center gap-3 px-5 py-3 transition-colors ${active ? 'bg-[#fff4f6]' : 'hover:bg-[#fafafb]'}`}>
      <button type="button" onClick={onOpen} className="grid h-12 w-12 shrink-0 grid-cols-2 gap-0.5 overflow-hidden rounded-xl bg-[#f3f3f6]">
        <GradientArtwork seed={`${playlist.name}-a`} className="h-full w-full" />
        <GradientArtwork seed={`${playlist.name}-b`} className="h-full w-full" />
        <GradientArtwork seed={`${playlist.name}-c`} className="h-full w-full" />
        <GradientArtwork seed={`${playlist.name}-d`} className="h-full w-full" />
      </button>
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <p className="truncate text-sm font-medium text-[#111116]">{playlist.name}</p>
        <p className="truncate text-xs text-[#7a7b86]">{playlist.trackCount} tracks · {playlist.label}</p>
      </button>
      <button type="button" onClick={onPlay} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-black/8 bg-[#f8f8f9] text-[#555661] transition-colors hover:text-[#111116]">
        <Play size={14} />
      </button>
      <button type="button" onClick={onOpen} className="rounded-full p-2 text-[#9ea0aa] transition-colors hover:bg-black/4 hover:text-[#111116]" aria-label={`Open ${playlist.name}`}>
        <ChevronRight size={16} />
      </button>
    </article>
  )
}

function LibraryDetailView({
  detail,
  artistTracks,
  playlistRow,
  playlistDetail,
  appPlaylist,
  appPlaylistTracks,
  tidalDetail,
  viewMode,
  sort,
  onBack,
  onPlayPlaylist,
  onRenameAppPlaylist,
  onDeleteAppPlaylist,
  onMoveItem,
  onRemoveItem,
}: {
  detail: LibraryDetail
  artistTracks: Track[]
  playlistRow?: Playlist & { label: string; trackCount: number; sourceKind: 'app' | 'tidal' }
  playlistDetail: Extract<LibraryDetail, { kind: 'playlist' }> | null
  appPlaylist?: Playlist
  appPlaylistTracks: Array<{ item: Playlist['items'][number]; track: Track; index: number }>
  tidalDetail?: { playlist: Playlist; tracks: Track[] }
  viewMode: LibraryViewMode
  sort: LibrarySort
  onBack: () => void
  onPlayPlaylist: (kind: 'app' | 'tidal', playlistId: string, tracks: Track[]) => void
  onRenameAppPlaylist: (playlistId: string, currentName: string, currentDescription?: string) => void
  onDeleteAppPlaylist: (playlistId: string) => void
  onMoveItem: (playlistId: string, fromIndex: number, toIndex: number) => void
  onRemoveItem: (playlist: Playlist, item: Playlist['items'][number], index: number) => void
}) {
  if (detail.kind === 'artist') {
    return (
      <div className="space-y-4">
        <DetailBackBar title={detail.artist} onBack={onBack} />
        {viewMode === 'grid' ? (
          <TrackGrid tracks={artistTracks} playContext="library" />
        ) : (
          <PlainListCard>
            <div className="divide-y divide-black/6">
              {artistTracks.map((track, index) => (
                <TrackRow key={track.id} track={track} tracks={artistTracks} playContext="library" index={index} />
              ))}
            </div>
          </PlainListCard>
        )}
      </div>
    )
  }

  if (!playlistDetail) return null

  return (
    <PlaylistDetailView
      playlistDetail={playlistDetail}
      playlistRow={playlistRow}
      appPlaylist={appPlaylist}
      appPlaylistTracks={appPlaylistTracks}
      tidalDetail={tidalDetail}
      viewMode={viewMode}
      sort={sort}
      onBack={onBack}
      onPlayPlaylist={onPlayPlaylist}
      onRenameAppPlaylist={onRenameAppPlaylist}
      onDeleteAppPlaylist={onDeleteAppPlaylist}
      onMoveItem={onMoveItem}
      onRemoveItem={onRemoveItem}
    />
  )
}

function DetailBackBar({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-black/8 bg-white text-[#555661] transition-colors hover:border-black/14 hover:text-[#111116]"
        aria-label="Back"
      >
        <ArrowLeft size={16} />
      </button>
      <h2 className="min-w-0 truncate text-lg font-semibold text-[#111116]">{title}</h2>
    </div>
  )
}

function PlaylistDetailView({
  playlistDetail,
  playlistRow,
  appPlaylist,
  appPlaylistTracks,
  tidalDetail,
  viewMode,
  sort,
  onBack,
  onPlayPlaylist,
  onRenameAppPlaylist,
  onDeleteAppPlaylist,
  onMoveItem,
  onRemoveItem,
}: {
  playlistDetail: Extract<LibraryDetail, { kind: 'playlist' }>
  playlistRow?: Playlist & { label: string; trackCount: number; sourceKind: 'app' | 'tidal' }
  appPlaylist?: Playlist
  appPlaylistTracks: Array<{ item: Playlist['items'][number]; track: Track; index: number }>
  tidalDetail?: { playlist: Playlist; tracks: Track[] }
  viewMode: LibraryViewMode
  sort: LibrarySort
  onBack: () => void
  onPlayPlaylist: (kind: 'app' | 'tidal', playlistId: string, tracks: Track[]) => void
  onRenameAppPlaylist: (playlistId: string, currentName: string, currentDescription?: string) => void
  onDeleteAppPlaylist: (playlistId: string) => void
  onMoveItem: (playlistId: string, fromIndex: number, toIndex: number) => void
  onRemoveItem: (playlist: Playlist, item: Playlist['items'][number], index: number) => void
}) {
  const displayedAppPlaylistTracks = playlistDetail.playlistKind === 'app'
    ? (
        sort === 'recent'
          ? appPlaylistTracks
          : appPlaylistTracks.slice().sort((left, right) => {
              if (sort === 'title') return left.track.title.localeCompare(right.track.title)
              if (sort === 'artist') return left.track.artist.localeCompare(right.track.artist) || left.track.title.localeCompare(right.track.title)
              return left.index - right.index
            })
      )
    : []
  const tracks = playlistDetail.playlistKind === 'app'
    ? displayedAppPlaylistTracks.map((entry) => entry.track)
    : sort === 'recent'
      ? tidalDetail?.tracks || []
      : sortTracks(tidalDetail?.tracks || [], sort)

  if (playlistDetail.playlistKind === 'app' && !appPlaylist) {
    return <div className="rounded-[24px] border border-black/8 bg-white px-4 py-4 text-sm text-[#7a7b86]">Playlist not found.</div>
  }

  if (playlistDetail.playlistKind === 'tidal' && !tidalDetail) {
    return <div className="rounded-[24px] border border-black/8 bg-white px-4 py-4 text-sm text-[#7a7b86]">Loading TIDAL playlist…</div>
  }

  const playlist = playlistDetail.playlistKind === 'app' ? appPlaylist! : tidalDetail!.playlist
  const title = playlist.name || playlistRow?.name || 'Playlist'

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <DetailBackBar title={title} onBack={onBack} />
        <div className="flex flex-wrap gap-2">
          <ActionButton accent icon={<Play size={15} />} onClick={() => onPlayPlaylist(playlistDetail.playlistKind, playlist.id, tracks)}>
            Play all
          </ActionButton>
          {playlistDetail.playlistKind === 'app' ? (
            <>
              <ActionButton icon={<Settings size={15} />} onClick={() => onRenameAppPlaylist(playlist.id, playlist.name, playlist.description)}>
                Rename
              </ActionButton>
              <ActionButton icon={<Settings size={15} />} onClick={() => onDeleteAppPlaylist(playlist.id)}>
                Delete
              </ActionButton>
            </>
          ) : null}
        </div>
      </div>

      {tracks.length === 0 ? (
        <div className="rounded-[24px] border border-black/8 bg-white px-4 py-5 text-sm text-[#7a7b86]">
          This playlist is empty.
        </div>
      ) : (
        viewMode === 'grid' ? (
          <TrackGrid tracks={tracks} playContext={playlistDetail.playlistKind === 'app' ? 'app-playlist' : 'tidal-playlist'} />
        ) : (
          <div className="divide-y divide-black/6 rounded-[24px] border border-black/8 bg-white">
          {playlistDetail.playlistKind === 'app'
            ? displayedAppPlaylistTracks.map(({ item, track, index }, displayIndex) => {
                const extraActions: TrackAction[] = [
                  {
                    label: 'Remove from playlist',
                    onClick: () => onRemoveItem(playlist, item, index),
                    destructive: true,
                  },
                ]

                if (sort === 'recent' && index > 0) {
                  extraActions.unshift({
                    label: 'Move earlier',
                    onClick: () => onMoveItem(playlist.id, index, index - 1),
                  })
                }

                if (sort === 'recent' && index < appPlaylistTracks.length - 1) {
                  extraActions.unshift({
                    label: 'Move later',
                    onClick: () => onMoveItem(playlist.id, index, index + 1),
                  })
                }

                return (
                  <TrackRow
                    key={`${track.id}-${index}`}
                    track={track}
                    tracks={tracks}
                    playContext="app-playlist"
                    index={displayIndex}
                    extraActions={extraActions}
                  />
                )
              })
            : tracks.map((track, index) => (
                <TrackRow
                  key={`${track.id}-${index}`}
                  track={track}
                  tracks={tracks}
                  playContext="tidal-playlist"
                  index={index}
                />
              ))}
          </div>
        )
      )}
    </div>
  )
}

function GradientArtwork({ seed, className = '' }: { seed: string; className?: string }) {
  return (
    <div
      className={className}
      style={{
        background: gradientForSeed(seed),
      }}
    />
  )
}

function gradientForSeed(seed: string) {
  const gradients = [
    'linear-gradient(135deg, #f3b27a, #c97a3c 60%, #3a1f10)',
    'linear-gradient(135deg, #ef5466, #8d3140 70%, #1a0a0e)',
    'linear-gradient(135deg, #22d3ee, #0e7490 70%, #05343f)',
    'linear-gradient(135deg, #1e2230, #0a0c12)',
    'linear-gradient(135deg, #f97316, #c2410c 55%, #2f1205)',
    'linear-gradient(135deg, #f8fafc, #94a3b8 58%, #0f172a)',
  ]
  const index = seed.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0) % gradients.length
  return gradients[index]
}

async function renamePlaylist(
  playlistId: string,
  currentName: string,
  currentDescription: string | undefined,
  renameAppPlaylist: (id: string, name: string, description?: string) => Promise<void>,
) {
  const nextName = window.prompt('Rename playlist', currentName)
  if (!nextName?.trim()) return
  await renameAppPlaylist(playlistId, nextName.trim(), currentDescription || '')
}
