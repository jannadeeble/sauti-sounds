import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import {
  Bot,
  ChevronRight,
  FolderOpen,
  Library,
  ListMusic,
  Play,
  Plus,
  Search,
  Settings,
  SlidersHorizontal,
} from 'lucide-react'
import AIChatPanel from './AIChatPanel'
import BottomSheet from './BottomSheet'
import ImportPanel, { type ImportDoneResult } from './ImportPanel'
import SettingsPanel from './SettingsPanel'
import TrackRow, { type TrackAction } from './TrackRow'
import WorkspacePlayer from './WorkspacePlayer'
import { useLibraryStore } from '../stores/libraryStore'
import { usePlaybackSessionStore } from '../stores/playbackSessionStore'
import { usePlaylistStore } from '../stores/playlistStore'
import type { Playlist, Track } from '../types'

type WorkspaceTab = 'library' | 'playlists'
type LibraryFilter = 'all' | 'local' | 'tidal'
type LibrarySort = 'recent' | 'title' | 'artist'

const panelClass = 'rounded-[28px] border border-black/8 bg-white shadow-[0_1px_0_rgba(17,17,22,0.03)]'
const mutedPanelClass = 'rounded-[22px] border border-black/6 bg-[#f8f8f9]'

function formatPlaylistCount(playlist: Playlist) {
  return playlist.trackCount ?? playlist.items.length
}

