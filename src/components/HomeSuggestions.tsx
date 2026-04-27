import { useCallback, useEffect, useMemo, useState } from 'react'
import { Disc3, RefreshCw, Sparkles } from 'lucide-react'
import {
  getPersistentUiState,
  hydrateAppStateFromBackend,
  pushAppStateSnapshot,
  setPersistentUiState,
} from '../lib/appStateSync'
import { isLLMConfigured } from '../lib/llm'
import { maybeRunHomeFeed, regenerateMix } from '../lib/homeOrchestrator'
import { runBackendGeneration } from '../lib/generationRuns'
import { useLibraryStore } from '../stores/libraryStore'
import { useMixStore } from '../stores/mixStore'
import { usePlaylistStore } from '../stores/playlistStore'
import { useTasteStore } from '../stores/tasteStore'
import { useTidalStore } from '../stores/tidalStore'
import { useTrackArtworkUrl } from '../lib/artwork'
import type { Mix, MixKind, Track } from '../types'
import MorphSurface from './MorphSurface'

const KIND_ORDER: MixKind[] = [
  'mood-playlist',
  'setlist-seed',
  'playlist-echo',
  'track-echo',
  'similar-artist',
  'rediscovery',
  'cultural-bridge',
]

const KIND_META: Record<MixKind, { label: string; subtitle: string }> = {
  'mood-playlist': { label: 'Prompt playlists', subtitle: 'Built from your mood prompts' },
  'playlist-echo': { label: 'Playlist Echo', subtitle: 'Inspired by your playlists' },
  'track-echo': { label: 'Track Echo', subtitle: 'In the lane of what you keep playing' },
  'similar-artist': { label: 'Artist bridges', subtitle: 'A step sideways' },
  'rediscovery': { label: 'Rediscover', subtitle: 'Back from your library' },
  'cultural-bridge': { label: 'Cultural bridges', subtitle: 'Across regions and lineages' },
  'setlist-seed': { label: 'Track-built mixes', subtitle: 'Seeded from a specific track' },
  'playlist-footer': { label: '', subtitle: '' },
  'auto-radio-buffer': { label: '', subtitle: '' },
}

const SWAP_LIMIT_PER_DAY = 3

interface HomeSuggestionsProps {
  onPlayTracks: (tracks: Track[]) => void
}

