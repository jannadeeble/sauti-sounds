import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import {
  Bell,
  Bot,
  ChevronRight,
  Disc3,
  FolderOpen,
  Library,
  ListMusic,
  Play,
  Plus,
  Radio,
  Search,
  Settings,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react'
import AIChatPanel from './AIChatPanel'
import BottomSheet from './BottomSheet'
import HomeFeed from './HomeFeed'
import ImportPanel, { type ImportDoneResult } from './ImportPanel'
import NotificationCenter from './NotificationCenter'
import PlaylistFooterSuggestions from './PlaylistFooterSuggestions'
import SettingsPanel from './SettingsPanel'
import TrackRow, { type TrackAction } from './TrackRow'
import WorkspacePlayer from './WorkspacePlayer'
import { useTrackArtworkUrl } from '../lib/artwork'
import { useLibraryStore } from '../stores/libraryStore'
import { useNotificationStore } from '../stores/notificationStore'
import { usePlaybackSessionStore } from '../stores/playbackSessionStore'
import { usePlaylistStore } from '../stores/playlistStore'
import { searchTidal } from '../lib/tidal'
import { useTidalStore } from '../stores/tidalStore'
import type { Playlist, Track } from '../types'

type WorkspaceTab = 'library' | 'playlists' | 'search'
type LibraryFilter = 'all' | 'local' | 'tidal'
type LibrarySort = 'recent' | 'title' | 'artist'

const EMPTY_ARTWORK = { artworkBlob: undefined, artworkUrl: undefined }
const panelClass = 'rounded-[28px] border border-black/8 bg-white shadow-[0_1px_0_rgba(17,17,22,0.03)]'
const mutedPanelClass = 'rounded-[22px] border border-black/6 bg-[#f8f8f9]'

interface HeroAction {
  label: string
  icon: ReactNode
  onClick: () => void
  accent?: boolean
  disabled?: boolean
}

function formatPlaylistCount(playlist: Playlist) {
  return playlist.trackCount ?? playlist.items.length
}

export default function WorkspaceShell() {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('library')
  const [showImport, setShowImport] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showAI, setShowAI] = useState(false)
  const [showNotifications, setShowNotifications] = useState(false)
  const unreadNotifications = useNotificationStore((state) =>
    state.notifications.filter((n) => !n.read).length,
  )
  const [libraryFilter, setLibraryFilter] = useState<LibraryFilter>('all')
  const [librarySort, setLibrarySort] = useState<LibrarySort>('recent')
  const [query, setQuery] = useState('')
  const [tidalResults, setTidalResults] = useState<Track[]>([])
  const [tidalLoading, setTidalLoading] = useState(false)
  const [tidalSearched, setTidalSearched] = useState(false)
  const [importNotice, setImportNotice] = useState<string | null>(null)
  const [highlightedImportIds, setHighlightedImportIds] = useState<string[]>([])
  const mainContentRef = useRef<HTMLElement | null>(null)

  const tracks = useLibraryStore((state) => state.tracks)
  const libraryLoading = useLibraryStore((state) => state.loading)
  const loadTracks = useLibraryStore((state) => state.loadTracks)
  const cacheTidalTracks = useLibraryStore((state) => state.cacheTidalTracks)
  const importFiles = useLibraryStore((state) => state.importFiles)
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
    loading: playlistsLoading,
    moveAppPlaylistItem,
    removeTrackFromPlaylist,
    renameAppPlaylist,
  } = usePlaylistStore()

  const tidalConnected = useTidalStore((state) => state.tidalConnected)

  const selectedPlaylist = usePlaybackSessionStore((state) => state.selectedPlaylist)
  const selectPlaylist = usePlaybackSessionStore((state) => state.selectPlaylist)
  const playPlaylist = usePlaybackSessionStore((state) => state.playPlaylist)
  const playTracks = usePlaybackSessionStore((state) => state.playTracks)
  const errorMessage = usePlaybackSessionStore((state) => state.errorMessage)
  const currentTrack = usePlaybackSessionStore((state) => state.currentTrack)
  const isPlaying = usePlaybackSessionStore((state) => state.isPlaying)

  useEffect(() => {
    void loadTracks()
    void loadPlaylists()
  }, [loadPlaylists, loadTracks])

  useEffect(() => {
    if (selectedPlaylist?.kind === 'tidal' && !tidalPlaylistDetails[selectedPlaylist.id]) {
      void loadTidalPlaylistDetail(selectedPlaylist.id)
    }
  }, [loadTidalPlaylistDetail, selectedPlaylist, tidalPlaylistDetails])

  useEffect(() => {
    if (!importNotice && highlightedImportIds.length === 0) return

    const timeoutId = window.setTimeout(() => {
      setImportNotice(null)
      setHighlightedImportIds([])
    }, 4200)

    return () => window.clearTimeout(timeoutId)
  }, [highlightedImportIds, importNotice])

  const sortedTracks = useMemo(() => {
    const filtered = tracks.filter((track) => {
      if (libraryFilter === 'all') return true
      return track.source === libraryFilter
    })

    const next = [...filtered]
    if (librarySort === 'title') {
      next.sort((left, right) => left.title.localeCompare(right.title))
    } else if (librarySort === 'artist') {
      next.sort((left, right) => left.artist.localeCompare(right.artist))
    } else {
      next.sort((left, right) => (right.addedAt || 0) - (left.addedAt || 0))
    }

    return next
  }, [libraryFilter, librarySort, tracks])

  const localSearchResults = useMemo(() => {
    if (!query.trim()) return []
    const needle = query.toLowerCase()
    return tracks.filter((track) =>
      [track.title, track.artist, track.album, track.genre]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(needle)),
    )
  }, [query, tracks])

  const selectedAppPlaylist = selectedPlaylist?.kind === 'app'
    ? appPlaylists.find((playlist) => playlist.id === selectedPlaylist.id)
    : undefined

  const trackById = useMemo(() => new Map(tracks.map((track) => [track.id, track])), [tracks])
  const providerTrackById = useMemo(
    () => new Map(tracks.filter((track) => track.providerTrackId).map((track) => [track.providerTrackId!, track])),
    [tracks],
  )

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

  const selectedTidalDetail = selectedPlaylist?.kind === 'tidal'
    ? tidalPlaylistDetails[selectedPlaylist.id]
    : undefined

  const heroTrack =
    currentTrack
    ?? (selectedPlaylist?.kind === 'app' ? appPlaylistTracks[0]?.track : selectedTidalDetail?.tracks[0])
    ?? (activeTab === 'search' ? localSearchResults[0] ?? tidalResults[0] : sortedTracks[0])
    ?? null
  const heroArtwork = useTrackArtworkUrl(heroTrack ?? EMPTY_ARTWORK)

  const localTrackCount = tracks.filter((track) => track.source === 'local').length
  const tidalTrackCount = tracks.length - localTrackCount
  const desktopPlaylistLinks = appPlaylists.slice(0, 6)

  async function handleTidalSearch() {
    if (!query.trim() || !tidalConnected) return

    setTidalLoading(true)
    setTidalSearched(true)

    try {
      const results = await searchTidal(query)
      setTidalResults(results.tracks)
      await cacheTidalTracks(results.tracks)
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
      selectPlaylist({ kind: 'app', id: playlist.id })
      setActiveTab('playlists')
      return
    }

    const playlist = await createProviderPlaylist(name.trim())
    if (playlist.providerPlaylistId) {
      selectPlaylist({ kind: 'tidal', id: playlist.providerPlaylistId })
      setActiveTab('playlists')
    }
  }

  function handlePlaylistPlayback(kind: 'app' | 'tidal', playlistId: string, playlistTracks: Track[]) {
    if (playlistTracks.length === 0) return
    playPlaylist(kind, playlistId, playlistTracks, 0)
  }

  function handleSearchChange(value: string) {
    setQuery(value)
    setTidalSearched(false)
    if (value.trim()) {
      setActiveTab('search')
    }
  }

  function finalizeImport(result?: ImportDoneResult) {
    const importedTracks = result?.importedTracks ?? []

    setShowImport(false)
    setActiveTab('library')
    selectPlaylist(undefined)
    setLibraryFilter('all')
    setLibrarySort('recent')

    if (importedTracks.length > 0) {
      playTracks(importedTracks, 'library', 0)
      setHighlightedImportIds(importedTracks.map((track) => track.id))
      setImportNotice(
        importedTracks.length === 1
          ? `Imported and queued "${importedTracks[0].title}".`
          : `Imported and queued ${importedTracks.length} tracks.`,
      )
    }

    void loadTracks()
    void loadPlaylists()

    window.requestAnimationFrame(() => {
      mainContentRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
    })
  }

  async function handleQuickImport() {
    if (!('showOpenFilePicker' in window)) {
      setShowImport(true)
      return
    }

    const importedTracks = await importFiles()
    if (importedTracks.length > 0) {
      finalizeImport({ importedTracks })
    }
  }

  const hero = useMemo(() => {
    if (activeTab === 'playlists' && selectedPlaylist) {
      const playlist = selectedPlaylist.kind === 'app'
        ? selectedAppPlaylist
        : selectedTidalDetail?.playlist || tidalPlaylists.find((item) => item.providerPlaylistId === selectedPlaylist.id)
      const playlistTracks = selectedPlaylist.kind === 'app'
        ? appPlaylistTracks.map((entry) => entry.track)
        : selectedTidalDetail?.tracks || []

      return {
        eyebrow: selectedPlaylist.kind === 'app' ? 'App playlist' : 'TIDAL playlist',
        title: playlist?.name || 'Playlist',
        meta: `${playlistTracks.length} tracks${selectedPlaylist.kind === 'tidal' ? ' • synced from TIDAL' : ''}`,
        description: playlist?.description || 'Classic Deezer-style playlist view with the queue ready to play.',
        actions: [
          {
            label: 'Play all',
            icon: <Play size={15} />,
            onClick: () => {
              if (selectedPlaylist.kind === 'app') handlePlaylistPlayback('app', playlist?.id || '', playlistTracks)
              else handlePlaylistPlayback('tidal', selectedPlaylist.id, playlistTracks)
            },
            accent: true,
            disabled: playlistTracks.length === 0,
          },
          {
            label: 'Back to playlists',
            icon: <ListMusic size={15} />,
            onClick: () => selectPlaylist(undefined),
          },
        ] satisfies HeroAction[],
      }
    }

    if (activeTab === 'playlists') {
      return {
        eyebrow: 'Collections',
        title: 'Playlists',
        meta: `${appPlaylists.length} app • ${tidalPlaylists.length} TIDAL`,
        description: 'Mixed playlists stay editable while remote TIDAL collections sit beside them in the same library.',
        actions: [
          {
            label: 'New app playlist',
            icon: <Plus size={15} />,
            onClick: () => void handleCreatePlaylist('app'),
            accent: true,
          },
          {
            label: tidalConnected ? 'New TIDAL playlist' : 'Import music',
            icon: tidalConnected ? <Radio size={15} /> : <FolderOpen size={15} />,
            onClick: tidalConnected ? () => void handleCreatePlaylist('tidal') : () => setShowImport(true),
          },
        ] satisfies HeroAction[],
      }
    }

    if (activeTab === 'search') {
      return {
        eyebrow: 'Discovery',
        title: query.trim() ? `Search “${query}”` : 'Search',
        meta: query.trim()
          ? `${localSearchResults.length} local results${tidalConnected && tidalSearched ? ` • ${tidalResults.length} TIDAL results` : ''}`
          : 'Search artists, tracks, playlists, and imports',
        description: query.trim()
          ? 'Local results appear instantly, with TIDAL matches available on demand.'
          : 'The old Deezer pattern puts search at the top of the experience. Type once and jump directly into results.',
        actions: query.trim() && tidalConnected
          ? [
              {
                label: tidalLoading ? 'Searching TIDAL…' : 'Search TIDAL',
                icon: <Radio size={15} />,
                onClick: () => void handleTidalSearch(),
                accent: true,
                disabled: tidalLoading,
              },
            ]
          : [],
      }
    }

    return {
      eyebrow: currentTrack ? 'Now playing' : 'My music',
      title: currentTrack ? currentTrack.title : 'Library',
      meta: currentTrack
        ? `${currentTrack.artist}${currentTrack.album ? ` • ${currentTrack.album}` : ''}`
        : `${tracks.length} tracks • ${localTrackCount} local • ${tidalTrackCount} TIDAL`,
      description: currentTrack
        ? `Pulled from your ${isPlaying ? 'active queue' : 'library'} and shown in a Deezer-style editorial layout.`
        : 'A cleaner old-Deezer-inspired library surface for local files, TIDAL caches, playlists, and search.',
      actions: [
        sortedTracks.length > 0
          ? {
              label: 'Play library',
              icon: <Play size={15} />,
              onClick: () => playTracks(sortedTracks, 'library', 0),
              accent: true,
            }
          : {
              label: 'Import music',
              icon: <FolderOpen size={15} />,
              onClick: () => void handleQuickImport(),
              accent: true,
            },
        {
          label: 'Ask Sauti',
          icon: <Sparkles size={15} />,
          onClick: () => setShowAI(true),
        },
      ] satisfies HeroAction[],
    }
  }, [
    activeTab,
    appPlaylistTracks,
    appPlaylists.length,
    currentTrack,
    handleTidalSearch,
    handleQuickImport,
    isPlaying,
    localSearchResults.length,
    localTrackCount,
    playTracks,
    query,
    selectedAppPlaylist,
    selectedPlaylist,
    selectedTidalDetail,
    sortedTracks,
    tidalConnected,
    tidalLoading,
    tidalPlaylists,
    tidalResults.length,
    tidalSearched,
    tidalTrackCount,
    tracks.length,
  ])

  return (
    <div className="workspace-shell">
      <div className="mx-auto flex h-full max-w-[1560px] flex-col lg:grid lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="hidden min-h-0 flex-col border-r border-black/8 bg-[#fbfbfc] lg:flex">
          <div className="px-6 pb-8 pt-7">
            <BrandMark />
          </div>

          <nav className="space-y-1 px-4">
            <SidebarNavButton
              label="Library"
              icon={<Library size={18} />}
              active={activeTab === 'library'}
              onClick={() => {
                setActiveTab('library')
                selectPlaylist(undefined)
              }}
            />
            <SidebarNavButton
              label="Playlists"
              icon={<ListMusic size={18} />}
              active={activeTab === 'playlists'}
              onClick={() => setActiveTab('playlists')}
            />
            <SidebarNavButton
              label="Search"
              icon={<Search size={18} />}
              active={activeTab === 'search'}
              onClick={() => setActiveTab('search')}
            />
          </nav>

          <section className="mt-8 px-6">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-[11px] uppercase tracking-[0.24em] text-[#8b8c95]">Playlists</p>
              <span className="text-xs text-[#8b8c95]">{appPlaylists.length}</span>
            </div>
            <div className="space-y-1.5">
              {desktopPlaylistLinks.length === 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('playlists')
                    void handleCreatePlaylist('app')
                  }}
                  className="flex w-full items-center justify-between rounded-2xl border border-dashed border-black/10 px-4 py-3 text-left text-sm text-[#686973] transition-colors hover:border-black/16 hover:bg-white"
                >
                  <span>Create your first playlist</span>
                  <Plus size={14} />
                </button>
              ) : (
                desktopPlaylistLinks.map((playlist) => (
                  <button
                    key={playlist.id}
                    type="button"
                    onClick={() => {
                      setActiveTab('playlists')
                      selectPlaylist({ kind: 'app', id: playlist.id })
                    }}
                    className={`flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left transition-colors ${
                      selectedPlaylist?.kind === 'app' && selectedPlaylist.id === playlist.id
                        ? 'bg-[#fce5e8] text-[#111116]'
                        : 'text-[#686973] hover:bg-white'
                    }`}
                  >
                    <span className="truncate text-sm">{playlist.name}</span>
                    <span className="text-xs">{formatPlaylistCount(playlist)}</span>
                  </button>
                ))
              )}
            </div>
          </section>

          <div className="mt-auto grid gap-2 p-4">
            <SidebarUtilityButton
              label={importing && importProgress ? `Importing ${importProgress.current}/${importProgress.total}` : 'Import'}
              icon={<FolderOpen size={16} />}
              onClick={() => setShowImport(true)}
            />
            <SidebarUtilityButton
              label="Settings"
              icon={<Settings size={16} />}
              onClick={() => setShowSettings(true)}
            />
            <SidebarUtilityButton
              label="Ask Sauti"
              icon={<Bot size={16} />}
              onClick={() => setShowAI(true)}
              accent
            />
          </div>
        </aside>

        <div className="min-h-0 flex flex-col">
          <header className="border-b border-black/8 bg-[#fbfbfc]/95 backdrop-blur-md">
            <div className="px-4 py-4 lg:px-8 lg:py-5">
              <div className="flex items-center justify-between gap-3 lg:hidden">
                <div className="min-w-0">
                  <BrandMark compact />
                </div>

                <div className="flex items-center gap-2">
                  <TopbarActionButton label="Import" icon={<FolderOpen size={16} />} onClick={() => setShowImport(true)} />
                  <TopbarActionButton
                    label={unreadNotifications > 0 ? `Notifications (${unreadNotifications})` : 'Notifications'}
                    icon={<Bell size={16} />}
                    onClick={() => setShowNotifications(true)}
                    badge={unreadNotifications > 0}
                  />
                  <TopbarActionButton label="Settings" icon={<Settings size={16} />} onClick={() => setShowSettings(true)} />
                  <TopbarActionButton label="Ask Sauti" icon={<Bot size={16} />} onClick={() => setShowAI(true)} accent />
                </div>
              </div>

              <div className="mt-4 lg:hidden">
                <label className="deezer-search-shell">
                  <Search size={18} className="shrink-0 text-[#8b8c95]" />
                  <input
                    type="text"
                    value={query}
                    onChange={(event) => handleSearchChange(event.target.value)}
                    onFocus={() => setActiveTab('search')}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        void handleTidalSearch()
                      }
                    }}
                    placeholder="Artists, tracks, playlists..."
                  />
                </label>
              </div>

              <div className="hidden items-center gap-3 lg:flex">
                <label className="deezer-search-shell">
                  <Search size={18} className="shrink-0 text-[#8b8c95]" />
                  <input
                    type="text"
                    value={query}
                    onChange={(event) => handleSearchChange(event.target.value)}
                    onFocus={() => setActiveTab('search')}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        void handleTidalSearch()
                      }
                    }}
                    placeholder="Artists, tracks, playlists..."
                  />
                </label>

                <div className="flex items-center gap-2">
                  <TopbarActionButton label="Import" icon={<FolderOpen size={16} />} onClick={() => setShowImport(true)} />
                  <TopbarActionButton
                    label={unreadNotifications > 0 ? `Notifications (${unreadNotifications})` : 'Notifications'}
                    icon={<Bell size={16} />}
                    onClick={() => setShowNotifications(true)}
                    badge={unreadNotifications > 0}
                  />
                  <TopbarActionButton label="Settings" icon={<Settings size={16} />} onClick={() => setShowSettings(true)} />
                  <TopbarActionButton label="Ask Sauti" icon={<Bot size={16} />} onClick={() => setShowAI(true)} accent />
                </div>
              </div>
            </div>

            <div className="overflow-x-auto px-4 lg:hidden">
              <div className="flex min-w-max gap-6">
                <MobileNavButton label="Library" active={activeTab === 'library'} onClick={() => setActiveTab('library')} />
                <MobileNavButton label="Playlists" active={activeTab === 'playlists'} onClick={() => setActiveTab('playlists')} />
                <MobileNavButton label="Search" active={activeTab === 'search'} onClick={() => setActiveTab('search')} />
              </div>
            </div>
          </header>

          <main ref={mainContentRef} className="min-h-0 flex-1 overflow-y-auto px-4 pb-[12rem] pt-6 lg:px-8 lg:pt-8">
            <div className="space-y-8">
              <WorkspaceHero
                artworkUrl={heroArtwork}
                artworkLabel={heroTrack ? `${heroTrack.artist} - ${heroTrack.title}` : undefined}
                eyebrow={hero.eyebrow}
                title={hero.title}
                meta={hero.meta}
                description={hero.description}
                actions={hero.actions}
              />

              {errorMessage ? (
                <div className="rounded-[22px] border border-[#f4c6cc] bg-[#fff4f6] px-5 py-4 text-sm text-[#8d3140]">
                  {errorMessage}
                </div>
              ) : null}

              {importNotice ? (
                <div className="rounded-[22px] border border-[#f4c6cc] bg-[#fff4f6] px-5 py-4 text-sm text-[#8d3140]">
                  {importNotice}
                </div>
              ) : null}

              {importing && importProgress && !showImport ? (
                <div className="rounded-[22px] border border-[#f4c6cc] bg-[#fff4f6] px-5 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-[#8d3140]">Importing into your library</p>
                      <p className="mt-1 text-xs text-[#b25563]">
                        Caching audio and artwork so the new tracks can play immediately.
                      </p>
                    </div>
                    <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-[#8d3140]">
                      {importProgress.current}/{importProgress.total}
                    </span>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/80">
                    <div
                      className="h-full rounded-full bg-accent transition-[width] duration-300"
                      style={{ width: `${(importProgress.current / importProgress.total) * 100}%` }}
                    />
                  </div>
                </div>
              ) : null}

              {activeTab === 'library' ? (
                <section className="space-y-5">
                  <HomeFeed />

                  <div className={`${panelClass} px-5 py-4`}>
                    <div className="flex flex-wrap items-center gap-6">
                      <div className="flex gap-6">
                        <UnderlinedSwitch active={libraryFilter === 'all'} onClick={() => setLibraryFilter('all')}>
                          All
                        </UnderlinedSwitch>
                        <UnderlinedSwitch active={libraryFilter === 'local'} onClick={() => setLibraryFilter('local')}>
                          Local
                        </UnderlinedSwitch>
                        <UnderlinedSwitch active={libraryFilter === 'tidal'} onClick={() => setLibraryFilter('tidal')}>
                          TIDAL
                        </UnderlinedSwitch>
                      </div>

                      <label className="ml-auto inline-flex items-center gap-2 rounded-full border border-black/8 bg-[#f8f8f9] px-3 py-2 text-sm text-[#686973]">
                        <SlidersHorizontal size={14} />
                        <select
                          value={librarySort}
                          onChange={(event) => setLibrarySort(event.target.value as LibrarySort)}
                          className="bg-transparent outline-none"
                        >
                          <option value="recent">Recent</option>
                          <option value="title">Title</option>
                          <option value="artist">Artist</option>
                        </select>
                      </label>
                    </div>
                  </div>

                  {libraryLoading && sortedTracks.length === 0 ? (
                    <EmptyPanel
                      title="Loading your library..."
                      description="Reading tracks from the local cache before the list appears."
                    />
                  ) : sortedTracks.length === 0 ? (
                    <EmptyPanel
                      title="Your library is empty"
                      description="Import local files or connect TIDAL in Settings to rebuild the classic library view."
                      action={{
                        label: 'Import music',
                        icon: <FolderOpen size={15} />,
                        onClick: () => void handleQuickImport(),
                      }}
                    />
                  ) : (
                    <SurfacePanel
                      title={librarySort === 'recent' ? 'Recently added' : librarySort === 'title' ? 'A-Z' : 'Artists'}
                      meta={`${sortedTracks.length} tracks`}
                    >
                      <div className="divide-y divide-black/6">
                        {sortedTracks.map((track, index) => (
                          <TrackRow
                            key={track.id}
                            track={track}
                            tracks={sortedTracks}
                            playContext="library"
                            index={index}
                            showIndex
                            highlighted={highlightedImportIds.includes(track.id)}
                          />
                        ))}
                      </div>
                    </SurfacePanel>
                  )}
                </section>
              ) : null}

              {activeTab === 'playlists' ? (
                <section className="space-y-5">
                  {selectedPlaylist ? (
                    <PlaylistDetailView
                      selectedPlaylist={selectedPlaylist}
                      appPlaylists={appPlaylists}
                      tidalPlaylists={tidalPlaylists}
                      appPlaylistTracks={appPlaylistTracks}
                      tidalDetail={selectedTidalDetail}
                      onBack={() => selectPlaylist(undefined)}
                      onPlayAppPlaylist={(playlistId, playlistTracks) => handlePlaylistPlayback('app', playlistId, playlistTracks)}
                      onPlayTidalPlaylist={(playlistId, playlistTracks) => handlePlaylistPlayback('tidal', playlistId, playlistTracks)}
                      onRenameAppPlaylist={(playlistId, currentName, currentDescription) => void renamePlaylist(playlistId, currentName, currentDescription, renameAppPlaylist)}
                      onDeleteAppPlaylist={async (playlistId) => {
                        if (!window.confirm('Delete this playlist?')) return
                        await deleteAppPlaylist(playlistId)
                        selectPlaylist(undefined)
                      }}
                      onMoveItem={(playlistId, fromIndex, toIndex) => void moveAppPlaylistItem(playlistId, fromIndex, toIndex)}
                      onRemoveItem={(playlist, item, index) => void removeTrackFromPlaylist(playlist, item, index)}
                    />
                  ) : playlistsLoading && appPlaylists.length === 0 && tidalPlaylists.length === 0 ? (
                    <EmptyPanel
                      title="Loading playlists..."
                      description="Fetching app playlists and any connected TIDAL collections."
                    />
                  ) : (
                    <PlaylistCollectionsView
                      appPlaylists={appPlaylists}
                      tidalPlaylists={tidalPlaylists}
                      onOpen={(kind, id) => selectPlaylist({ kind, id })}
                    />
                  )}
                </section>
              ) : null}

              {activeTab === 'search' ? (
                <section className="space-y-5">
                  {!query.trim() ? (
                    <EmptyPanel
                      title="Search the catalog"
                      description="Use the top search bar to jump into local matches and optional TIDAL results."
                    />
                  ) : null}

                  {query.trim() && localSearchResults.length > 0 ? (
                    <SurfacePanel title="Library results" meta={`${localSearchResults.length} matches`}>
                      <div className="divide-y divide-black/6">
                        {localSearchResults.map((track, index) => (
                          <TrackRow
                            key={track.id}
                            track={track}
                            tracks={localSearchResults}
                            playContext="search-local"
                            index={index}
                          />
                        ))}
                      </div>
                    </SurfacePanel>
                  ) : null}

                  {query.trim() && tidalConnected ? (
                    <div className="space-y-3">
                      {!tidalSearched && !tidalLoading ? (
                        <button
                          type="button"
                          onClick={() => void handleTidalSearch()}
                          className="inline-flex items-center gap-2 rounded-full border border-[#f6c8cf] bg-[#fff4f6] px-4 py-2 text-sm text-[#b03a4d] transition-colors hover:bg-[#ffecef]"
                        >
                          <Radio size={15} />
                          Search TIDAL for "{query}"
                        </button>
                      ) : null}

                      {tidalLoading ? (
                        <div className={`${mutedPanelClass} px-4 py-4 text-sm text-[#686973]`}>
                          Searching TIDAL...
                        </div>
                      ) : null}

                      {tidalSearched && tidalResults.length > 0 ? (
                        <SurfacePanel title="TIDAL results" meta={`${tidalResults.length} matches`}>
                          <div className="divide-y divide-black/6">
                            {tidalResults.map((track, index) => (
                              <TrackRow
                                key={`${track.id}-${index}`}
                                track={track}
                                tracks={tidalResults}
                                playContext="search-tidal"
                                index={index}
                              />
                            ))}
                          </div>
                        </SurfacePanel>
                      ) : null}
                    </div>
                  ) : null}

                  {query.trim() && !localSearchResults.length && (!tidalSearched || !tidalResults.length) && !tidalLoading ? (
                    <EmptyPanel
                      title="No matches yet"
                      description={tidalConnected
                        ? 'Try another search term, or run the TIDAL search to widen the results.'
                        : 'Try another search term or connect TIDAL to widen the catalog.'}
                    />
                  ) : null}
                </section>
              ) : null}
            </div>
          </main>
        </div>
      </div>

      <WorkspacePlayer />

      <BottomSheet
        open={showImport}
        title="Import music"
        description="Bring local files or Spotify exports into the prototype."
        onClose={() => setShowImport(false)}
      >
        <ImportPanel onDone={finalizeImport} />
      </BottomSheet>

      <BottomSheet
        open={showSettings}
        title="Settings"
        description="Account, TIDAL, and AI configuration for this prototype."
        onClose={() => setShowSettings(false)}
        maxHeightClassName="max-h-[88vh]"
      >
        <SettingsPanel />
      </BottomSheet>

      <BottomSheet
        open={showAI}
        title="Sauti AI"
        description="Chat with the assistant without leaving the workspace."
        onClose={() => setShowAI(false)}
        maxHeightClassName="max-h-[88vh]"
      >
        <AIChatPanel />
      </BottomSheet>

      <NotificationCenter open={showNotifications} onClose={() => setShowNotifications(false)} />
    </div>
  )
}

