import { type ReactNode, useEffect, useMemo, useState } from 'react'
import {
  ChevronRight,
  Play,
  Plus,
  Radio,
  Search,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Upload,
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
import { usePlaybackSessionStore } from '../stores/playbackSessionStore'
import { usePlaylistStore } from '../stores/playlistStore'
import { useSelectionStore } from '../stores/selectionStore'
import { useTasteStore } from '../stores/tasteStore'
import { useTidalStore } from '../stores/tidalStore'
import type { Playlist, Track } from '../types'

type WorkspaceTab = 'home' | 'library'
type LibraryFilter = 'tracks' | 'playlists' | 'artists'
type LibrarySort = 'recent' | 'title' | 'artist'

type ModalState =
  | { kind: 'search'; originRect: RectLike | null }
  | { kind: 'upload'; originRect: RectLike | null }
  | { kind: 'settings'; originRect: RectLike | null }
  | { kind: 'generator'; originRect: RectLike | null }
  | { kind: 'artist'; originRect: RectLike | null; artist: string }
  | { kind: 'playlist'; originRect: RectLike | null; playlistKind: 'app' | 'tidal'; playlistId: string }

const WORKSPACE_TAB_VALUES: readonly WorkspaceTab[] = ['home', 'library']
const LIBRARY_FILTER_VALUES: readonly LibraryFilter[] = ['tracks', 'playlists', 'artists']

const LIBRARY_FILTERS: { value: LibraryFilter; label: string }[] = [
  { value: 'playlists', label: 'Playlists' },
  { value: 'artists', label: 'Artists' },
  { value: 'tracks', label: 'Tracks' },
]

export default function WorkspaceShell() {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('home')
  const [libraryFilter, setLibraryFilter] = useState<LibraryFilter>('tracks')
  const [librarySort, setLibrarySort] = useState<LibrarySort>('recent')
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
  const loadMixes = useMixStore((state) => state.load)
  const loadTasteProfile = useTasteStore((state) => state.load)

  const selecting = useSelectionStore((state) => state.selecting)
  const exitSelection = useSelectionStore((state) => state.exit)

  useEffect(() => {
    void loadTracks()
    void loadPlaylists()
    void loadHistory()
    void loadMixes()
    void loadTasteProfile()
  }, [loadHistory, loadMixes, loadPlaylists, loadTasteProfile, loadTracks])

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
      })
      .finally(() => {
        setPrefsReady(true)
      })
  }, [])

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
    if (activeTab !== 'library' && selecting) {
      exitSelection()
    }
  }, [activeTab, exitSelection, selecting])

  useEffect(() => {
    const playlistModal = modal?.kind === 'playlist' ? modal : null
    if (playlistModal?.playlistKind === 'tidal' && !tidalPlaylistDetails[playlistModal.playlistId]) {
      void loadTidalPlaylistDetail(playlistModal.playlistId)
    }
  }, [loadTidalPlaylistDetail, modal, tidalPlaylistDetails])

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
    const next = [...tracks]
    if (librarySort === 'title') {
      next.sort((left, right) => left.title.localeCompare(right.title))
    } else if (librarySort === 'artist') {
      next.sort((left, right) => left.artist.localeCompare(right.artist))
    } else {
      next.sort((left, right) => (right.addedAt || 0) - (left.addedAt || 0))
    }
    return next
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

  const artistModal = modal?.kind === 'artist' ? modal : null
  const artistModalTracks = useMemo(() => {
    if (!artistModal) return []
    return tracks.filter((track) => (track.artist || 'Unknown artist') === artistModal.artist)
  }, [artistModal, tracks])

  const playlistModal = modal?.kind === 'playlist' ? modal : null
  const selectedAppPlaylist = playlistModal?.playlistKind === 'app'
    ? appPlaylists.find((playlist) => playlist.id === playlistModal.playlistId)
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
  const selectedTidalDetail = playlistModal?.playlistKind === 'tidal'
    ? tidalPlaylistDetails[playlistModal.playlistId]
    : undefined

  function openModal(kind: ModalState['kind'], originRect: RectLike | null, payload?: Partial<ModalState>) {
    setModal({ kind, originRect, ...(payload ?? {}) } as ModalState)
  }

  function closeModal() {
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
      openModal('playlist', null, { playlistKind: 'app', playlistId: playlist.id })
      return
    }

    const playlist = await createProviderPlaylist(name.trim())
    if (playlist.providerPlaylistId) {
      openModal('playlist', null, { playlistKind: 'tidal', playlistId: playlist.providerPlaylistId })
    }
  }

  function handlePlaylistPlayback(kind: 'app' | 'tidal', playlistId: string, playlistTracks: Track[]) {
    if (playlistTracks.length === 0) return
    playPlaylist(kind, playlistId, playlistTracks, 0)
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

  async function handleQuickImport() {
    if (!('showOpenFilePicker' in window)) {
      openModal('upload', null)
      return
    }

    const result = await importFiles()
    if (result.dedupeUncertain.length > 0) {
      openModal('upload', null)
      return
    }
    if (result.tracks.length > 0) {
      finalizeImport({ importedTracks: result.tracks })
    }
  }

  const playerVisible = queuedTracks.length > 0

  return (
    <div className="workspace-shell min-h-[100dvh]">
      <div className="min-h-[100dvh]">
        <div className="mx-auto flex min-h-[100dvh] max-w-[1460px] flex-col px-2 pb-[calc(12rem+env(safe-area-inset-bottom))] pt-2 sm:px-6 sm:pt-4 lg:px-8">
          <header className="sticky top-2 z-20 sm:top-4">
            <div className="sauti-glass-panel rounded-[28px] px-2 py-2 sm:rounded-[32px] sm:px-4 sm:py-3">
              <div className="flex items-center gap-2 sm:gap-3">
                <div className="flex shrink-0 items-center gap-1 rounded-full border border-white/10 bg-white/6 p-1">
                  <TabButton active={activeTab === 'home'} onClick={() => setActiveTab('home')}>Home</TabButton>
                  <TabButton active={activeTab === 'library'} onClick={() => setActiveTab('library')}>Library</TabButton>
                </div>
                <div className="hidden min-w-0 flex-1 pl-2 text-left lg:block">
                  <p className="text-[11px] uppercase tracking-[0.28em] text-white/34">Sauti Sounds</p>
                  <p className="mt-1 text-sm text-white/56">
                    {activeTab === 'home'
                      ? 'Recently played, suggestions, and your current taste graph.'
                      : 'Tracks, artists, playlists, and synced collections.'}
                  </p>
                </div>
                <div className="ml-auto flex shrink-0 items-center justify-end gap-2">
                  <TopIconButton
                    label={importing && importProgress ? `Uploading ${importProgress.current}/${importProgress.total}` : 'Upload'}
                    icon={<Upload size={15} />}
                    onClick={(event) => openModal('upload', rectFromElement(event.currentTarget))}
                  />
                  <div className="hidden sm:block">
                    <NotificationBell />
                  </div>
                  <TopIconButton
                    label="Settings"
                    icon={<Settings size={15} />}
                    onClick={(event) => openModal('settings', rectFromElement(event.currentTarget))}
                  />
                </div>
              </div>
            </div>
          </header>

          <main className="flex-1 pt-5 sm:pt-8">
            <div className="space-y-8">
              {errorMessage ? <Banner>{errorMessage}</Banner> : null}
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
                    action={(
                      <button
                        type="button"
                        onClick={() => setActiveTab('library')}
                        className="text-sm font-medium text-accent transition-colors hover:text-accent-dark"
                      >
                        Open library
                      </button>
                    )}
                  />

                  {recentTracks.length === 0 ? (
                    <EmptyState
                      title="No plays yet"
                      description="Upload music or connect TIDAL to start filling this surface."
                      action={(
                        <ActionButton accent icon={<Upload size={15} />} onClick={() => void handleQuickImport()}>
                          Upload music
                        </ActionButton>
                      )}
                    />
                  ) : (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
                      {recentTracks.map((track) => (
                        <RecentTrackCard
                          key={track.id}
                          track={track}
                          onClick={() => playTracks(recentTracks, 'library', recentTracks.findIndex((item) => item.id === track.id))}
                        />
                      ))}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <ActionButton
                      accent
                      icon={<Sparkles size={15} />}
                      onClick={(event) => openModal('generator', rectFromElement(event.currentTarget))}
                    >
                      Generate playlist
                    </ActionButton>
                    <ActionButton icon={<Upload size={15} />} onClick={() => void handleQuickImport()}>
                      Quick import
                    </ActionButton>
                  </div>

                  <HomeSuggestions onPlayTracks={(list) => playTracks(list, 'library', 0)} />
                </div>
              ) : null}

              {activeTab === 'library' ? (
                <div className="space-y-6">
                  <SectionHeader
                    title="Library"
                    subtitle={`${tracks.length} tracks · ${artistGroups.length} artists · ${playlistRows.length} playlists`}
                    action={(
                      <div className="flex flex-wrap gap-2">
                        <ActionButton
                          accent
                          icon={<Sparkles size={15} />}
                          onClick={(event) => openModal('generator', rectFromElement(event.currentTarget))}
                        >
                          Generate playlist
                        </ActionButton>
                        <ActionButton icon={<Plus size={15} />} onClick={() => void handleCreatePlaylist('app')}>
                          New playlist
                        </ActionButton>
                      </div>
                    )}
                  />

                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex flex-wrap gap-2">
                      {LIBRARY_FILTERS.map((filter) => (
                        <button
                          key={filter.value}
                          type="button"
                          data-active={libraryFilter === filter.value}
                          onClick={() => setLibraryFilter(filter.value)}
                          className="sauti-filter-pill"
                        >
                          {filter.label}
                        </button>
                      ))}
                    </div>

                    {libraryFilter === 'tracks' ? (
                      <label className="ml-auto inline-flex items-center gap-2 rounded-full border border-black/8 bg-white px-3 py-2 text-sm text-[#555661]">
                        <SlidersHorizontal size={14} />
                        <select
                          value={librarySort}
                          onChange={(event) => setLibrarySort(event.target.value as LibrarySort)}
                          className="bg-transparent text-[#111116] outline-none"
                        >
                          <option value="recent">Recent</option>
                          <option value="title">Title</option>
                          <option value="artist">Artist</option>
                        </select>
                      </label>
                    ) : null}
                  </div>

                  {libraryFilter === 'tracks' ? (
                    libraryLoading && sortedTracks.length === 0 ? (
                      <EmptyState
                        title="Loading your library..."
                        description="Reading tracks from the local cache before the list appears."
                      />
                    ) : sortedTracks.length === 0 ? (
                      <EmptyState
                        title="Your library is empty"
                        description="Upload local files or connect TIDAL in Settings to fill the library."
                        action={(
                          <ActionButton accent icon={<Upload size={15} />} onClick={() => void handleQuickImport()}>
                            Upload music
                          </ActionButton>
                        )}
                      />
                    ) : (
                      <SurfaceCard title="Tracks" meta={`${sortedTracks.length} tracks`}>
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
                      </SurfaceCard>
                    )
                  ) : null}

                  {libraryFilter === 'artists' ? (
                    artistGroups.length === 0 ? (
                      <EmptyState
                        title="No artists yet"
                        description="Upload tracks or connect TIDAL to group your library by artist."
                      />
                    ) : (
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                        {artistGroups.map((group) => (
                          <ArtistCard
                            key={group.artist}
                            artist={group.artist}
                            tracks={group.tracks}
                            onClick={(event) => openModal('artist', rectFromElement(event.currentTarget), { artist: group.artist })}
                          />
                        ))}
                      </div>
                    )
                  ) : null}

                  {libraryFilter === 'playlists' ? (
                    playlistRows.length === 0 ? (
                      <EmptyState
                        title="No playlists yet"
                        description="Create a playlist, generate one from a prompt, or connect TIDAL to pull in synced collections."
                        action={(
                          <ActionButton accent icon={<Plus size={15} />} onClick={() => void handleCreatePlaylist('app')}>
                            New playlist
                          </ActionButton>
                        )}
                      />
                    ) : (
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                        {playlistRows.map((playlist) => (
                          <PlaylistCard
                            key={`${playlist.sourceKind}-${playlist.id}`}
                            playlist={playlist}
                            active={Boolean(selectedPlaylist?.kind === playlist.sourceKind && selectedPlaylist.id === playlist.id)}
                            onOpen={(event) => openModal('playlist', rectFromElement(event.currentTarget), {
                              playlistKind: playlist.sourceKind,
                              playlistId: playlist.id,
                            })}
                            onPlay={() => {
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
                              const detail = tidalPlaylistDetails[playlist.id]
                              if (detail) handlePlaylistPlayback('tidal', playlist.id, detail.tracks)
                            }}
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

        <div className="workspace-search-fab" data-player-visible={playerVisible ? 'true' : 'false'}>
          <button
            type="button"
            aria-label="Search"
            title="Search"
            onClick={(event) => openModal('search', rectFromElement(event.currentTarget))}
            className="workspace-search-fab__button"
          >
            <Search size={18} />
            <span className="workspace-search-fab__label">Search</span>
          </button>
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
          <SettingsPanel />
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
          <PlaylistGeneratorPanel />
        </BottomSheet>

        <BottomSheet
          open={Boolean(artistModal)}
          title={artistModal?.artist ?? 'Artist'}
          description={artistModal ? `${artistModalTracks.length} tracks` : undefined}
          onClose={closeModal}
          variant="light"
          originRect={artistModal?.originRect}
          size="lg"
          maxHeightClassName="max-h-[88vh]"
        >
          <div className="divide-y divide-black/6 rounded-[24px] border border-black/8 bg-white">
            {artistModalTracks.map((track, index) => (
              <TrackRow
                key={track.id}
                track={track}
                tracks={artistModalTracks}
                playContext="library"
                index={index}
              />
            ))}
          </div>
        </BottomSheet>

        <BottomSheet
          open={Boolean(playlistModal)}
          title={selectedAppPlaylist?.name || selectedTidalDetail?.playlist.name || playlistRows.find((item) => item.id === playlistModal?.playlistId)?.name || 'Playlist'}
          description={playlistModal?.playlistKind === 'app' ? 'App playlist' : 'TIDAL playlist'}
          onClose={closeModal}
          variant="light"
          originRect={playlistModal?.originRect}
          size="xl"
          maxHeightClassName="max-h-[92vh]"
        >
          {playlistModal ? (
            <PlaylistDetailModal
              playlistModal={playlistModal}
              appPlaylist={selectedAppPlaylist}
              appPlaylistTracks={appPlaylistTracks}
              tidalDetail={selectedTidalDetail}
              onPlayPlaylist={handlePlaylistPlayback}
              onRenameAppPlaylist={(playlistId, currentName, currentDescription) => void renamePlaylist(playlistId, currentName, currentDescription, renameAppPlaylist)}
              onDeleteAppPlaylist={async (playlistId) => {
                if (!window.confirm('Delete this playlist?')) return
                await deleteAppPlaylist(playlistId)
                closeModal()
              }}
              onMoveItem={(playlistId, fromIndex, toIndex) => void moveAppPlaylistItem(playlistId, fromIndex, toIndex)}
              onRemoveItem={(playlist, item, index) => void removeTrackFromPlaylist(playlist, item, index)}
            />
          ) : null}
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
      className={`rounded-full px-3 py-2 text-sm font-medium transition-colors sm:px-4 ${
        active ? 'bg-white/14 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]' : 'text-white/56 hover:text-white'
      }`}
    >
      {children}
    </button>
  )
}

function TopIconButton({
  label,
  icon,
  onClick,
}: {
  label: string
  icon: ReactNode
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="sauti-glass-button"
    >
      {icon}
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

function RecentTrackCard({ track, onClick }: { track: Track; onClick: () => void }) {
  const artworkUrl = useTrackArtworkUrl(track)
  return (
    <button type="button" onClick={onClick} className="group flex flex-col gap-2 text-left">
      <div className="overflow-hidden rounded-[20px] border border-black/8 bg-white">
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
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void
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
      <div className="mt-3">
        <p className="truncate text-sm font-medium text-[#111116]">{artist}</p>
        <p className="truncate text-xs text-[#7a7b86]">{tracks.length} tracks</p>
      </div>
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
  onOpen: (event: React.MouseEvent<HTMLButtonElement>) => void
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

function PlaylistDetailModal({
  playlistModal,
  appPlaylist,
  appPlaylistTracks,
  tidalDetail,
  onPlayPlaylist,
  onRenameAppPlaylist,
  onDeleteAppPlaylist,
  onMoveItem,
  onRemoveItem,
}: {
  playlistModal: Extract<ModalState, { kind: 'playlist' }>
  appPlaylist?: Playlist
  appPlaylistTracks: Array<{ item: Playlist['items'][number]; track: Track; index: number }>
  tidalDetail?: { playlist: Playlist; tracks: Track[] }
  onPlayPlaylist: (kind: 'app' | 'tidal', playlistId: string, tracks: Track[]) => void
  onRenameAppPlaylist: (playlistId: string, currentName: string, currentDescription?: string) => void
  onDeleteAppPlaylist: (playlistId: string) => void
  onMoveItem: (playlistId: string, fromIndex: number, toIndex: number) => void
  onRemoveItem: (playlist: Playlist, item: Playlist['items'][number], index: number) => void
}) {
  const tracks = playlistModal.playlistKind === 'app' ? appPlaylistTracks.map((entry) => entry.track) : tidalDetail?.tracks || []

  if (playlistModal.playlistKind === 'app' && !appPlaylist) {
    return <div className="rounded-[24px] border border-black/8 bg-white px-4 py-4 text-sm text-[#7a7b86]">Playlist not found.</div>
  }

  if (playlistModal.playlistKind === 'tidal' && !tidalDetail) {
    return <div className="rounded-[24px] border border-black/8 bg-white px-4 py-4 text-sm text-[#7a7b86]">Loading TIDAL playlist…</div>
  }

  const playlist = playlistModal.playlistKind === 'app' ? appPlaylist! : tidalDetail!.playlist

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        <ActionButton accent icon={<Play size={15} />} onClick={() => onPlayPlaylist(playlistModal.playlistKind, playlist.id, tracks)}>
          Play all
        </ActionButton>
        {playlistModal.playlistKind === 'app' ? (
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

      {tracks.length === 0 ? (
        <div className="rounded-[24px] border border-black/8 bg-white px-4 py-5 text-sm text-[#7a7b86]">
          This playlist is empty.
        </div>
      ) : (
        <div className="divide-y divide-black/6 rounded-[24px] border border-black/8 bg-white">
          {playlistModal.playlistKind === 'app'
            ? appPlaylistTracks.map(({ item, track, index }) => {
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
              })
            : tidalDetail!.tracks.map((track, index) => (
                <TrackRow
                  key={`${track.id}-${index}`}
                  track={track}
                  tracks={tidalDetail!.tracks}
                  playContext="tidal-playlist"
                  index={index}
                />
              ))}
        </div>
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