export default function HomeSuggestions({ onPlayTracks }: HomeSuggestionsProps) {
  const mixes = useMixStore((s) => s.mixes)
  const library = useLibraryStore((s) => s.tracks)
  const tasteProfile = useTasteStore((s) => s.profile)
  const tidalConnected = useTidalStore((s) => s.tidalConnected)
  const createAppPlaylist = usePlaylistStore((s) => s.createAppPlaylist)
  const appendTracksToAppPlaylist = usePlaylistStore((s) => s.appendTracksToAppPlaylist)
  const dismissMix = useMixStore((s) => s.dismiss)
  const markSaved = useMixStore((s) => s.markSaved)
  const [running, setRunning] = useState(false)
  const [moodError, setMoodError] = useState<string | null>(null)
  const [moodRunning, setMoodRunning] = useState(false)
  const [swapping, setSwapping] = useState<string | null>(null)
  const [showMood, setShowMood] = useState(false)

  const trackIndex = useMemo(() => {
    const map = new Map<string, Track>()
    for (const t of library) map.set(t.id, t)
    return map
  }, [library])

  const fresh = useMemo(
    () => mixes.filter(m => m.status === 'fresh'),
    [mixes],
  )

  const byKind = useMemo(() => {
    const buckets = new Map<MixKind, Mix[]>()
    for (const m of fresh) {
      const arr = buckets.get(m.kind) ?? []
      arr.push(m)
      buckets.set(m.kind, arr)
    }
    return buckets
  }, [fresh])

  // Kick off a home feed run if nothing is fresh and conditions allow.
  useEffect(() => {
    if (!isLLMConfigured()) return
    if (library.length < 20) return
    if (fresh.length === 0) {
      void maybeRunHomeFeed().then(() => {
        void useMixStore.getState().load()
      })
    }
  }, [library.length, fresh.length])

  const handleRefresh = useCallback(async () => {
    if (running) return
    setRunning(true)
    try {
      await maybeRunHomeFeed({ force: true })
      await useMixStore.getState().load()
    } finally {
      setRunning(false)
    }
  }, [running])

  const handleSwap = useCallback(async (mix: Mix) => {
    if (!await canSwap()) {
      alert('Swap limit reached for today (3/day). Try again tomorrow.')
      return
    }
    setSwapping(mix.id)
    try {
      await regenerateMix(mix)
      await recordSwap()
    } finally {
      setSwapping(null)
    }
  }, [])

  const handlePlay = useCallback((mix: Mix) => {
    const tracks = mix.trackIds.map(id => trackIndex.get(id)).filter((t): t is Track => !!t)
    if (!tracks.length) return
    onPlayTracks(tracks)
  }, [onPlayTracks, trackIndex])

  const handleSave = useCallback(async (mix: Mix) => {
    const tracks = mix.trackIds.map(id => trackIndex.get(id)).filter((track): track is Track => !!track)
    if (!tracks.length) return
    const playlist = await createAppPlaylist(mix.title, mix.blurb, {
      generatedFromMixId: mix.id,
      origin: 'generated',
    })
    await appendTracksToAppPlaylist(playlist.id, tracks)
    await markSaved(mix.id)
  }, [appendTracksToAppPlaylist, createAppPlaylist, markSaved, trackIndex])

  const handleDismiss = useCallback((mix: Mix) => {
    void dismissMix(mix.id)
  }, [dismissMix])

  if (!isLLMConfigured()) {
    return (
      <ColdStartPanel
        title="Connect an AI model to unlock suggestions"
        body="Set your Anthropic or OpenRouter API key in Settings — Sauti will start surfacing tailored mixes as it learns from your library."
      />
    )
  }

  if (library.length < 20) {
    return (
      <ColdStartPanel
        title="Suggestions grow with your library"
        body={`Sauti needs about 20 tracks to get a sense of your taste. You have ${library.length}. Import music or connect TIDAL to start seeding the system.`}
      />
    )
  }

  return (
    <section className="space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <h2 className="deezer-display text-[1.7rem] leading-none text-[#111116]">Suggested for you</h2>
          <p className="mt-1 text-sm text-[#7a7b86]">Sauti's daily picks, based on your library and listening.</p>
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={running}
          className="inline-flex items-center gap-2 rounded-full border border-black/8 bg-white px-3 py-2 text-sm font-medium text-[#555661] hover:border-black/16 hover:text-[#111116] disabled:opacity-50"
        >
          <RefreshCw size={14} className={running ? 'animate-spin' : ''} />
          Refresh
        </button>
      </header>

      {!tidalConnected ? (
        <div className="rounded-2xl border border-black/8 bg-[#f8f8f9] px-4 py-3 text-sm text-[#555661]">
          Connect TIDAL in Settings to unlock artist bridges and cultural picks — Sauti resolves new discoveries to TIDAL tracks.
        </div>
      ) : null}

      {library.length >= 20 && library.length < 100 && fresh.length < 3 ? (
        <div className="rounded-2xl border border-black/8 bg-[#fdf8f0] px-4 py-3 text-sm text-[#555661]">
          Suggestions grow with your library. Import more music — Sauti starts surfacing Playlist Echoes and Artist bridges once it has more signal.
        </div>
      ) : null}

      {KIND_ORDER.map(kind => {
        const items = byKind.get(kind) ?? []
        if (!items.length) return null
        return (
          <div key={kind} className="space-y-3">
            <div className="flex items-baseline justify-between">
              <h3 className="text-lg font-semibold text-[#111116]">{KIND_META[kind].label}</h3>
              <span className="text-xs text-[#7a7b86]">{KIND_META[kind].subtitle}</span>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {items.map(mix => (
                <MixTile
                  key={mix.id}
                  mix={mix}
                  tracks={mix.trackIds.map(id => trackIndex.get(id)).filter((t): t is Track => !!t)}
                  swapping={swapping === mix.id}
                  onPlay={() => handlePlay(mix)}
                  onSave={() => handleSave(mix)}
                  onSwap={() => handleSwap(mix)}
                  onDismiss={() => handleDismiss(mix)}
                />
              ))}
            </div>
          </div>
        )
      })}

      <div>
        <div className="flex items-baseline justify-between">
          <h3 className="text-lg font-semibold text-[#111116]">Try a mood</h3>
          <span className="text-xs text-[#7a7b86]">Free-form prompt → fresh playlist</span>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {['A dim-lit supper', 'Sunrise run', 'Focus deep work', 'Late-night come-down'].map(label => (
            <button
              key={label}
              type="button"
              onClick={() => handleMoodChip(label)}
              disabled={moodRunning}
              className="rounded-full border border-black/8 bg-white px-3 py-1.5 text-sm text-[#555661] hover:border-black/16 hover:text-[#111116]"
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setShowMood(true)}
            className="rounded-full border border-[#ef5466] bg-[#ef5466] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#e0364a]"
          >
            Custom prompt…
          </button>
        </div>
      </div>

      <LibraryInNumbers library={library} />

      {showMood ? (
        <MoodPromptModal
          onClose={() => setShowMood(false)}
          onSubmit={async (prompt, count) => {
            setShowMood(false)
            await runMoodPrompt(prompt, count)
          }}
        />
      ) : null}

      {moodRunning ? <p className="text-sm text-[#7a7b86]">Building prompt playlist...</p> : null}
      {moodError ? <p className="text-sm text-[var(--sauti-accent-text)]">{moodError}</p> : null}
    </section>
  )

  async function handleMoodChip(prompt: string) {
    await runMoodPrompt(prompt, 15)
  }

  async function runMoodPrompt(prompt: string, count: number) {
    if (moodRunning) return
    setMoodRunning(true)
    setMoodError(null)
    try {
      await handleMood(prompt, count, Boolean(tasteProfile))
      await useMixStore.getState().load()
    } catch (err) {
      setMoodError(err instanceof Error ? err.message : 'Prompt playlist failed.')
    } finally {
      setMoodRunning(false)
    }
  }
}

async function handleMood(
  prompt: string,
  count: number,
  useTaste: boolean,
): Promise<void> {
  if (!isLLMConfigured()) return
  await runBackendGeneration({
    kind: 'mood-playlist',
    prompt,
    count,
    source: 'home',
    useTaste,
  })
}

async function canSwap(): Promise<boolean> {
  await hydrateAppStateFromBackend()
  const arr = getPersistentUiState().mixSwapLog ?? []
  const cutoff = Date.now() - 1000 * 60 * 60 * 24
  return arr.filter(ts => ts > cutoff).length < SWAP_LIMIT_PER_DAY
}

async function recordSwap(): Promise<void> {
  await hydrateAppStateFromBackend()
  const arr = getPersistentUiState().mixSwapLog ?? []
  const cutoff = Date.now() - 1000 * 60 * 60 * 24
  const pruned = arr.filter(ts => ts > cutoff)
  pruned.push(Date.now())
  setPersistentUiState({ mixSwapLog: pruned })
  await pushAppStateSnapshot()
}

function ColdStartPanel({ title, body }: { title: string; body: string }) {
  return (
    <section className="rounded-[28px] border border-black/8 bg-white px-5 py-8 text-center shadow-[0_1px_0_rgba(17,17,22,0.03)]">
      <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-[#fdecef] text-[#ef5466]">
        <Sparkles size={22} />
      </div>
      <h3 className="mt-4 text-lg font-semibold text-[#111116]">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm text-[#686973]">{body}</p>
    </section>
  )
}

function MixTile({
  mix,
  tracks,
  swapping,
  onPlay,
  onSave,
  onSwap,
  onDismiss,
}: {
  mix: Mix
  tracks: Track[]
  swapping: boolean
  onPlay: () => void
  onSave: () => void
  onSwap: () => void
  onDismiss: () => void
}) {
  const preview = tracks.slice(0, 4)
  const replacedCount = mix.unresolvedTracks?.length ?? 0
  return (
    <article className="rounded-2xl border border-black/8 bg-white p-4">
      <div className="flex gap-3">
        <div className="grid h-20 w-20 shrink-0 grid-cols-2 gap-0.5 overflow-hidden rounded-xl bg-[#111116]">
          {preview.length
            ? preview.map((t, i) => <ArtworkCell key={i} track={t} />)
            : <div className="col-span-2 row-span-2 flex items-center justify-center text-white/70"><Disc3 size={22} /></div>}
        </div>
        <div className="min-w-0 flex-1">
          <h4 className="truncate text-sm font-semibold text-[#111116]">{mix.title}</h4>
          {mix.blurb ? <p className="mt-1 line-clamp-2 text-xs text-[#686973]">{mix.blurb}</p> : null}
          <p className="mt-2 text-xs text-[#7a7b86]">
            {tracks.length} tracks
            {mix.unresolvedCount
              ? ` · ${mix.unresolvedCount} couldn't resolve`
              : replacedCount
                ? ` · ${replacedCount} replaced`
                : ''}
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={onPlay} className="rounded-full bg-[#111116] px-3 py-1.5 text-xs font-medium text-white hover:bg-black">
          Preview
        </button>
        <button type="button" onClick={onSave} className="rounded-full border border-black/8 px-3 py-1.5 text-xs font-medium text-[#555661] hover:border-black/16 hover:text-[#111116]">
          Save as playlist
        </button>
        <button type="button" onClick={onSwap} disabled={swapping} className="rounded-full border border-black/8 px-3 py-1.5 text-xs font-medium text-[#555661] hover:border-black/16 hover:text-[#111116] disabled:opacity-50">
          {swapping ? 'Swapping…' : 'Swap'}
        </button>
        <button type="button" onClick={onDismiss} className="ml-auto text-xs text-[#9a9ba3] hover:text-[#555661]">
          Dismiss
        </button>
      </div>
    </article>
  )
}

function ArtworkCell({ track }: { track: Track }) {
  const url = useTrackArtworkUrl(track)
  return url
    ? <img src={url} alt="" className="h-full w-full object-cover" />
    : <div className="flex h-full w-full items-center justify-center bg-[#32323d] text-white/60"><Disc3 size={14} /></div>
}

function MoodPromptModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void
  onSubmit: (prompt: string, count: number) => void
}) {
  const [prompt, setPrompt] = useState('')
  const [count, setCount] = useState(15)
  return (
    <MorphSurface
      open
      onClose={onClose}
      title="Build a mood playlist"
      description='Describe the moment. "slow Sunday brunch", "peak-time warehouse", "rain in Dakar".'
      variant="light"
      size="md"
      align="center"
    >
      <div className="space-y-4">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          className="w-full rounded-xl border border-black/8 bg-[#fafafb] px-3 py-2 text-sm text-[#111116] outline-none focus:border-black/20"
          placeholder="A rainy Tuesday in Dakar…"
        />
        <div className="flex items-center gap-2">
          <label className="text-xs text-[#7a7b86]">Tracks</label>
          <input
            type="number"
            min={5}
            max={50}
            value={count}
            onChange={(e) => setCount(Number(e.target.value) || 15)}
            className="w-20 rounded-xl border border-black/8 bg-[#fafafb] px-2 py-1 text-sm text-[#111116] outline-none focus:border-black/20"
          />
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-full border border-black/8 px-3 py-1.5 text-sm text-[#555661]">Cancel</button>
          <button
            type="button"
            onClick={() => prompt.trim() && onSubmit(prompt.trim(), count)}
            disabled={!prompt.trim()}
            className="rounded-full bg-[#ef5466] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#e0364a] disabled:opacity-50"
          >
            Build
          </button>
        </div>
      </div>
    </MorphSurface>
  )
}

function LibraryInNumbers({ library }: { library: Track[] }) {
  const stats = useMemo(() => {
    const genres = new Map<string, number>()
    const artists = new Map<string, number>()
    let totalSec = 0
    for (const t of library) {
      totalSec += t.duration || 0
      if (t.tags?.genres?.length) {
        for (const g of t.tags.genres) genres.set(g, (genres.get(g) ?? 0) + 1)
      } else if (t.genre) {
        genres.set(t.genre, (genres.get(t.genre) ?? 0) + 1)
      }
      artists.set(t.artist, (artists.get(t.artist) ?? 0) + 1)
    }
    const topGenres = [...genres.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
    const topArtists = [...artists.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
    return {
      totalHours: Math.round(totalSec / 3600),
      topGenres,
      topArtists,
    }
  }, [library])

  return (
    <div className="rounded-2xl border border-black/8 bg-white p-4">
      <h3 className="text-lg font-semibold text-[#111116]">Library in numbers</h3>
      <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCell label="Tracks" value={String(library.length)} />
        <StatCell label="Hours" value={String(stats.totalHours)} />
        <StatCell label="Artists" value={String(stats.topArtists.length >= 5 ? '5+' : stats.topArtists.length)} />
      </dl>
      {stats.topGenres.length ? (
        <div className="mt-4">
          <p className="text-xs font-medium uppercase tracking-wide text-[#9a9ba3]">Top genres</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {stats.topGenres.map(([g, n]) => (
              <span key={g} className="rounded-full bg-[#f4f4f5] px-3 py-1 text-xs text-[#555661]">
                {g} · {n}
              </span>
            ))}
          </div>
        </div>
      ) : null}
      {stats.topArtists.length ? (
        <div className="mt-3">
          <p className="text-xs font-medium uppercase tracking-wide text-[#9a9ba3]">Top artists</p>
          <p className="mt-1 text-sm text-[#555661]">{stats.topArtists.map(([a]) => a).join(' · ')}</p>
        </div>
      ) : null}
    </div>
  )
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-[#f8f8f9] px-3 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-[#9a9ba3]">{label}</p>
      <p className="mt-1 text-lg font-semibold text-[#111116]">{value}</p>
    </div>
  )
}
