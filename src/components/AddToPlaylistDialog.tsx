import { useEffect } from 'react'
import { Plus, Radio, Shapes } from 'lucide-react'
import type { Track } from '../types'
import { usePlaylistStore } from '../stores/playlistStore'
import { useTidalStore } from '../stores/tidalStore'

interface Props {
  open: boolean
  track: Track
  onClose: () => void
}

export default function AddToPlaylistDialog({ open, track, onClose }: Props) {
  const {
    appPlaylists,
    tidalPlaylists,
    loadPlaylists,
    createAppPlaylist,
    createProviderPlaylist,
    addTrackToPlaylist,
  } = usePlaylistStore()
  const tidalConnected = useTidalStore(s => s.tidalConnected)

  useEffect(() => {
    if (open) {
      void loadPlaylists()
    }
  }, [open, loadPlaylists])

  if (!open) return null

  async function handleAdd(playlistId: string, kind: 'app' | 'tidal') {
    const playlist = [...appPlaylists, ...tidalPlaylists].find(p => p.id === playlistId && p.kind === kind)
    if (!playlist) return
    try {
      await addTrackToPlaylist(playlist, track)
      onClose()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to add track to playlist'
      alert(message)
    }
  }

  async function handleCreateAppPlaylist() {
    const name = window.prompt('Name your new playlist')
    if (!name?.trim()) return
    const playlist = await createAppPlaylist(name.trim())
    await addTrackToPlaylist(playlist, track)
    onClose()
  }

  async function handleCreateTidalPlaylist() {
    const name = window.prompt('Name your new TIDAL playlist')
    if (!name?.trim()) return
    const playlist = await createProviderPlaylist(name.trim())
    await addTrackToPlaylist(playlist, track)
    onClose()
  }

  return (
    <>
      <button
        className="fixed inset-0 z-50 bg-black/60"
        onClick={onClose}
        aria-label="Close playlist picker"
      />
      <div className="fixed inset-x-4 bottom-4 z-[60] rounded-2xl border border-white/10 bg-surface-800 p-4 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-sm font-semibold">Add To Playlist</p>
            <p className="text-xs text-gray-400 truncate">{track.title} · {track.artist}</p>
          </div>
          <button
            onClick={onClose}
            className="text-xs text-gray-400 hover:text-white transition-colors"
          >
            Close
          </button>
        </div>

        <div className="space-y-3 max-h-[50vh] overflow-y-auto">
          <section>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs uppercase tracking-wider text-gray-400">App Playlists</p>
              <button
                onClick={() => void handleCreateAppPlaylist()}
                className="inline-flex items-center gap-1 text-xs text-accent hover:text-accent-light"
              >
                <Plus size={12} />
                New
              </button>
            </div>
            <div className="space-y-2">
              {appPlaylists.length === 0 ? (
                <button
                  onClick={() => void handleCreateAppPlaylist()}
                  className="w-full rounded-xl border border-dashed border-white/15 px-3 py-3 text-left text-sm text-gray-300 hover:border-accent/40 hover:bg-white/5"
                >
                  Create your first mixed playlist
                </button>
              ) : (
                appPlaylists.map(playlist => (
                  <button
                    key={playlist.id}
                    onClick={() => void handleAdd(playlist.id, 'app')}
                    className="w-full rounded-xl bg-surface-700 px-3 py-3 text-left hover:bg-surface-600 transition-colors"
                  >
                    <span className="text-sm font-medium block">{playlist.name}</span>
                    <span className="text-xs text-gray-400">
                      {playlist.items.length} item{playlist.items.length === 1 ? '' : 's'}
                    </span>
                  </button>
                ))
              )}
            </div>
          </section>

          {tidalConnected && (
            <section>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs uppercase tracking-wider text-gray-400">TIDAL Playlists</p>
                {track.source === 'tidal' && (
                  <button
                    onClick={() => void handleCreateTidalPlaylist()}
                    className="inline-flex items-center gap-1 text-xs text-accent hover:text-accent-light"
                  >
                    <Plus size={12} />
                    New
                  </button>
                )}
              </div>
              <div className="space-y-2">
                {tidalPlaylists.length === 0 ? (
                  <div className="rounded-xl border border-white/10 px-3 py-3 text-sm text-gray-400">
                    {track.source === 'tidal'
                      ? 'Create a TIDAL playlist to save this track.'
                      : 'Local tracks can only be added to app playlists.'}
                  </div>
                ) : (
                  tidalPlaylists.map(playlist => {
                    const disabled = track.source !== 'tidal' || !playlist.writable
                    return (
                      <button
                        key={playlist.id}
                        disabled={disabled}
                        onClick={() => void handleAdd(playlist.id, 'tidal')}
                        className="w-full rounded-xl bg-surface-700 px-3 py-3 text-left hover:bg-surface-600 transition-colors disabled:opacity-50 disabled:hover:bg-surface-700"
                      >
                        <span className="text-sm font-medium flex items-center gap-2">
                          <Radio size={12} className="text-cyan-400" />
                          {playlist.name}
                        </span>
                        <span className="text-xs text-gray-400 flex items-center gap-1 mt-1">
                          <Shapes size={12} />
                          {playlist.trackCount || 0} track{playlist.trackCount === 1 ? '' : 's'}
                          {!playlist.writable ? ' · read only' : ''}
                        </span>
                      </button>
                    )
                  })
                )}
              </div>
            </section>
          )}
        </div>
      </div>
    </>
  )
}
