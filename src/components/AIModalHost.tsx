import { useEffect, useMemo, useState } from 'react'
import { Disc3, Loader2, Sparkles } from 'lucide-react'
import { isLLMConfigured } from '../lib/llm'
import { generateSetlistSeed } from '../lib/mixGenerator'
import MorphSurface from './MorphSurface'
import { useAIModalStore } from '../stores/aiModalStore'
import { useLibraryStore } from '../stores/libraryStore'
import { useMixStore } from '../stores/mixStore'
import { usePlaybackSessionStore } from '../stores/playbackSessionStore'
import { usePlaylistStore } from '../stores/playlistStore'
import { useTasteStore } from '../stores/tasteStore'
import { useTrackArtworkUrl } from '../lib/artwork'
import type { Mix, Track } from '../types'

export default function AIModalHost() {
  const kind = useAIModalStore((s) => s.kind)
  const seed = useAIModalStore((s) => s.seed)
  const originRect = useAIModalStore((s) => s.originRect)
  const close = useAIModalStore((s) => s.close)

  if (!kind || !seed) return null
  return <SetlistModal key={seed.id + kind} seed={seed} kind={kind} originRect={originRect} onClose={close} />
}

function SetlistModal({
  seed,
  kind,
  originRect,
  onClose,
}: {
  seed: Track
  kind: 'setlist-seed' | 'playlist-from-track'
  originRect?: ReturnType<typeof useAIModalStore.getState>['originRect']
  onClose: () => void
}) {
  const library = useLibraryStore((s) => s.tracks)
  const tasteProfile = useTasteStore((s) => s.profile)
  const createAppPlaylist = usePlaylistStore((s) => s.createAppPlaylist)
  const appendTracksToAppPlaylist = usePlaylistStore((s) => s.appendTracksToAppPlaylist)
  const upsert = useMixStore((s) => s.upsert)
  const markSaved = useMixStore((s) => s.markSaved)
  const playTracks = usePlaybackSessionStore((s) => s.playTracks)

  const inLibrary = useMemo(() => library.some((t) => t.id === seed.id), [library, seed.id])

  const [count, setCount] = useState(kind === 'setlist-seed' ? 15 : 20)
  const [focus, setFocus] = useState('')
  const [useProfile, setUseProfile] = useState(inLibrary)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mix, setMix] = useState<Mix | null>(null)

  useEffect(() => {
    setUseProfile(inLibrary)
  }, [inLibrary])

  const resolvedTracks = useMemo(() => {
    if (!mix) return []
    const byId = new Map(library.map((t) => [t.id, t]))
    return mix.trackIds.map((id) => byId.get(id)).filter((t): t is Track => !!t)
  }, [mix, library])

  async function handleGenerate() {
    if (!isLLMConfigured()) {
      setError('Connect an AI model in Settings first.')
      return
    }
    setRunning(true)
    setError(null)
    try {
      const next = await generateSetlistSeed(
        { library, tasteProfile, excludeLibraryIds: new Set() },
        seed,
        {
          count,
          focusPrompt: focus.trim() || undefined,
          useProfile,
        },
      )
      if (!next) {
        setError('Nothing resolved. Try a different focus, or check your Tidal connection.')
        return
      }
      await upsert(next)
      setMix(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed')
    } finally {
      setRunning(false)
    }
  }

  async function handlePreview() {
    if (!resolvedTracks.length) return
    playTracks(resolvedTracks, 'library', 0)
  }

  async function handleSave() {
    if (!mix || !resolvedTracks.length) return
    const playlist = await createAppPlaylist(mix.title, mix.blurb, {
      generatedFromMixId: mix.id,
      origin: 'generated',
    })
    await appendTracksToAppPlaylist(playlist.id, resolvedTracks)
    await markSaved(mix.id)
    onClose()
  }

  const title =
    kind === 'setlist-seed'
      ? `Setlist from "${seed.title}"`
      : `AI playlist from "${seed.title}"`

  return (
    <MorphSurface
      open
      onClose={onClose}
      title={title}
      description={seed.artist}
      originRect={originRect}
      variant="dark"
      size="md"
      align="center"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-orange-500/16 text-orange-200">
          <Sparkles size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-white/52">
            {kind === 'setlist-seed' ? 'Setlist builder' : 'Track-inspired playlist'}
          </p>
        </div>
      </div>

      {!mix ? (
        <div className="mt-4 space-y-3">
          <div>
            <label className="text-xs text-white/48">Focus (optional)</label>
            <textarea
              rows={2}
              value={focus}
              onChange={(e) => setFocus(e.target.value)}
              placeholder="e.g. peak-time, deep and bassy, vocals forward…"
              className="mt-1 w-full rounded-[18px] border border-white/10 bg-white/6 px-3 py-2 text-sm text-white outline-none placeholder:text-white/28 focus:border-white/20"
            />
          </div>
          <div className="flex items-center gap-3">
            <label className="text-xs text-white/48">Tracks</label>
            <input
              type="number"
              min={5}
              max={50}
              value={count}
              onChange={(e) => setCount(Number(e.target.value) || 15)}
              className="w-20 rounded-xl border border-white/10 bg-white/6 px-2 py-1 text-sm text-white outline-none"
            />
            <label className="ml-auto flex cursor-pointer items-center gap-2 text-xs text-white/62">
              <input
                type="checkbox"
                checked={useProfile}
                onChange={(e) => setUseProfile(e.target.checked)}
                className="h-4 w-4 accent-orange-500"
              />
              Use my taste
            </label>
          </div>
          {error ? <p className="text-xs text-[#ffb4a6]">{error}</p> : null}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-white/10 px-3 py-1.5 text-sm text-white/62"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleGenerate()}
              disabled={running}
              className="inline-flex items-center gap-2 rounded-full bg-orange-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-60"
            >
              {running ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {running ? 'Building…' : 'Build'}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {mix.blurb ? <p className="text-sm text-white/72">{mix.blurb}</p> : null}
          <p className="text-xs text-white/48">
            {resolvedTracks.length} tracks
            {mix.unresolvedCount ? ` · ${mix.unresolvedCount} couldn't resolve` : ''}
          </p>
          <div className="max-h-72 space-y-1 overflow-y-auto rounded-[20px] border border-white/8 bg-white/4 p-2">
            {resolvedTracks.map((t, i) => (
              <PreviewRow key={t.id + i} track={t} index={i} />
            ))}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-white/10 px-3 py-1.5 text-sm text-white/62"
            >
              Dismiss
            </button>
            <button
              type="button"
              onClick={() => void handlePreview()}
              className="rounded-full border border-white/10 px-3 py-1.5 text-sm text-white hover:bg-white/6"
            >
              Preview
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              className="rounded-full bg-orange-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-orange-600"
            >
              Save as playlist
            </button>
          </div>
        </div>
      )}
    </MorphSurface>
  )
}

function PreviewRow({ track, index }: { track: Track; index: number }) {
  const url = useTrackArtworkUrl(track)
  return (
    <div className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs">
      <span className="w-5 text-right text-white/32">{index + 1}</span>
      <div className="h-7 w-7 overflow-hidden rounded-md bg-white/8">
        {url ? (
          <img src={url} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-white/70">
            <Disc3 size={12} />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-white">{track.title}</p>
        <p className="truncate text-white/48">{track.artist}</p>
      </div>
    </div>
  )
}
