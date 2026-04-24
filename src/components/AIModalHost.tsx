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
  const cacheTidalTracks = useLibraryStore((s) => s.cacheTidalTracks)
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
        { library, tasteProfile, excludeLibraryIds: new Set(), cacheResolvedTracks: cacheTidalTracks },
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
      variant="light"
      size="md"
      align="center"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#fff4f6] text-accent">
          <Sparkles size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-[var(--sauti-text-muted)]">
            {kind === 'setlist-seed' ? 'Setlist builder' : 'Track-inspired playlist'}
          </p>
        </div>
      </div>

      {!mix ? (
        <div className="mt-4 space-y-3">
          <div>
            <label className="text-xs text-[var(--sauti-text-muted)]">Focus (optional)</label>
            <textarea
              rows={2}
              value={focus}
              onChange={(e) => setFocus(e.target.value)}
              placeholder="e.g. peak-time, deep and bassy, vocals forward…"
              className="sauti-modal-input mt-1 px-3 py-2 text-sm"
            />
          </div>
          <div className="flex items-center gap-3">
            <label className="text-xs text-[var(--sauti-text-muted)]">Tracks</label>
            <input
              type="number"
              min={5}
              max={50}
              value={count}
              onChange={(e) => setCount(Number(e.target.value) || 15)}
              className="sauti-modal-input w-20 rounded-xl px-2 py-1 text-sm"
            />
            <label className="ml-auto flex cursor-pointer items-center gap-2 text-xs text-[var(--sauti-text-secondary)]">
              <input
                type="checkbox"
                checked={useProfile}
                onChange={(e) => setUseProfile(e.target.checked)}
                className="h-4 w-4 accent-[#ef5466]"
              />
              Use my taste
            </label>
          </div>
          {error ? <p className="text-xs text-[var(--sauti-accent-text)]">{error}</p> : null}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="sauti-modal-secondary-button px-3 py-1.5 text-sm"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleGenerate()}
              disabled={running}
              className="sauti-modal-primary-button px-4 py-1.5 text-sm font-medium disabled:opacity-60"
            >
              {running ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {running ? 'Building…' : 'Build'}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {mix.blurb ? <p className="text-sm text-[var(--sauti-text-secondary)]">{mix.blurb}</p> : null}
          <p className="text-xs text-[var(--sauti-text-muted)]">
            {resolvedTracks.length} tracks
            {mix.unresolvedCount ? ` · ${mix.unresolvedCount} couldn't resolve` : ''}
          </p>
          <div className="sauti-modal-card-muted max-h-72 space-y-1 overflow-y-auto p-2">
            {resolvedTracks.map((t, i) => (
              <PreviewRow key={t.id + i} track={t} index={i} />
            ))}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="sauti-modal-secondary-button px-3 py-1.5 text-sm"
            >
              Dismiss
            </button>
            <button
              type="button"
              onClick={() => void handlePreview()}
              className="sauti-modal-secondary-button px-3 py-1.5 text-sm"
            >
              Preview
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              className="sauti-modal-primary-button px-4 py-1.5 text-sm font-medium"
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
      <span className="w-5 text-right text-[var(--sauti-text-hint)]">{index + 1}</span>
      <div className="h-7 w-7 overflow-hidden rounded-md bg-white">
        {url ? (
          <img src={url} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[var(--sauti-text-muted)]">
            <Disc3 size={12} />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[var(--sauti-text)]">{track.title}</p>
        <p className="truncate text-[var(--sauti-text-muted)]">{track.artist}</p>
      </div>
    </div>
  )
}
