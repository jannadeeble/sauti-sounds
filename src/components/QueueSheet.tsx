import { GripVertical, Play, Radio, Sparkles, Trash2 } from 'lucide-react'
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import BottomSheet from './BottomSheet'
import { useTrackArtworkUrl } from '../lib/artwork'
import { isAutoRadioTrack } from '../lib/autoRadio'
import { formatTime } from '../lib/metadata'
import { usePlaybackSessionStore } from '../stores/playbackSessionStore'
import type { Track } from '../types'

export default function QueueSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const tracks = usePlaybackSessionStore((state) => state.tracks)
  const currentTrack = usePlaybackSessionStore((state) => state.currentTrack)
  const reorderTracks = usePlaybackSessionStore((state) => state.reorderTracks)
  const removeQueuedTrack = usePlaybackSessionStore((state) => state.removeQueuedTrack)
  const originRect = usePlaybackSessionStore((state) => state.playerOpenOriginRect)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const from = tracks.findIndex((track) => track.id === active.id)
    const to = tracks.findIndex((track) => track.id === over.id)
    if (from < 0 || to < 0) return
    reorderTracks(from, to)
  }

  return (
    <BottomSheet
      open={open}
      title="Queue"
      description={tracks.length === 0 ? 'Nothing queued yet.' : `${tracks.length} tracks up next. Drag to reorder.`}
      onClose={onClose}
      maxHeightClassName="max-h-[90vh]"
      variant="light"
      originRect={originRect}
    >
      {tracks.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-[#686973]">
          Play something to start building a queue.
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis, restrictToParentElement]}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={tracks.map((track) => track.id)} strategy={verticalListSortingStrategy}>
            <ul className="divide-y divide-black/6">
              {tracks.map((track) => (
                <QueueRow
                  key={track.id}
                  track={track}
                  isCurrent={currentTrack?.id === track.id}
                  onRemove={() => removeQueuedTrack(track.id)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}
    </BottomSheet>
  )
}

function QueueRow({
  track,
  isCurrent,
  onRemove,
}: {
  track: Track
  isCurrent: boolean
  onRemove: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: track.id })
  const artworkUrl = useTrackArtworkUrl(track)

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.75 : 1,
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 px-4 py-3 ${isCurrent ? 'bg-[#fff4f6]' : 'bg-transparent hover:bg-[#f3f3f6]'}`}
    >
      <button
        type="button"
        className="cursor-grab touch-none rounded-full p-1 text-[#8b8c95] transition-colors hover:text-[#111116] active:cursor-grabbing"
        aria-label={`Drag ${track.title}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical size={16} />
      </button>

      <div className="h-10 w-10 overflow-hidden rounded-xl bg-[#f1f1f4]">
        {artworkUrl ? (
          <img src={artworkUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-lg text-[#9ea0aa]">♪</div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {isCurrent ? <Play size={12} className="text-accent" /> : null}
          <p className={`truncate text-sm font-medium ${isCurrent ? 'text-accent' : 'text-[#111116]'}`}>
            {track.title}
          </p>
          {track.source === 'tidal' ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-cyan-500/8 px-2 py-0.5 text-[10px] uppercase tracking-wide text-cyan-700">
              <Radio size={10} />
              TIDAL
            </span>
          ) : null}
          {isAutoRadioTrack(track.id) ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-[#fff4f6] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[#8d3140]">
              <Sparkles size={10} />
              Auto-radio
            </span>
          ) : null}
        </div>
        <p className="truncate text-xs text-[#7a7b86]">{track.artist}</p>
      </div>

      <span className="text-xs text-[#8b8c95]">{formatTime(track.duration)}</span>
      <button
        type="button"
        onClick={onRemove}
        className="rounded-full p-2 text-[#8b8c95] transition-colors hover:bg-[#fff4f6] hover:text-[#8d3140]"
        aria-label={`Remove ${track.title} from queue`}
      >
        <Trash2 size={15} />
      </button>
    </li>
  )
}