function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`flex items-center gap-3 ${compact ? 'min-w-0' : ''}`}>
      <div className="deezer-brand-bars" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
        <span />
      </div>
      <div className={`deezer-display ${compact ? 'text-[1.35rem] sm:text-[1.6rem]' : 'text-[2.15rem]'} leading-none text-[#111116]`}>
        sauti
      </div>
    </div>
  )
}

function SidebarNavButton({
  label,
  icon,
  active,
  onClick,
}: {
  label: string
  icon: ReactNode
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm font-medium transition-colors ${
        active
          ? 'bg-[#fce5e8] text-[#111116]'
          : 'text-[#555661] hover:bg-white hover:text-[#111116]'
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}

function SidebarUtilityButton({
  label,
  icon,
  onClick,
  accent = false,
}: {
  label: string
  icon: ReactNode
  onClick: () => void
  accent?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center justify-between gap-2 rounded-2xl px-4 py-3 text-sm transition-colors ${
        accent
          ? 'bg-[#ef5466] text-white hover:bg-[#e0364a]'
          : 'border border-black/8 bg-white text-[#111116] hover:bg-[#f8f8f9]'
      }`}
    >
      <span className="inline-flex items-center gap-2 truncate">
        {icon}
        <span className="truncate">{label}</span>
      </span>
      <ChevronRight size={14} className={accent ? 'opacity-80' : 'text-[#7a7b86]'} />
    </button>
  )
}

function TopbarActionButton({
  label,
  icon,
  onClick,
  accent = false,
  badge = false,
}: {
  label: string
  icon: ReactNode
  onClick: () => void
  accent?: boolean
  badge?: boolean
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`relative inline-flex h-10 w-10 items-center justify-center rounded-full border transition-colors sm:h-11 sm:w-11 ${
        accent
          ? 'border-transparent bg-[#ef5466] text-white hover:bg-[#e0364a]'
          : 'border-black/8 bg-white text-[#111116] hover:border-black/12 hover:bg-[#f8f8f9]'
      }`}
    >
      {icon}
      {badge ? (
        <span className="absolute -right-0.5 -top-0.5 inline-block h-2.5 w-2.5 rounded-full bg-[#ef5466] ring-2 ring-white" />
      ) : null}
    </button>
  )
}

function MobileNavButton({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button type="button" className="deezer-tab-link text-sm font-medium" data-active={active} onClick={onClick}>
      {label}
    </button>
  )
}

function UnderlinedSwitch({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button type="button" className="deezer-tab-link text-sm font-medium" data-active={active} onClick={onClick}>
      {children}
    </button>
  )
}

function WorkspaceHero({
  artworkUrl,
  artworkLabel,
  eyebrow,
  title,
  meta,
  description,
  actions,
}: {
  artworkUrl?: string
  artworkLabel?: string
  eyebrow: string
  title: string
  meta: string
  description: string
  actions: HeroAction[]
}) {
  return (
    <section className={`${panelClass} overflow-hidden`}>
      <div className="grid gap-8 px-6 py-6 sm:px-8 sm:py-8 lg:grid-cols-[220px_minmax(0,1fr)] lg:items-center">
        <div className="mx-auto flex h-[180px] w-[180px] items-center justify-center overflow-hidden rounded-[40px] bg-[#111116] text-white lg:h-[220px] lg:w-[220px]">
          {artworkUrl ? (
            <img src={artworkUrl} alt={artworkLabel || ''} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_top,#32323d,#121216)]">
              <Disc3 size={56} className="text-white/80" />
            </div>
          )}
        </div>

        <div className="min-w-0">
          <p className="mb-3 text-[11px] uppercase tracking-[0.26em] text-[#8b8c95]">{eyebrow}</p>
          <h1 className="deezer-display text-[2.9rem] leading-[0.95] text-[#111116] sm:text-[4rem]">
            {title}
          </h1>
          <p className="mt-3 text-sm font-medium text-[#686973]">{meta}</p>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-[#686973]">{description}</p>

          {actions.length > 0 ? (
            <div className="mt-6 flex flex-wrap gap-3">
              {actions.map((action) => (
                <ActionPill key={action.label} {...action} />
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  )
}

function ActionPill({ label, icon, onClick, accent = false, disabled = false }: HeroAction) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-medium transition-colors disabled:opacity-40 ${
        accent
          ? 'bg-[#ef5466] text-white hover:bg-[#e0364a]'
          : 'border border-black/8 bg-white text-[#111116] hover:bg-[#f8f8f9]'
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}

function SurfacePanel({
  title,
  meta,
  children,
}: {
  title: string
  meta?: string
  children: ReactNode
}) {
  return (
    <section className={panelClass}>
      <div className="flex items-center justify-between px-5 pb-3 pt-5 sm:px-6">
        <div>
          <h2 className="deezer-display text-[1.7rem] leading-none text-[#111116]">{title}</h2>
          {meta ? <p className="mt-1 text-sm text-[#7a7b86]">{meta}</p> : null}
        </div>
      </div>
      <div>{children}</div>
    </section>
  )
}

function EmptyPanel({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action?: { label: string; icon: ReactNode; onClick: () => void }
}) {
  return (
    <section className={`${panelClass} px-6 py-14 text-center sm:px-10`}>
      <h2 className="deezer-display text-[2rem] leading-none text-[#111116]">{title}</h2>
      <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-[#686973]">{description}</p>
      {action ? (
        <div className="mt-6">
          <ActionPill label={action.label} icon={action.icon} onClick={action.onClick} accent />
        </div>
      ) : null}
    </section>
  )
}

function PlaylistCollectionsView({
  appPlaylists,
  tidalPlaylists,
  onOpen,
}: {
  appPlaylists: Playlist[]
  tidalPlaylists: Playlist[]
  onOpen: (kind: 'app' | 'tidal', id: string) => void
}) {
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <section className={panelClass}>
        <div className="flex items-center justify-between px-5 pb-3 pt-5 sm:px-6">
          <div>
            <h2 className="deezer-display text-[1.7rem] leading-none text-[#111116]">App playlists</h2>
            <p className="mt-1 text-sm text-[#7a7b86]">{appPlaylists.length} editable mixes</p>
          </div>
        </div>

        {appPlaylists.length === 0 ? (
          <div className="px-5 pb-6 sm:px-6">
            <div className={`${mutedPanelClass} px-4 py-5 text-sm text-[#686973]`}>
              No app playlists yet. Create one and it will appear here like an old Deezer collection list.
            </div>
          </div>
        ) : (
          <div className="divide-y divide-black/6">
            {appPlaylists.map((playlist) => (
              <button
                key={playlist.id}
                type="button"
                onClick={() => onOpen('app', playlist.id)}
                className="flex w-full items-center justify-between px-5 py-4 text-left transition-colors hover:bg-[#fafafb] sm:px-6"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[#111116]">{playlist.name}</p>
                  <p className="mt-1 text-xs text-[#7a7b86]">{formatPlaylistCount(playlist)} items</p>
                </div>
                <ChevronRight size={16} className="shrink-0 text-[#a2a3ad]" />
              </button>
            ))}
          </div>
        )}
      </section>

      <section className={panelClass}>
        <div className="flex items-center justify-between px-5 pb-3 pt-5 sm:px-6">
          <div>
            <h2 className="deezer-display text-[1.7rem] leading-none text-[#111116]">TIDAL playlists</h2>
            <p className="mt-1 text-sm text-[#7a7b86]">{tidalPlaylists.length} synced collections</p>
          </div>
        </div>

        {tidalPlaylists.length === 0 ? (
          <div className="px-5 pb-6 sm:px-6">
            <div className={`${mutedPanelClass} px-4 py-5 text-sm text-[#686973]`}>
              Connect TIDAL in Settings to browse remote playlists here.
            </div>
          </div>
        ) : (
          <div className="divide-y divide-black/6">
            {tidalPlaylists.map((playlist) => (
              <button
                key={playlist.id}
                type="button"
                onClick={() => playlist.providerPlaylistId && onOpen('tidal', playlist.providerPlaylistId)}
                className="flex w-full items-center justify-between px-5 py-4 text-left transition-colors hover:bg-[#fafafb] sm:px-6"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[#111116]">{playlist.name}</p>
                  <p className="mt-1 text-xs text-[#7a7b86]">
                    {playlist.trackCount || 0} tracks{playlist.writable ? '' : ' • read only'}
                  </p>
                </div>
                <ChevronRight size={16} className="shrink-0 text-[#a2a3ad]" />
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function PlaylistDetailView({
  selectedPlaylist,
  appPlaylists,
  tidalPlaylists,
  appPlaylistTracks,
  tidalDetail,
  onBack,
  onPlayAppPlaylist,
  onPlayTidalPlaylist,
  onRenameAppPlaylist,
  onDeleteAppPlaylist,
  onMoveItem,
  onRemoveItem,
}: {
  selectedPlaylist: { kind: 'app' | 'tidal'; id: string }
  appPlaylists: Playlist[]
  tidalPlaylists: Playlist[]
  appPlaylistTracks: Array<{ item: Playlist['items'][number]; track: Track; index: number }>
  tidalDetail?: { playlist: Playlist; tracks: Track[] }
  onBack: () => void
  onPlayAppPlaylist: (playlistId: string, tracks: Track[]) => void
  onPlayTidalPlaylist: (playlistId: string, tracks: Track[]) => void
  onRenameAppPlaylist: (playlistId: string, currentName: string, currentDescription?: string) => void
  onDeleteAppPlaylist: (playlistId: string) => void
  onMoveItem: (playlistId: string, fromIndex: number, toIndex: number) => void
  onRemoveItem: (playlist: Playlist, item: Playlist['items'][number], index: number) => void
}) {
  const playlist = selectedPlaylist.kind === 'app'
    ? appPlaylists.find((item) => item.id === selectedPlaylist.id)
    : tidalDetail?.playlist || tidalPlaylists.find((item) => item.providerPlaylistId === selectedPlaylist.id)

  if (!playlist) {
    return (
      <EmptyPanel
        title="Playlist not found"
        description="The selected playlist could not be resolved from the local or synced collection."
      />
    )
  }

  const tracks = selectedPlaylist.kind === 'app'
    ? appPlaylistTracks.map((entry) => entry.track)
    : tidalDetail?.tracks || []

  return (
    <div className="space-y-5">
      <section className={`${panelClass} px-5 py-5 sm:px-6`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={onBack}
            className="deezer-tab-link text-sm font-medium"
            data-active="false"
          >
            Back to playlists
          </button>

          <div className="flex flex-wrap gap-2">
            <ActionPill
              label="Play all"
              icon={<Play size={15} />}
              onClick={() => {
                if (selectedPlaylist.kind === 'app') onPlayAppPlaylist(playlist.id, tracks)
                else onPlayTidalPlaylist(selectedPlaylist.id, tracks)
              }}
              accent
              disabled={tracks.length === 0}
            />
            {selectedPlaylist.kind === 'app' ? (
              <>
                <ActionPill
                  label="Rename"
                  icon={<Settings size={15} />}
                  onClick={() => onRenameAppPlaylist(playlist.id, playlist.name, playlist.description)}
                />
                <ActionPill
                  label="Delete"
                  icon={<Settings size={15} />}
                  onClick={() => onDeleteAppPlaylist(playlist.id)}
                />
              </>
            ) : null}
          </div>
        </div>
      </section>

      {selectedPlaylist.kind === 'app' ? (
        appPlaylistTracks.length === 0 ? (
          <EmptyPanel
            title="This playlist is empty"
            description="Add tracks from the library or search results to start building the mix."
          />
        ) : (
          <SurfacePanel title="Tracks" meta={`${appPlaylistTracks.length} queued`}>
            <div className="divide-y divide-black/6">
              {appPlaylistTracks.map(({ item, track, index }) => {
                const extraActions: TrackAction[] = [
                  {
                    label: 'Remove from playlist',
                    onClick: () => onRemoveItem(playlist, item, index),
                    destructive: true,
                  },
                ]

                if (index > 0) {
                  extraActions.unshift({
                    label: 'Move earlier',
                    onClick: () => onMoveItem(playlist.id, index, index - 1),
                  })
                }

                if (index < appPlaylistTracks.length - 1) {
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
                    index={index}
                    showIndex
                    extraActions={extraActions}
                  />
                )
              })}
            </div>
          </SurfacePanel>
        )
      ) : tidalDetail ? (
        <SurfacePanel title="Tracks" meta={`${tidalDetail.tracks.length} queued`}>
          <div className="divide-y divide-black/6">
            {tidalDetail.tracks.map((track, index) => (
              <TrackRow
                key={`${track.id}-${index}`}
                track={track}
                tracks={tidalDetail.tracks}
                playContext="tidal-playlist"
                index={index}
                showIndex
              />
            ))}
          </div>
        </SurfacePanel>
      ) : (
        <EmptyPanel
          title="Loading TIDAL playlist..."
          description="Waiting for the synced playlist details to arrive from the backend."
        />
      )}

      {tracks.length > 0 ? (
        <PlaylistFooterSuggestions
          playlistId={playlist.id}
          playlistName={playlist.name}
          playlistTracks={tracks}
          appendable={selectedPlaylist.kind === 'app'}
        />
      ) : null}
    </div>
  )
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
