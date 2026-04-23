import { useEffect } from 'react'
import { Plus, Radio, Shapes } from 'lucide-react'
import type { RectLike } from '../lib/rect'
import type { Playlist, Track } from '../types'
import { usePlaylistStore } from '../stores/playlistStore'
import { useTidalStore } from '../stores/tidalStore'
import MorphSurface from './MorphSurface'

interface Props {
  open: boolean
  track?: Track
  tracks?: Track[]
  onClose: () => void
  originRect?: RectLike | null
}

export default function AddToPlaylistDialog({ open, track, tracks, onClose, originRect }: Props) {
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

  const batch = tracks && tracks.length > 0 ? tracks : (track ? [track] : [])
  if (batch.length === 0) return null
  const isBatch = batch.length > 1
  const hasTidalTrack = batch.some((item) => item.source === 'tidal')

  async function addAll(playlist: Playlist) {
    for (const item of batch) {
      await addTrackToPlaylist(playlist, item)
    }
  }

  async function handleAdd(playlistId: string, kind: 'app' | 'tidal') {
    const playlist = [...appPlaylists, ...tidalPlaylists].find(p => p.id === playlistId && p.kind === kind)
    if (!playlist) return
    try {
      await addAll(playlist)
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
    await addAll(playlist)
    onClose()
  }

  async function handleCreateTidalPlaylist() {
    const name = window.prompt('Name your new TIDAL playlist')
    if (!name?.trim()) return
    const playlist = await createProviderPlaylist(name.trim())
    await addAll(playlist)
    onClose()
  }

  return (
    <MorphSurface
      open={open}
      onClose={onClose}
      title="Add to playlist"
      description={isBatch ? `${batch.length} tracks selected` : `${batch[0].title} · ${batch[0].artist}`}
      originRect={originRect}
      variant="light"
      size="md"
      align="bottom"
    >
      <div className="max-h-[56vh] space-y-5 overflow-y-auto pr-1">
        <section>
          <div className="mb-2 flex items-center justify-between">
            <p className="sauti-modal-kicker">App playlists</p>
            <button
              onClick={() => void handleCreateAppPlaylist()}
              className="inline-flex items-center gap-1 text-xs text-accent transition-colors hover:text-accent-dark"
            >
              <Plus size={12} />
              New
            </button>
          </div>
          <div className="space-y-2">
            {appPlaylists.length === 0 ? (
              <button
                onClick={() => void handleCreateAppPlaylist()}
                className="w-full rounded-[20px] border border-dashed border-[color:var(--sauti-border-strong)] bg-[var(--sauti-panel-muted)] px-4 py-3 text-left text-sm text-[var(--sauti-text-secondary)] transition-colors hover:bg-[var(--sauti-panel-hover)]"
              >
                Create your first mixed playlist
              </button>
            ) : (
              appPlaylists.map(playlist => (
                <button
                  key={playlist.id}
                  onClick={() => void handleAdd(playlist.id, 'app')}
                  className="sauti-modal-card w-full px-4 py-3 text-left transition-colors hover:bg-[var(--sauti-panel-hover)]"
                >
                  <span className="block text-sm font-medium text-[var(--sauti-text)]">{playlist.name}</span>
                  <span className="text-xs text-[var(--sauti-text-muted)]">
                    {playlist.items.length} item{playlist.items.length === 1 ? '' : 's'}
                  </span>
                </button>
              ))
            )}
          </div>
        </section>

        {tidalConnected ? (
          <section>
            <div className="mb-2 flex items-center justify-between">
              <p className="sauti-modal-kicker">TIDAL playlists</p>
              {!isBatch && hasTidalTrack ? (
                <button
                  onClick={() => void handleCreateTidalPlaylist()}
                  className="inline-flex items-center gap-1 text-xs text-accent transition-colors hover:text-accent-dark"
                >
                  <Plus size={12} />
                  New
                </button>
              ) : null}
            </div>
            <div className="space-y-2">
              {tidalPlaylists.length === 0 ? (
                <div className="sauti-modal-card-muted px-4 py-3 text-sm text-[var(--sauti-text-secondary)]">
                  {hasTidalTrack && !isBatch
                    ? 'Create a TIDAL playlist to save this track.'
                    : 'No TIDAL playlists yet.'}
                </div>
              ) : (
                tidalPlaylists.map(playlist => {
                  const allTidal = batch.every((item) => item.source === 'tidal')
                  const disabled = !allTidal || !playlist.writable
                  return (
                    <button
                      key={playlist.id}
                      disabled={disabled}
                      onClick={() => void handleAdd(playlist.id, 'tidal')}
                      className="sauti-modal-card w-full px-4 py-3 text-left transition-colors hover:bg-[var(--sauti-panel-hover)] disabled:opacity-50"
                    >
                      <span className="flex items-center gap-2 text-sm font-medium text-[var(--sauti-text)]">
                        <Radio size={12} className="text-cyan-700" />
                        {playlist.name}
                      </span>
                      <span className="mt-1 flex items-center gap-1 text-xs text-[var(--sauti-text-muted)]">
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
        ) : null}
      </div>
    </MorphSurface>
  )
}
