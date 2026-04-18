import { useState } from 'react'
import { ArrowRight, Loader2, Stethoscope } from 'lucide-react'
import { isLLMConfigured } from '../lib/llm'
import { playlistDoctor, type DoctorResult } from '../lib/mixGenerator'
import { usePlaylistStore } from '../stores/playlistStore'
import type { Playlist, Track } from '../types'

interface Props {
  playlist: Playlist
  playlistTracks: Track[]
}

export default function PlaylistDoctorPanel({ playlist, playlistTracks }: Props) {
  const moveAppPlaylistItem = usePlaylistStore((s) => s.moveAppPlaylistItem)
  const [running, setRunning] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<DoctorResult | null>(null)

  if (!isLLMConfigured()) return null

  async function handleRun() {
    setRunning(true)
    setError(null)
    try {
      const next = await playlistDoctor(playlist, playlistTracks)
      if (!next) {
        setError("Couldn't build a reorder. Try again.")
        return
      }
      setResult(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Doctor failed')
    } finally {
      setRunning(false)
    }
  }

  async function handleApply() {
    if (!result) return
    setApplying(true)
    try {
      const working = playlistTracks.map((t) => t.id)
      for (let i = 0; i < result.orderedTrackIds.length; i++) {
        const target = result.orderedTrackIds[i]
        const current = working.indexOf(target)
        if (current === -1 || current === i) continue
        await moveAppPlaylistItem(playlist.id, current, i)
        const [moved] = working.splice(current, 1)
        working.splice(i, 0, moved)
      }
      setResult(null)
    } finally {
      setApplying(false)
    }
  }

  const trackById = new Map(playlistTracks.map((t) => [t.id, t]))

  return (
    <section className="rounded-[24px] border border-black/8 bg-white p-5">
      <header className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#eef5ff] text-[#3b6cf2]">
            <Stethoscope size={14} />
          </span>
          <div>
            <h3 className="text-sm font-semibold text-[#111116]">Playlist doctor</h3>
            <p className="text-xs text-[#7a7b86]">Reorder for energy flow — opener, build, peak, wind-down.</p>
          </div>
        </div>
        {!result ? (
          <button
            type="button"
            onClick={() => void handleRun()}
            disabled={running}
            className="inline-flex items-center gap-1.5 rounded-full border border-black/8 bg-white px-3 py-1.5 text-xs font-medium text-[#555661] hover:border-black/16 hover:text-[#111116] disabled:opacity-50"
          >
            {running ? <Loader2 size={12} className="animate-spin" /> : <Stethoscope size={12} />}
            Run doctor
          </button>
        ) : null}
      </header>

      {error ? <p className="text-xs text-red-500">{error}</p> : null}

      {result ? (
        <div className="space-y-3">
          {result.rationale ? <p className="text-sm text-[#555661]">{result.rationale}</p> : null}
          <ol className="space-y-1 rounded-xl border border-black/6 bg-[#fafafb] p-2 text-xs">
            {result.orderedTrackIds.map((id, newIndex) => {
              const t = trackById.get(id)
              if (!t) return null
              const oldIndex = playlistTracks.findIndex((p) => p.id === id)
              const moved = oldIndex !== newIndex
              return (
                <li key={id + newIndex} className="flex items-center gap-2 rounded-md px-2 py-1.5">
                  <span className="w-5 text-right text-[#9a9ba3]">{newIndex + 1}</span>
                  {moved ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-[#eef5ff] px-2 py-0.5 text-[10px] text-[#3b6cf2]">
                      {oldIndex + 1} <ArrowRight size={10} /> {newIndex + 1}
                    </span>
                  ) : (
                    <span className="inline-flex h-4 w-12 items-center justify-center text-[10px] text-[#9a9ba3]">stay</span>
                  )}
                  <span className="min-w-0 flex-1 truncate text-[#111116]">
                    {t.title} <span className="text-[#7a7b86]">— {t.artist}</span>
                  </span>
                </li>
              )
            })}
          </ol>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setResult(null)}
              className="rounded-full border border-black/8 px-3 py-1.5 text-sm text-[#555661]"
            >
              Dismiss
            </button>
            <button
              type="button"
              onClick={() => void handleApply()}
              disabled={applying}
              className="rounded-full bg-[#111116] px-4 py-1.5 text-sm font-medium text-white hover:bg-black disabled:opacity-60"
            >
              {applying ? 'Applying…' : 'Apply reorder'}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
