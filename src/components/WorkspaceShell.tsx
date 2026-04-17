import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import {
  Bot,
  ChevronRight,
  Disc3,
  FolderOpen,
  Home,
  Library,
  ListMusic,
  Play,
  Plus,
  Radio,
  Search,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Upload,
} from 'lucide-react'
import AIChatPanel from './AIChatPanel'
import BottomSheet from './BottomSheet'
import ImportPanel, { type ImportDoneResult } from './ImportPanel'
import NotificationBell from './NotificationBell'
import PlaylistTree from './PlaylistTree'
import QueueSheet from './QueueSheet'
import SettingsPanel from './SettingsPanel'
import TrackRow, { type TrackAction } from './TrackRow'
import WorkspacePlayer from './WorkspacePlayer'
import { useTrackArtworkUrl } from '../lib/artwork'
import { useHistoryStore } from '../stores/historyStore'
import { useLibraryStore } from '../stores/libraryStore'
import { usePlaybackSessionStore } from '../stores/playbackSessionStore'
import { usePlaylistStore } from '../stores/playlistStore'
import { searchTidal } from '../lib/tidal'
import { useTidalStore } from '../stores/tidalStore'
import type { Playlist, PlaylistFolder, Track } from '../types'

type WorkspaceTab = 'home' | 'library'
type LibraryFilter = 'all' | 'tidal' | 'local' | 'playlists' | 'artists'
type LibrarySort = 'recent' | 'title' | 'artist'

const EMPTY_ARTWORK = { artworkBlob: undefined, artworkUrl: undefined }
const panelClass = 'rounded-[28px] border border-black/8 bg-white shadow-[0_1px_0_rgba(17,17,22,0.03)]'
const mutedPanelClass = 'rounded-[22px] border border-black/6 bg-[#f8f8f9]'