export default function WorkspaceShell() {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('library')
  const [showImport, setShowImport] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showAI, setShowAI] = useState(false)
  const [libraryFilter, setLibraryFilter] = useState<LibraryFilter>('all')
  const [librarySort, setLibrarySort] = useState<LibrarySort>('recent')
  const [query, setQuery] = useState('')
  const [importNotice, setImportNotice] = useState<string | null>(null)
  const [highlightedImportIds, setHighlightedImportIds] = useState<string[]>([])
  const mainContentRef = useRef<HTMLElement | null>(null)

  const tracks = useLibraryStore((state) => state.tracks)
  const libraryLoading = useLibraryStore((state) => state.loading)
  const loadTracks = useLibraryStore((state) => state.loadTracks)
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

  const selectedPlaylist = usePlaybackSessionStore((state) => state.selectedPlaylist)
  const selectPlaylist = usePlaybackSessionStore((state) => state.selectPlaylist)
  const playPlaylist = usePlaybackSessionStore((state) => state.playPlaylist)
  const playTracks = usePlaybackSessionStore((state) => state.playTracks)
  const errorMessage = usePlaybackSessionStore((state) => state.errorMessage)

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

  const desktopPlaylistLinks = appPlaylists.slice(0, 6)

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

  const selectedPlaylistName = selectedPlaylist?.kind === 'app'
    ? (selectedAppPlaylist?.name ?? 'Playlist')
    : (selectedTidalDetail?.playlist.name ?? tidalPlaylists.find((p) => p.providerPlaylistId === selectedPlaylist?.id)?.name ?? 'Playlist')

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
          </nav>

          {desktopPlaylistLinks.length > 0 ? (
            <section className="mt-8 px-6">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-[11px] uppercase tracking-[0.24em] text-[#8b8c95]">Playlists</p>
                <span className="text-xs text-[#8b8c95]">{appPlaylists.length}</span>
              </div>
              <div className="space-y-1.5">
                {desktopPlaylistLinks.map((playlist) => (
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
                ))}
              </div>
            </section>
          ) : null}

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

        <div className="min-h-0 flex h-full flex-col">
          <header className="border-b border-black/8 bg-[#fbfbfc]/95 backdrop-blur-md">
            <div className="px-4 py-4 lg:px-8 lg:py-5">
              <div className="flex items-center justify-between gap-3 lg:hidden">
                <div className="min-w-0">
                  <BrandMark compact />
                </div>

                <div className="flex items-center gap-2">
                  <TopbarActionButton label="Import" icon={<FolderOpen size={16} />} onClick={() => setShowImport(true)} />
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
                    placeholder="Artists, tracks, playlists..."
                  />
                </label>

                <div className="flex items-center gap-2">
                  <TopbarActionButton label="Import" icon={<FolderOpen size={16} />} onClick={() => setShowImport(true)} />
                  <TopbarActionButton label="Settings" icon={<Settings size={16} />} onClick={() => setShowSettings(true)} />
                  <TopbarActionButton label="Ask Sauti" icon={<Bot size={16} />} onClick={() => setShowAI(true)} accent />
                </div>
              </div>
            </div>

          </header>

          <main
            ref={mainContentRef}
            className="min-h-0 flex-1 overflow-y-auto px-4 pb-[13rem] pt-6 lg:pb-[10rem] lg:px-8 lg:pt-8"
            style={{ overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch' }}
          >
            <div className="space-y-8">
              {activeTab === 'library' ? (
                <div className="px-1">
                  <h1 className="deezer-display text-[2.4rem] leading-none text-[#111116]">Library</h1>
                </div>
              ) : activeTab === 'playlists' && !selectedPlaylist ? (
                <div className="flex flex-wrap items-end justify-between gap-4 px-1">
                  <h1 className="deezer-display text-[2.4rem] leading-none text-[#111116]">Playlists</h1>
                  <ActionPill
                    label="New playlist"
                    icon={<Plus size={15} />}
                    onClick={() => void handleCreatePlaylist('app')}
                    accent
                  />
                </div>
              ) : activeTab === 'playlists' && selectedPlaylist ? (
                <div className="px-1">
                  <h1 className="deezer-display text-[2.4rem] leading-none text-[#111116]">{selectedPlaylistName}</h1>
                </div>
              ) : null}

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
                  <div className={`${panelClass} px-5 py-4 sm:px-6`}>
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

                  {query.trim() ? (
                    localSearchResults.length > 0 ? (
                      <SurfacePanel title="Search results" meta={`${localSearchResults.length} matches`}>
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
                    ) : (
                      <EmptyPanel
                        title="No matches"
                        description="Try a different search term."
                      />
                    )
                  ) : libraryLoading && sortedTracks.length === 0 ? (
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

            </div>
          </main>
        </div>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-20 flex border-t border-black/8 bg-[#fbfbfc]/95 backdrop-blur-md lg:hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <button
          type="button"
          onClick={() => { setActiveTab('library'); selectPlaylist(undefined) }}
          className={`flex flex-1 flex-col items-center gap-1 py-3 transition-colors ${activeTab === 'library' ? 'text-accent' : 'text-[#8b8c95]'}`}
        >
          <Library size={22} />
          <span className="text-[10px] font-medium uppercase tracking-wide">Library</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('playlists')}
          className={`flex flex-1 flex-col items-center gap-1 py-3 transition-colors ${activeTab === 'playlists' ? 'text-accent' : 'text-[#8b8c95]'}`}
        >
          <ListMusic size={22} />
          <span className="text-[10px] font-medium uppercase tracking-wide">Playlists</span>
        </button>
      </nav>

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

function ActionPill({ label, icon, onClick, accent = false, disabled = false }: { label: string; icon: ReactNode; onClick: () => void; accent?: boolean; disabled?: boolean }) {
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
  type Row = { kind: 'app' | 'tidal'; id: string; playlist: Playlist }
  const rows: Row[] = [
    ...appPlaylists.map((playlist) => ({ kind: 'app' as const, id: playlist.id, playlist })),
    ...tidalPlaylists
      .filter((playlist) => !!playlist.providerPlaylistId)
      .map((playlist) => ({ kind: 'tidal' as const, id: playlist.providerPlaylistId as string, playlist })),
  ].sort((a, b) => a.playlist.name.localeCompare(b.playlist.name))

  if (rows.length === 0) {
    return (
      <div className={`${mutedPanelClass} px-5 py-6 text-sm text-[#686973]`}>
        No playlists yet. Create one above.
      </div>
    )
  }

  return (
    <section className={panelClass}>
      <div className="divide-y divide-black/6">
        {rows.map((row) => (
          <button
            key={`${row.kind}:${row.id}`}
            type="button"
            onClick={() => onOpen(row.kind, row.id)}
            className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-[#fafafb] sm:px-6"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-medium text-[#111116]">{row.playlist.name}</p>
                {row.kind === 'tidal' ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-cyan-500/8 px-2 py-0.5 text-[10px] uppercase tracking-wide text-cyan-700">
                    TIDAL
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-xs text-[#7a7b86]">
                {row.kind === 'app'
                  ? `${formatPlaylistCount(row.playlist)} items`
                  : `${row.playlist.trackCount || 0} tracks${row.playlist.writable ? '' : ' • read only'}`}
              </p>
            </div>
            <ChevronRight size={16} className="shrink-0 text-[#a2a3ad]" />
          </button>
        ))}
      </div>
    </section>
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
