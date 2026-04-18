import { useEffect, useState } from 'react'
import { BarChart3, RefreshCw } from 'lucide-react'
import { db } from '../db'
import type { ListenEvent, MixKind } from '../types'

interface KindRow {
  kind: MixKind | 'auto-radio' | 'manual' | 'other'
  plays: number
  completes: number
  skips: number
}

const ALL_KINDS: KindRow['kind'][] = [
  'playlist-echo',
  'track-echo',
  'similar-artist',
  'rediscovery',
  'cultural-bridge',
  'setlist-seed',
  'playlist-footer',
  'auto-radio-buffer',
  'auto-radio',
  'manual',
  'other',
]

export default function AIStatsPanel() {
  const [rows, setRows] = useState<KindRow[]>([])
  const [loading, setLoading] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const events = await db.listenEvents.toArray()
      const buckets = new Map<KindRow['kind'], KindRow>()
      for (const k of ALL_KINDS) buckets.set(k, { kind: k, plays: 0, completes: 0, skips: 0 })

      const mixCache = new Map<string, MixKind>()
      for (const ev of events) {
        const kind = await classify(ev, mixCache)
        const row = buckets.get(kind) ?? { kind, plays: 0, completes: 0, skips: 0 }
        row.plays += 1
        if (ev.completed) row.completes += 1
        if (ev.skipped) row.skips += 1
        buckets.set(kind, row)
      }
      setRows([...buckets.values()].filter((r) => r.plays > 0))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  return (
    <section className="rounded-[24px] border border-black/8 bg-white p-4">
      <header className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-medium text-[#686973]">
          <BarChart3 size={16} />
          AI stats (dev)
        </h3>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-full border border-black/8 bg-white px-3 py-1.5 text-xs font-medium text-[#555661] hover:border-black/16 hover:text-[#111116] disabled:opacity-50"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </header>
      {!rows.length ? (
        <p className="text-xs text-[#7a7b86]">No listen events yet. Play some tracks to populate this panel.</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[#9a9ba3]">
              <th className="py-1">Source</th>
              <th className="py-1 text-right">Plays</th>
              <th className="py-1 text-right">Completes</th>
              <th className="py-1 text-right">Skips</th>
              <th className="py-1 text-right">Accept</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const accept = row.plays > 0 ? Math.round((row.completes / row.plays) * 100) : 0
              return (
                <tr key={row.kind} className="border-t border-black/6">
                  <td className="py-1.5 text-[#111116]">{row.kind}</td>
                  <td className="py-1.5 text-right text-[#555661]">{row.plays}</td>
                  <td className="py-1.5 text-right text-[#555661]">{row.completes}</td>
                  <td className="py-1.5 text-right text-[#555661]">{row.skips}</td>
                  <td className="py-1.5 text-right font-medium text-[#111116]">{accept}%</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </section>
  )
}

async function classify(
  ev: ListenEvent,
  cache: Map<string, MixKind>,
): Promise<KindRow['kind']> {
  const ctx = ev.context
  if (ctx === 'manual' || ctx === 'auto-radio' || ctx === 'search') {
    return ctx === 'search' ? 'other' : ctx
  }
  if (ctx.startsWith('suggestion:')) {
    const mixId = ctx.slice('suggestion:'.length)
    let kind = cache.get(mixId)
    if (!kind) {
      const mix = await db.mixes.get(mixId)
      if (mix) {
        kind = mix.kind
        cache.set(mixId, kind)
      }
    }
    return kind ?? 'other'
  }
  if (ctx.startsWith('playlist:')) return 'other'
  return 'other'
}