const LIBRARY_FILTERS: { value: LibraryFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'tidal', label: 'TIDAL' },
  { value: 'local', label: 'Local' },
  { value: 'playlists', label: 'Playlists' },
  { value: 'artists', label: 'Artists' },
]

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
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('home')
  const [showImport, setShowImport] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showAI, setShowAI] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [libraryFilter, setLibraryFilter] = useState<LibraryFilter>('all')
  const [librarySort, setLibrarySort] = useState<LibrarySort>('recent')
  const [selectedArtist, setSelectedArtist] = useState<string | null>(null)
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
    appPlaylistFolders,
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
  const playerOpen = usePlaybackSessionStore((state) => state.playerOpen)
  const setPlayerOpen = usePlaybackSessionStore((state) => state.setPlayerOpen)

  const loadHistory = useHistoryStore((state) => state.loadHistory)
  const historyEntries = useHistoryStore((state) => state.entries)

  useEffect(() => {
    void loadTracks()
    void loadPlaylists()
    void loadHistory()
  }, [loadPlaylists, loadTracks, loadHistory])

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

  const trackFilter = (track: Track) => {
    if (libraryFilter === 'local' || libraryFilter === 'tidal') {
      return track.source === libraryFilter
    }
    return true
  }

  const libraryTrackIds = useMemo(() => new Set(tracks.map((track) => track.id)), [tracks])

  const sortedTracks = useMemo(() => {
    const filtered = tracks.filter(trackFilter)
    const next = [...filtered]
    if (librarySort === 'title') {
      next.sort((left, right) => left.title.localeCompare(right.title))
    } else if (librarySort === 'artist') {
      next.sort((left, right) => left.artist.localeCompare(right.artist))
    } else {
      next.sort((left, right) => (right.addedAt || 0) - (left.addedAt || 0))
    }

    return next
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const selectedArtistTracks = useMemo(() => {
    if (!selectedArtist) return []
    return tracks.filter((track) => (track.artist || 'Unknown artist') === selectedArtist)
  }, [tracks, selectedArtist])

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
      setActiveTab('library')
      setLibraryFilter('playlists')
      return
    }

    const playlist = await createProviderPlaylist(name.trim())
    if (playlist.providerPlaylistId) {
      selectPlaylist({ kind: 'tidal', id: playlist.providerPlaylistId })
      setActiveTab('library')
      setLibraryFilter('playlists')
    }
  }

  function handlePlaylistPlayback(kind: 'app' | 'tidal', playlistId: string, playlistTracks: Track[]) {
    if (playlistTracks.length === 0) return
    playPlaylist(kind, playlistId, playlistTracks, 0)
  }

  function openSearch() {
    setShowSearch(true)
    setTidalSearched(false)
  }

  function closeSearch() {
    setShowSearch(false)
  }

  function finalizeImport(result?: ImportDoneResult) {
    const importedTracks = result?.importedTracks ?? []

    setShowImport(false)
    setActiveTab('library')
    selectPlaylist(undefined)
    setLibraryFilter('all')
    setLibrarySort('recent')
    setSelectedArtist(null)

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
    if (activeTab === 'home') {
      return {
        eyebrow: 'Welcome back',
        title: 'Home',
        meta: `${tracks.length} tracks in your library`,
        description: 'Jump straight back into recent plays, or let Sauti suggest something new.',
        actions: [
          recentTracks.length > 0
            ? {
                label: 'Resume',
                icon: <Play size={15} />,
                onClick: () => playTracks(recentTracks, 'library', 0),
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
    }

    if (libraryFilter === 'playlists' && selectedPlaylist) {
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
        description: playlist?.description || 'Open the queue and play the playlist straight through.',
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

    if (libraryFilter === 'playlists') {
      return {
        eyebrow: 'Collections',
        title: 'Playlists',
        meta: `${appPlaylists.length} app • ${tidalPlaylists.length} TIDAL`,
        description: 'Mixed playlists stay editable while remote TIDAL collections sit beside them.',
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

    if (libraryFilter === 'artists' && selectedArtist) {
      return {
        eyebrow: 'Artist',
        title: selectedArtist,
        meta: `${selectedArtistTracks.length} tracks`,
        description: 'Every track from this artist in your library, grouped in one place.',
        actions: [
          {
            label: 'Play all',
            icon: <Play size={15} />,
            onClick: () => playTracks(selectedArtistTracks, 'library', 0),
            accent: true,
            disabled: selectedArtistTracks.length === 0,
          },
          {
            label: 'Back to artists',
            icon: <ListMusic size={15} />,
            onClick: () => setSelectedArtist(null),
          },
        ] satisfies HeroAction[],
      }
    }

    if (libraryFilter === 'artists') {
      return {
        eyebrow: 'Library',
        title: 'Artists',
        meta: `${artistGroups.length} artists`,
        description: 'Browse your library by artist and open any of them to dig in.',
        actions: [],
      }
    }

    return {
      eyebrow: currentTrack ? 'Now playing' : 'My music',
      title: currentTrack ? currentTrack.title : 'Library',
      meta: currentTrack
        ? `${currentTrack.artist}${currentTrack.album ? ` • ${currentTrack.album}` : ''}`
        : `${tracks.length} tracks • ${localTrackCount} local • ${tidalTrackCount} TIDAL`,
      description: currentTrack
        ? `Pulled from your ${isPlaying ? 'active queue' : 'library'}.`
        : 'Your full library across local files and cached TIDAL tracks.',
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeTab,
    appPlaylistTracks,
    appPlaylists.length,
    artistGroups.length,
    currentTrack,
    handleQuickImport,
    isPlaying,
    libraryFilter,
    localTrackCount,
    playTracks,
    recentTracks,
    selectedAppPlaylist,
    selectedArtist,
    selectedArtistTracks,
    selectedPlaylist,
    selectedTidalDetail,
    sortedTracks,
    tidalConnected,
    tidalPlaylists,
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
              label="Home"
              icon={<Home size={18} />}
              active={activeTab === 'home'}
              onClick={() => {
                setActiveTab('home')
                selectPlaylist(undefined)
              }}
            />
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
              label="Search"
              icon={<Search size={18} />}
              active={false}
              onClick={openSearch}
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
                    setActiveTab('library')
                    setLibraryFilter('playlists')
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
                      setActiveTab('library')
                      setLibraryFilter('playlists')
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
                  <TopbarActionButton label="Ask Sauti" icon={<Bot size={16} />} onClick={() => setShowAI(true)} accent />
                  <TopbarActionButton label="Upload" icon={<Upload size={16} />} onClick={() => setShowImport(true)} />
                  <TopbarActionButton label="Search" icon={<Search size={16} />} onClick={openSearch} />
                  <NotificationBell />
                  <TopbarActionButton label="Settings" icon={<Settings size={16} />} onClick={() => setShowSettings(true)} />
                </div>
              </div>

              <div className="hidden items-center justify-end gap-2 lg:flex">
                <TopbarActionButton label="Ask Sauti" icon={<Bot size={16} />} onClick={() => setShowAI(true)} accent />
                <TopbarActionButton label="Upload" icon={<Upload size={16} />} onClick={() => setShowImport(true)} />
                <TopbarActionButton label="Search" icon={<Search size={16} />} onClick={openSearch} />
                <NotificationBell />
                <TopbarActionButton label="Settings" icon={<Settings size={16} />} onClick={() => setShowSettings(true)} />
              </div>
            </div>

          </header>

          <main ref={mainContentRef} className="min-h-0 flex-1 overflow-y-auto px-4 pb-[12rem] pt-6 lg:px-8 lg:pt-8">
            <div className="space-y-8">
              <header>
                <h1 className="deezer-display text-[2.25rem] leading-none text-[#111116] sm:text-[2.75rem]">
                  {hero.title}
                </h1>
              </header>

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

              {activeTab === 'home' ? (
                <HomeView
                  recentTracks={recentTracks}
                  onPlayTrack={(track, list) => playTracks(list, 'library', list.indexOf(track))}
                  onImport={() => void handleQuickImport()}
                  onOpenLibrary={() => setActiveTab('library')}
                />
              ) : null}

              {activeTab === 'library' ? (
                <section className="space-y-5">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex flex-wrap gap-2">
                      {LIBRARY_FILTERS.map((filter) => (
                        <FilterPill
                          key={filter.value}
                          active={libraryFilter === filter.value}
                          onClick={() => {
                            setLibraryFilter(filter.value)
                            setSelectedArtist(null)
                            if (filter.value !== 'playlists') selectPlaylist(undefined)
                          }}
                        >
                          {filter.label}
                        </FilterPill>
                      ))}
                    </div>

                    {libraryFilter === 'all' || libraryFilter === 'tidal' || libraryFilter === 'local' ? (
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
                    ) : null}
                  </div>

                  {libraryFilter === 'playlists' ? (
                    selectedPlaylist ? (
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
                        appPlaylistFolders={appPlaylistFolders}
                        tidalPlaylists={tidalPlaylists}
                        onOpen={(kind, id) => selectPlaylist({ kind, id })}
                      />
                    )
                  ) : libraryFilter === 'artists' ? (
                    selectedArtist ? (
                      <SurfacePanel title={selectedArtist} meta={`${selectedArtistTracks.length} tracks`}>
                        <div className="divide-y divide-black/6">
                          {selectedArtistTracks.map((track, index) => (
                            <TrackRow
                              key={track.id}
                              track={track}
                              tracks={selectedArtistTracks}
                              playContext="library"
                              index={index}
                            />
                          ))}
                        </div>
                      </SurfacePanel>
                    ) : artistGroups.length === 0 ? (
                      <EmptyPanel
                        title="No artists yet"
                        description="Import tracks or connect TIDAL to group your library by artist."
                      />
                    ) : (
                      <ArtistsGrid groups={artistGroups} onSelect={setSelectedArtist} />
                    )
                  ) : libraryLoading && sortedTracks.length === 0 ? (
                    <EmptyPanel
                      title="Loading your library..."
                      description="Reading tracks from the local cache before the list appears."
                    />
                  ) : sortedTracks.length === 0 ? (
                    <EmptyPanel
                      title="Your library is empty"
                      description="Import local files or connect TIDAL in Settings to fill the library."
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
                            highlighted={highlightedImportIds.includes(track.id)}
                          />
                        ))}
                      </div>
                    </SurfacePanel>
                  )}
                </section>
              ) : null}
            </div>
          </main>
        </div>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-black/8 bg-white/95 backdrop-blur-md lg:hidden">
        <div className="flex items-stretch">
          <BottomTabButton
            label="Home"
            icon={<Home size={20} />}
            active={activeTab === 'home'}
            onClick={() => {
              setActiveTab('home')
              selectPlaylist(undefined)
            }}
          />
          <BottomTabButton
            label="Library"
            icon={<Library size={20} />}
            active={activeTab === 'library'}
            onClick={() => {
              setActiveTab('library')
              selectPlaylist(undefined)
            }}
          />
        </div>
      </nav>

      <WorkspacePlayer />

      <BottomSheet
        open={showSearch}
        title="Search"
        description="Local results appear instantly, TIDAL matches on demand."
        onClose={closeSearch}
        maxHeightClassName="max-h-[90vh]"
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

      <QueueSheet open={playerOpen} onClose={() => setPlayerOpen(false)} />
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
}: {
  label: string
  icon: ReactNode
  onClick: () => void
  accent?: boolean
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`inline-flex h-10 w-10 items-center justify-center rounded-full border transition-colors sm:h-11 sm:w-11 ${
        accent
          ? 'border-transparent bg-[#ef5466] text-white hover:bg-[#e0364a]'
          : 'border-black/8 bg-white text-[#111116] hover:border-black/12 hover:bg-[#f8f8f9]'
      }`}
    >
      {icon}
    </button>
  )
}

function BottomTabButton({
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
      className={`flex flex-1 flex-col items-center justify-center gap-1 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] text-[11px] font-medium transition-colors ${
        active ? 'text-[#ef5466]' : 'text-[#686973] hover:text-[#111116]'
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
        active
          ? 'border-transparent bg-[#ef5466] text-white hover:bg-[#e0364a]'
          : 'border-black/8 bg-white text-[#555661] hover:border-black/16 hover:text-[#111116]'
      }`}
    >
      {children}
    </button>
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

function HomeView({
  recentTracks,
  onPlayTrack,
  onImport,
  onOpenLibrary,
}: {
  recentTracks: Track[]
  onPlayTrack: (track: Track, list: Track[]) => void
  onImport: () => void
  onOpenLibrary: () => void
}) {
  return (
    <div className="space-y-8">
      <section className={`${panelClass} px-5 py-5 sm:px-6`}>
        <div className="flex items-end justify-between pb-4">
          <div>
            <h2 className="deezer-display text-[1.7rem] leading-none text-[#111116]">Recently played</h2>
            <p className="mt-1 text-sm text-[#7a7b86]">Jump straight back in</p>
          </div>
          <button
            type="button"
            onClick={onOpenLibrary}
            className="text-sm font-medium text-[#ef5466] hover:text-[#e0364a]"
          >
            Open library
          </button>
        </div>

        {recentTracks.length === 0 ? (
          <div className={`${mutedPanelClass} px-4 py-6 text-center text-sm text-[#686973]`}>
            <p>No plays yet. Import music or search TIDAL to start filling this space.</p>
            <div className="mt-4 flex justify-center">
              <ActionPill label="Import music" icon={<FolderOpen size={15} />} onClick={onImport} accent />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {recentTracks.map((track) => (
              <SpeedDialTile key={track.id} track={track} onClick={() => onPlayTrack(track, recentTracks)} />
            ))}
          </div>
        )}
      </section>

      <section className={`${panelClass} px-5 py-5 sm:px-6`}>
        <div className="pb-4">
          <h2 className="deezer-display text-[1.7rem] leading-none text-[#111116]">Suggested for you</h2>
          <p className="mt-1 text-sm text-[#7a7b86]">AI-picked tracks, playlists, and mixes will appear here.</p>
        </div>

        <div className={`${mutedPanelClass} flex min-h-[180px] flex-col items-center justify-center gap-3 px-4 py-10 text-center text-sm text-[#686973]`}>
          <Sparkles size={22} className="text-[#ef5466]" />
          <p className="max-w-md">
            Sauti will learn your taste and suggest things to play next. This space is reserved for those picks.
          </p>
        </div>
      </section>
    </div>
  )
}

function SpeedDialTile({ track, onClick }: { track: Track; onClick: () => void }) {
  const artworkUrl = useTrackArtworkUrl(track)
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col gap-2 rounded-2xl p-2 text-left transition-colors hover:bg-[#fafafb]"
    >
      <div className="aspect-square w-full overflow-hidden rounded-2xl bg-[#111116]">
        {artworkUrl ? (
          <img src={artworkUrl} alt="" className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_top,#32323d,#121216)] text-white/70">
            <Disc3 size={36} />
          </div>
        )}
      </div>
      <div className="min-w-0 px-1">
        <p className="truncate text-sm font-medium text-[#111116]">{track.title}</p>
        <p className="truncate text-xs text-[#7a7b86]">{track.artist}</p>
      </div>
    </button>
  )
}

function ArtistsGrid({
  groups,
  onSelect,
}: {
  groups: { artist: string; tracks: Track[] }[]
  onSelect: (artist: string) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
      {groups.map((group) => (
        <ArtistTile key={group.artist} group={group} onClick={() => onSelect(group.artist)} />
      ))}
    </div>
  )
}

function ArtistTile({
  group,
  onClick,
}: {
  group: { artist: string; tracks: Track[] }
  onClick: () => void
}) {
  const artworkTrack = group.tracks[0]
  const artworkUrl = useTrackArtworkUrl(artworkTrack ?? EMPTY_ARTWORK)
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col gap-2 rounded-2xl p-2 text-left transition-colors hover:bg-[#fafafb]"
    >
      <div className="aspect-square w-full overflow-hidden rounded-full bg-[#111116]">
        {artworkUrl ? (
          <img src={artworkUrl} alt="" className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_top,#32323d,#121216)] text-white/70">
            <Disc3 size={32} />
          </div>
        )}
      </div>
      <div className="min-w-0 px-1 text-center">
        <p className="truncate text-sm font-medium text-[#111116]">{group.artist}</p>
        <p className="truncate text-xs text-[#7a7b86]">{group.tracks.length} tracks</p>
      </div>
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
        <Search size={18} className="shrink-0 text-[#8b8c95]" />
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
        <div className={`${mutedPanelClass} px-4 py-5 text-sm text-[#686973]`}>
          Start typing to search your library. Press enter to extend the search to TIDAL.
        </div>
      ) : null}

      {query.trim() && localResults.length > 0 ? (
        <SurfacePanel title="Library results" meta={`${localResults.length} matches`}>
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
        </SurfacePanel>
      ) : null}

      {query.trim() && tidalConnected ? (
        <div className="space-y-3">
          {!tidalSearched && !tidalLoading ? (
            <button
              type="button"
              onClick={onTidalSearch}
              className="inline-flex items-center gap-2 rounded-full border border-[#f6c8cf] bg-[#fff4f6] px-4 py-2 text-sm text-[#b03a4d] transition-colors hover:bg-[#ffecef]"
            >
              <Radio size={15} />
              Search TIDAL for "{query}"
            </button>
          ) : null}

          {tidalLoading ? (
            <div className={`${mutedPanelClass} px-4 py-4 text-sm text-[#686973]`}>Searching TIDAL...</div>
          ) : null}

          {tidalSearched && tidalResults.length > 0 ? (
            <SurfacePanel title="TIDAL results" meta={`${tidalResults.length} matches`}>
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
            </SurfacePanel>
          ) : null}
        </div>
      ) : null}

      {query.trim() && !localResults.length && (!tidalSearched || !tidalResults.length) && !tidalLoading ? (
        <div className={`${mutedPanelClass} px-4 py-5 text-sm text-[#686973]`}>
          No matches yet. {tidalConnected ? 'Try another term or run the TIDAL search.' : 'Connect TIDAL to widen the catalog.'}
        </div>
      ) : null}
    </div>
  )
}

function PlaylistCollectionsView({
  appPlaylists,
  appPlaylistFolders,
  tidalPlaylists,
  onOpen,
}: {
  appPlaylists: Playlist[]
  appPlaylistFolders: PlaylistFolder[]
  tidalPlaylists: Playlist[]
  onOpen: (kind: 'app' | 'tidal', id: string) => void
}) {
  const folderSummary = appPlaylistFolders.length > 0
    ? `${appPlaylists.length} editable mixes • ${appPlaylistFolders.length} ${appPlaylistFolders.length === 1 ? 'folder' : 'folders'}`
    : `${appPlaylists.length} editable mixes`

  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <section className={panelClass}>
        <div className="flex items-center justify-between px-5 pb-3 pt-5 sm:px-6">
          <div>
            <h2 className="deezer-display text-[1.7rem] leading-none text-[#111116]">App playlists</h2>
            <p className="mt-1 text-sm text-[#7a7b86]">{folderSummary}</p>
          </div>
        </div>

        {appPlaylists.length === 0 && appPlaylistFolders.length === 0 ? (
          <div className="px-5 pb-6 sm:px-6">
            <div className={`${mutedPanelClass} px-4 py-5 text-sm text-[#686973]`}>
              No app playlists yet. Create one and it will appear here.
            </div>
          </div>
        ) : (
          <div className="pb-2">
            <PlaylistTree
              folders={appPlaylistFolders}
              playlists={appPlaylists}
              onOpen={(id) => onOpen('app', id)}
            />
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
