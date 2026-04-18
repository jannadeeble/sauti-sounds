import { useMemo, useState } from 'react'
import { ListPlus, Trash2, X } from 'lucide-react'
import AddToPlaylistDialog from './AddToPlaylistDialog'
import { useLibraryStore } from '../stores/libraryStore'
import { useSelectionStore } from '../stores/selectionStore'

export default function BatchActionsBar() {
  const selecting = useSelectionStore((state) => state.selecting)
  const selectedIds = useSelectionStore((state) => state.selectedIds)
  const exitSelection = useSelectionStore((state) => state.exit)
  const tracks = useLibraryStore((state) => state.tracks)
  const removeTrack = useLibraryStore((state) => state.removeTrack)

  const [showPlaylistDialog, setShowPlaylistDialog] = useState(false)

  const selectedTracks = useMemo(
    () => tracks.filter((track) => selectedIds.has(track.id)),
    [tracks, selectedIds],
  )

  if (!selecting) return null

  const count = selectedTracks.length

  async function handleRemove() {
    if (count === 0) return
    const confirmed = window.confirm(
      count === 1
        ? `Remove "${selectedTracks[0].title}" from your library?`
        : `Remove ${count} tracks from your library?`,
    )
    if (!confirmed) return
    for (const track of selectedTracks) {
      await removeTrack(track.id)
    }
    exitSelection()
  }

  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 bottom-[64px] z-40 flex justify-center px-4 pb-2 lg:bottom-4">
        <div className="pointer-events-auto flex w-full max-w-[520px] items-center justify-between gap-2 rounded-full border border-black/8 bg-white/95 px-4 py-2 shadow-[0_12px_40px_rgba(17,17,22,0.18)] backdrop-blur-md">
          <button
            type="button"
            onClick={exitSelection}
            aria-label="Cancel selection"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full text-[#555661] transition-colors hover:bg-black/5 hover:text-[#111116]"
          >
            <X size={18} />
          </button>

          <p className="flex-1 text-center text-sm font-medium text-[#111116]">
            {count === 0 ? 'Select tracks' : count === 1 ? '1 selected' : `${count} selected`}
          </p>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setShowPlaylistDialog(true)}
              disabled={count === 0}
              aria-label="Add selected to playlist"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full text-[#111116] transition-colors hover:bg-black/5 disabled:opacity-40"
            >
              <ListPlus size={18} />
            </button>
            <button
              type="button"
              onClick={() => void handleRemove()}
              disabled={count === 0}
              aria-label="Remove selected from library"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full text-[#c4394d] transition-colors hover:bg-[#fff4f6] disabled:opacity-40"
            >
              <Trash2 size={18} />
            </button>
          </div>
        </div>
      </div>

      <AddToPlaylistDialog
        open={showPlaylistDialog}
        tracks={selectedTracks}
        onClose={() => {
          setShowPlaylistDialog(false)
          exitSelection()
        }}
      />
    </>
  )
}
