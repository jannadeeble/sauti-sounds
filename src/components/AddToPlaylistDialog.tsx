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
        className="fixed inset-0 z-50 bg-black/35"
        onClick={onClose}
        aria-label="Close playlist picker"
      />
      <div className="fixed inset-x-4 bottom-4 z-[60] rounded-[24px] border border-black/8 bg-white p-4 shadow-[0_20px_40px_rgba(17,17,22,0.16)]">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="deezer-display text-[1.5rem] leading-none text-[#111116]">Add to playlist</p>
            <p className="mt-1 truncate text-xs text-[#7a7b86]">{track.title} · {track.artist}</p>
          </div>
          <button
            onClick={onClose}
            className="text-xs text-[#7a7b86] transition-colors hover:text-[#111116]"
          >
            Close
          </button>
        </div>

        <div className="max-h-[50vh] space-y-4 overflow-y-auto">
          <section>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs uppercase tracking-[0.24em] text-[#8b8c95]">App playlists</p>
              <button
                onClick={() => void handleCreateAppPlaylist()}
                className="inline-flex items-center gap-1 text-xs text-accent hover:text-accent-dark"
              >
                <Plus size={12} />
                New
              </button>
            </div>
            <div className="space-y-2">
              {appPlaylists.length === 0 ? (
                <button
                  onClick={() => void handleCreateAppPlaylist()}
                  className="w-full rounded-2xl border border-dashed border-black/10 px-3 py-3 text-left text-sm text-[#686973] transition-colors hover:border-black/16 hover:bg-[#f8f8f9]"
                >
                  Create your first mixed playlist
                </button>
              ) : (
                appPlaylists.map(playlist => (
                  <button
                    key={playlist.id}
                    onClick={() => void handleAdd(playlist.id, 'app')}
                    className="w-full rounded-2xl border border-black/6 bg-[#f8f8f9] px-3 py-3 text-left transition-colors hover:bg-[#f1f1f4]"
                  >
                    <span className="block text-sm font-medium text-[#111116]">{playlist.name}</span>
                    <span className="text-xs text-[#7a7b86]">
                      {playlist.items.length} item{playlist.items.length === 1 ? '' : 's'}
                    </span>
                  </button>
                ))
              )}
            </div>
          </section>

          {tidalConnected && (
            <section>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs uppercase tracking-[0.24em] text-[#8b8c95]">TIDAL playlists</p>
                {track.source === 'tidal' && (
                  <button
                    onClick={() => void handleCreateTidalPlaylist()}
                    className="inline-flex items-center gap-1 text-xs text-accent hover:text-accent-dark"
                  >
                    <Plus size={12} />
                    New
                  </button>
                )}
              </div>
              <div className="space-y-2">
                {tidalPlaylists.length === 0 ? (
                  <div className="rounded-2xl border border-black/8 bg-[#f8f8f9] px-3 py-3 text-sm text-[#686973]">
                    {track.source === 'tidal'
                      ? 'Create a TIDAL playlist to save this track.'
                      : 'No TIDAL playlists yet.'}
                  </div>
                ) : (
                  tidalPlaylists.map(playlist => {
                    const disabled = track.source !== 'tidal' || !playlist.writable
                    return (
                      <button
                        key={playlist.id}
                        disabled={disabled}
                        onClick={() => void handleAdd(playlist.id, 'tidal')}
                        className="w-full rounded-2xl border border-black/6 bg-[#f8f8f9] px-3 py-3 text-left transition-colors hover:bg-[#f1f1f4] disabled:opacity-50 disabled:hover:bg-[#f8f8f9]"
                      >
                        <span className="flex items-center gap-2 text-sm font-medium text-[#111116]">
                          <Radio size={12} className="text-cyan-400" />
                          {playlist.name}
                        </span>
                        <span className="mt-1 flex items-center gap-1 text-xs text-[#7a7b86]">
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
