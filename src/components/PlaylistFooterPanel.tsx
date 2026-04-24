import { useEffect, useMemo, useState } from 'react'
import { Disc3, Loader2, RefreshCw, Sparkles, X } from 'lucide-react'
import { isLLMConfigured } from '../lib/llm'
import { generatePlaylistFooter } from '../lib/mixGenerator'
import { useLibraryStore } from '../stores/libraryStore'
import { useMixStore } from '../stores/mixStore'
import { usePlaybackSessionStore } from '../stores/playbackSessionStore'
import { useTasteStore } from '../stores/tasteStore'
import { useTrackArtworkUrl } from '../lib/artwork'
import type { Mix, Playlist, Track } from '../types'

const VISIBLE = 5

interface Props {
  playlist: Playlist
  playlistTracks: Track[]
}

export default function PlaylistFooterPanel({ playlist, playlistTracks }: Props) {
  const library = useLibraryStore((s) => s.tracks)
  const cacheTidalTracks = useLibraryStore((s) => s.cacheTidalTracks)
  const tasteProfile = useTasteStore((s) => s.profile)
  const mixes = useMixStore((s) => s.mixes)
  const upsert = useMixStore((s) => s.upsert)
  const dismiss = useMixStore((s) => s.dismiss)
  const playTracks = usePlaybackSessionStore((s) => s.playTracks)
  const appendTrack = usePlaybackSessionStore((s) => s.appendTrack)

  const cachedMix = useMemo(() => {
    return mixes.find(
      (m) =>
        m.kind === 'playlist-footer' &&
        m.status === 'fresh' &&
        m.seedRef?.type === 'playlist' &&
        m.seedRef.id === playlist.id,
    )
  }, [mixes, playlist.id])

  const [mix, setMix] = useState<Mix | null>(cachedMix ?? null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())

  useEffect(() => {
    setMix(cachedMix ?? null)
    setDismissed(new Set())
  }, [cachedMix])

  useEffect(() => {
    if (!isLLMConfigured()) return
    if (mix) return
    if (playlistTracks.length < 3) return
    void run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playlist.id, playlistTracks.length])

  async function run(force = false) {
    if (!isLLMConfigured()) return
    if (running) return
    setRunning(true)
    setError(null)
    try {
      const next = await generatePlaylistFooter(
        { library, tasteProfile, cacheResolvedTracks: cacheTidalTracks },
        playlist,
        playlistTracks,
        { count: VISIBLE + 3 },
      )
      if (!next) {
        setError('Nothing resolved. Try again later.')
        return
      }
      if (force && mix) await dismiss(mix.id)
      await upsert(next)
      setMix(next)
      setDismissed(new Set())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed')
    } finally {
      setRunning(false)
    }
  }

  const trackById = useMemo(() => new Map(library.map((t) => [t.id, t])), [library])
  const tracks = useMemo(() => {
    if (!mix) return []
    return mix.trackIds
      .map((id) => trackById.get(id))
      .filter((t): t is Track => !!t)
      .filter((t) => !dismissed.has(t.id))
      .slice(0, VISIBLE)
  }, [mix, trackById, dismissed])

  if (!isLLMConfigured()) return null

  return (
    <section className="rounded-[24px] border border-black/8 bg-white p-5">
      <header className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#fdecef] text-[#ef5466]">
            <Sparkles size={14} />
          </span>
          <div>
            <h3 className="text-sm font-semibold text-[#111116]">You might also like…</h3>
            <p className="text-xs text-[#7a7b86]">Tracks that could follow this playlist</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void run(true)}
          disabled={running}
          className="inline-flex items-center gap-1.5 rounded-full border border-black/8 bg-white px-3 py-1.5 text-xs font-medium text-[#555661] hover:border-black/16 hover:text-[#111116] disabled:opacity-50"
        >
          {running ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          Refresh
        </button>
      </header>

      {error ? <p className="text-xs text-red-500">{error}</p> : null}

      {!mix && running ? (
        <p className="text-sm text-[#7a7b86]">Building suggestions…</p>
      ) : null}

      {tracks.length ? (
        <div className="space-y-2">
          {tracks.map((t) => (
            <FooterRow
              key={t.id}
              track={t}
              onPlay={() => playTracks(tracks, 'library', tracks.indexOf(t))}
              onAdd={() => appendTrack(t)}
              onDismiss={() => setDismissed((prev) => new Set(prev).add(t.id))}
            />
          ))}
        </div>
      ) : !running && mix ? (
        <p className="text-sm text-[#7a7b86]">No more suggestions — tap refresh for a new batch.</p>
      ) : null}
    </section>
  )
}

function FooterRow({
  track,
  onPlay,
  onAdd,
  onDismiss,
}: {
  track: Track
  onPlay: () => void
  onAdd: () => void
  onDismiss: () => void
}) {
  const url = useTrackArtworkUrl(track)
  return (
    <div className="flex items-center gap-3 rounded-xl border border-black/6 bg-[#fafafb] px-3 py-2">
      <button
        type="button"
        onClick={onPlay}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <div className="h-9 w-9 overflow-hidden rounded-md bg-[#111116]">
          {url ? (
            <img src={url} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-white/70">
              <Disc3 size={14} />
            </div>
          )}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm text-[#111116]">{track.title}</p>
          <p className="truncate text-xs text-[#7a7b86]">{track.artist}</p>
        </div>
      </button>
      <button
        type="button"
        onClick={onAdd}
        className="rounded-full border border-black/8 bg-white px-3 py-1 text-xs font-medium text-[#555661] hover:border-black/16 hover:text-[#111116]"
      >
        Queue
      </button>
      <button
        type="button"
        onClick={onDismiss}
        className="rounded-full p-1.5 text-[#9a9ba3] hover:bg-black/5 hover:text-[#555661]"
        aria-label="Dismiss suggestion"
      >
        <X size={14} />
      </button>
    </div>
  )
}
