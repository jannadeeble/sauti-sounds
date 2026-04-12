import { useEffect, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ListMusic, Pencil, Trash2 } from 'lucide-react'
import TrackRow, { type TrackAction } from '../components/TrackRow'
import { useLibraryStore } from '../stores/libraryStore'
import { usePlayerStore } from '../stores/playerStore'
import { usePlaylistStore } from '../stores/playlistStore'
import type { PlaylistItem, Track } from '../types'

function resolveTrack(item: PlaylistItem, tracks: Track[]) {
  if (item.source === 'local') {
    return tracks.find(track => track.id === item.trackId)
  }
  return tracks.find(track => track.providerTrackId === item.providerTrackId)
}

export default function PlaylistPage() {
  const navigate = useNavigate()
  const { kind, playlistId } = useParams<{ kind: 'app' | 'tidal'; playlistId: string }>()
  const tracks = useLibraryStore(s => s.tracks)
  const loadTracks = useLibraryStore(s => s.loadTracks)
  const { setQueue } = usePlayerStore()
  const {
    appPlaylists,
    tidalPlaylistDetails,
    loadPlaylists,
    loadTidalPlaylistDetail,
    renameAppPlaylist,
    deleteAppPlaylist,
    removeTrackFromPlaylist,
    moveAppPlaylistItem,
  } = usePlaylistStore()

  useEffect(() => {
    void loadTracks()
    void loadPlaylists()
  }, [loadPlaylists, loadTracks])

  useEffect(() => {
    if (kind === 'tidal' && playlistId) {
      void loadTidalPlaylistDetail(playlistId)
    }
  }, [kind, loadTidalPlaylistDetail, playlistId])

  const appPlaylist = useMemo(
    () => appPlaylists.find(playlist => playlist.id === playlistId),
    [appPlaylists, playlistId],
  )

  const tidalDetail = playlistId ? tidalPlaylistDetails[playlistId] : undefined
  const playlist = kind === 'tidal' ? tidalDetail?.playlist : appPlaylist

  const appResolvedTracks = useMemo(() => {
    if (!appPlaylist) return []
    return appPlaylist.items
      .map((item, index) => {
        const track = resolveTrack(item, tracks)
        return track ? { item, track, index } : null
      })
      .filter((value): value is { item: PlaylistItem; track: Track; index: number } => value !== null)
  }, [appPlaylist, tracks])

  const tidalTracks = tidalDetail?.tracks || []

  if (!playlist || !playlistId || !kind) {
    return (
      <div className="px-4 pt-6 pb-4">
        <button onClick={() => navigate(-1)} className="mb-4 text-sm text-gray-400 hover:text-white">
          Back
        </button>
        <p className="text-gray-400">Playlist not found.</p>
      </div>
    )
  }

  const currentPlaylist = playlist

  async function handleRename() {
    if (kind !== 'app') return
    const nextName = window.prompt('Rename playlist', currentPlaylist.name)
    if (!nextName?.trim()) return
    await renameAppPlaylist(currentPlaylist.id, nextName.trim(), currentPlaylist.description || '')
  }

  async function handleDelete() {
    if (kind !== 'app') return
    if (!window.confirm(`Delete "${currentPlaylist.name}"?`)) return
    await deleteAppPlaylist(currentPlaylist.id)
    navigate('/library')
  }

  function playAll() {
    if (kind === 'tidal') {
      if (tidalTracks.length > 0) setQueue(tidalTracks, 0)
      return
    }

    const playable = appResolvedTracks.map(entry => entry.track)
    if (playable.length > 0) setQueue(playable, 0)
  }

  return (
    <div className="px-4 pt-6 pb-4">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="flex items-start gap-3">
          <button onClick={() => navigate(-1)} className="p-2 -ml-2 hover:bg-white/10 rounded-full">
            <ArrowLeft size={20} />
          </button>
          <div>
            <p className="text-xs uppercase tracking-wider text-gray-400 mb-1">
              {kind === 'tidal' ? 'TIDAL Playlist' : 'App Playlist'}
            </p>
            <h1 className="text-2xl font-bold leading-tight">{currentPlaylist.name}</h1>
            {currentPlaylist.description && (
              <p className="text-sm text-gray-400 mt-1">{currentPlaylist.description}</p>
            )}
            <p className="text-xs text-gray-500 mt-2">
              {kind === 'tidal'
                ? `${tidalTracks.length} tracks`
                : `${currentPlaylist.items.length} items`}
            </p>
          </div>
        </div>

        {kind === 'app' && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => void handleRename()}
              className="p-2 rounded-full hover:bg-white/10 transition-colors"
              title="Rename playlist"
            >
              <Pencil size={16} className="text-gray-300" />
            </button>
            <button
              onClick={() => void handleDelete()}
              className="p-2 rounded-full hover:bg-red-500/10 transition-colors"
              title="Delete playlist"
            >
              <Trash2 size={16} className="text-red-300" />
            </button>
          </div>
        )}
      </div>

      <button
        onClick={playAll}
        disabled={kind === 'tidal' ? tidalTracks.length === 0 : appResolvedTracks.length === 0}
        className="mb-5 inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-dark disabled:opacity-40"
      >
        <ListMusic size={16} />
        Play All
      </button>

      {kind === 'tidal' ? (
        <div className="space-y-0.5">
          {tidalTracks.map((track, index) => {
            const extraActions: TrackAction[] = currentPlaylist.writable
              ? [{
                  label: 'Remove From TIDAL Playlist',
                  onClick: () => void removeTrackFromPlaylist(
                    currentPlaylist,
                    { source: 'tidal', providerTrackId: track.providerTrackId || '' },
                  ),
                  destructive: true,
                }]
              : []

            return (
              <TrackRow
                key={`${track.id}-${index}`}
                track={track}
                tracks={tidalTracks}
                index={index}
                showIndex
                extraActions={extraActions}
              />
            )
          })}
        </div>
      ) : (
        <div className="space-y-0.5">
          {appResolvedTracks.map(({ item, track, index }) => {
            const extraActions: TrackAction[] = [
              {
                label: 'Remove From Playlist',
                onClick: () => void removeTrackFromPlaylist(currentPlaylist, item, index),
                destructive: true,
              },
            ]

            if (index > 0) {
              extraActions.unshift({
                label: 'Move Earlier',
                onClick: () => void moveAppPlaylistItem(currentPlaylist.id, index, index - 1),
              })
            }

            if (index < appResolvedTracks.length - 1) {
              extraActions.unshift({
                label: 'Move Later',
                onClick: () => void moveAppPlaylistItem(currentPlaylist.id, index, index + 1),
              })
            }

            return (
              <TrackRow
                key={`${track.id}-${index}`}
                track={track}
                tracks={appResolvedTracks.map(entry => entry.track)}
                index={index}
                showIndex
                extraActions={extraActions}
              />
            )
          })}
        </div>
      )}

      {kind === 'app' && appResolvedTracks.length === 0 && (
        <div className="py-12 text-center text-gray-500">
          <p className="text-sm">This playlist is empty.</p>
          <p className="text-xs text-gray-600 mt-1">Add tracks from search, library, or TIDAL results.</p>
        </div>
      )}
    </div>
  )
}
