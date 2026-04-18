import { buildBlurb, callClaudeDirect, getRecommendationsCached, MODEL_SONNET_46, type Recommendation } from './llm'
import { buildSuggestionContext } from './suggestionContext'
import { resolveRecommendations } from './tidalResolver'
import type { Mix, MixKind, MixSeedRef, Playlist, TasteProfile, Track } from '../types'

const FRESH_TTL_MS = 1000 * 60 * 60 * 24 * 2 // 48h

interface GeneratorEnv {
  library: Track[]
  tasteProfile: TasteProfile | null
  excludeLibraryIds?: Set<string>
}

function mixId(kind: MixKind): string {
  return `mix-${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

function nowEnvelope() {
  const generatedAt = Date.now()
  return { generatedAt, expiresAt: generatedAt + FRESH_TTL_MS }
}

function libraryExcludeSet(library: Track[]): Set<string> {
  const ids = new Set<string>()
  for (const t of library) {
    if (t.providerTrackId) ids.add(t.providerTrackId)
    ids.add(t.id)
  }
  return ids
}

// ── Rediscovery ── deterministic selection + LLM-only blurb
export interface GenerateRediscoveryOptions {
  count?: number
  dormantDays?: number
  playStats?: Map<string, { playCount: number; lastPlayedAt: number }>
}

export async function generateRediscovery(
  env: GeneratorEnv,
  options: GenerateRediscoveryOptions = {},
): Promise<Mix | null> {
  const count = options.count ?? 10
  const dormantMs = 1000 * 60 * 60 * 24 * (options.dormantDays ?? 60)
  const stats = options.playStats ?? new Map()
  const now = Date.now()

  const candidates = env.library
    .map(t => {
      const s = stats.get(t.id)
      return {
        track: t,
        playCount: s?.playCount ?? 0,
        lastPlayedAt: s?.lastPlayedAt ?? t.addedAt ?? 0,
      }
    })
    .filter(c => c.playCount >= 1 && now - c.lastPlayedAt > dormantMs)
    .sort((a, b) => b.playCount - a.playCount || a.lastPlayedAt - b.lastPlayedAt)
    .slice(0, count)

  if (candidates.length < 3) return null

  const blurb = await safeBlurb('rediscovery', {
    sampleArtists: candidates.slice(0, 3).map(c => c.track.artist),
    count: candidates.length,
  })

  const id = mixId('rediscovery')
  return {
    id,
    kind: 'rediscovery',
    seedRef: null,
    title: 'Rediscover your library',
    blurb,
    trackIds: candidates.map(c => c.track.id),
    unresolvedCount: 0,
    ...nowEnvelope(),
    status: 'fresh',
  }
}

// ── Track echo ── recommend Tidal tracks that flow from a hot library track
export async function generateTrackEcho(
  env: GeneratorEnv,
  seedTrack: Track,
  options: { count?: number } = {},
): Promise<Mix | null> {
  const count = options.count ?? 10
  const context = buildSuggestionContext({
    libraryTracks: env.library,
    tasteProfile: env.tasteProfile,
    seed: {
      label: '## Track echo seed',
      body: `Seed track: "${seedTrack.title}" — ${seedTrack.artist}${seedTrack.album ? ` (${seedTrack.album})` : ''}.`,
    },
  })

  const instruction = `Track Echo: recommend tracks that flow naturally from the seed track. Match the energy, mood, and genre feel. Vary artists; no duplicates. These should feel like the next track a careful DJ would queue after the seed — not just "similar" tracks.`

  const recs = await safeRecs(context, instruction, count)
  if (!recs.length) return null

  const exclude = env.excludeLibraryIds ?? libraryExcludeSet(env.library)
  const id = mixId('track-echo')
  const { resolved, vetoed } = await resolveRecommendations(recs, {
    excludeIds: exclude,
    mixId: id,
  })
  if (!resolved.length) return null

  const blurb = await safeBlurb('track-echo', {
    seed: { title: seedTrack.title, artist: seedTrack.artist },
    resolvedCount: resolved.length,
  })

  return {
    id,
    kind: 'track-echo',
    seedRef: { type: 'track', id: seedTrack.id },
    title: `Because you've been playing ${seedTrack.artist}`,
    blurb,
    trackIds: resolved.map(r => r.track.id),
    unresolvedCount: vetoed.length,
    ...nowEnvelope(),
    status: 'fresh',
  }
}

// ── Playlist echo ── recommend Tidal tracks in the spirit of a seed playlist
export async function generatePlaylistEcho(
  env: GeneratorEnv,
  seedPlaylist: Playlist,
  seedTracks: Track[],
  options: { count?: number } = {},
): Promise<Mix | null> {
  if (!seedTracks.length) return null
  const count = options.count ?? 12
  const sample = seedTracks.slice(0, 25)
    .map(t => `- "${t.title}" — ${t.artist}`)
    .join('\n')

  const context = buildSuggestionContext({
    libraryTracks: env.library,
    tasteProfile: env.tasteProfile,
    seed: {
      label: `## Playlist echo seed: ${seedPlaylist.name}`,
      body: `Seed playlist "${seedPlaylist.name}":\n${sample}`,
    },
  })

  const instruction = `Playlist Echo: recommend tracks that share the spirit of the seed playlist — its energy arc, mood, and sonic signature — but are NEW to the user's library. Vary the artists. These are meant to feel like a natural cousin playlist.`

  const recs = await safeRecs(context, instruction, count)
  if (!recs.length) return null

  const exclude = env.excludeLibraryIds ?? libraryExcludeSet(env.library)
  const id = mixId('playlist-echo')
  const { resolved, vetoed } = await resolveRecommendations(recs, {
    excludeIds: exclude,
    mixId: id,
  })
  if (!resolved.length) return null

  const blurb = await safeBlurb('playlist-echo', {
    playlistName: seedPlaylist.name,
    resolvedCount: resolved.length,
  })

  return {
    id,
    kind: 'playlist-echo',
    seedRef: { type: 'playlist', id: seedPlaylist.id },
    title: `Echoes of ${seedPlaylist.name}`,
    blurb,
    trackIds: resolved.map(r => r.track.id),
    unresolvedCount: vetoed.length,
    ...nowEnvelope(),
    status: 'fresh',
  }
}

// ── Similar artist ── artist bridge tile
export async function generateSimilarArtist(
  env: GeneratorEnv,
  seedArtist: string,
  options: { count?: number } = {},
): Promise<Mix | null> {
  const count = options.count ?? 5
  const context = buildSuggestionContext({
    libraryTracks: env.library,
    tasteProfile: env.tasteProfile,
    seed: {
      label: '## Similar artist seed',
      body: `Find ONE artist adjacent to ${seedArtist} that feels like a natural bridge — then recommend ${count} of their strongest tracks.`,
    },
  })

  const instruction = `Similar Artist bridge: pick a single artist who bridges from the seed artist to new territory the user would love — based on the taste profile. Then list ${count} of that artist's tracks. Every "artist" field in the response MUST be the SAME artist name.`

  const recs = await safeRecs(context, instruction, count)
  if (!recs.length) return null

  const bridgeArtist = recs[0]?.artist || seedArtist
  const exclude = env.excludeLibraryIds ?? libraryExcludeSet(env.library)
  const id = mixId('similar-artist')
  const { resolved, vetoed } = await resolveRecommendations(recs, {
    excludeIds: exclude,
    mixId: id,
  })
  if (!resolved.length) return null

  const blurb = await safeBlurb('similar-artist', {
    from: seedArtist,
    to: bridgeArtist,
  })

  return {
    id,
    kind: 'similar-artist',
    seedRef: { type: 'artist', name: seedArtist },
    title: `${bridgeArtist} feels like a bridge from ${seedArtist}`,
    blurb,
    trackIds: resolved.map(r => r.track.id),
    unresolvedCount: vetoed.length,
    ...nowEnvelope(),
    status: 'fresh',
  }
}

// ── Cultural bridge ── monthly-feel special
export async function generateCulturalBridge(
  env: GeneratorEnv,
  options: { count?: number } = {},
): Promise<Mix | null> {
  if (!env.tasteProfile?.culturalMarkers?.length) return null
  const count = options.count ?? 8
  const context = buildSuggestionContext({
    libraryTracks: env.library,
    tasteProfile: env.tasteProfile,
    seed: {
      label: '## Cultural bridge',
      body: `Build a cross-cultural bridge mix drawing from the user's cultural markers (${env.tasteProfile.culturalMarkers.join(', ')}). Span multiple regions/genres that feel connected by rhythm or lineage. Prefer lesser-known gems over obvious hits.`,
    },
  })

  const instruction = `Cultural Bridge: ${count} tracks that connect the user's cultural markers across regions. Think rhythm lineage (afro-roots → latin, arabic → flamenco, etc.). Each pick should feel earned — include the bridge reasoning in the "reason" field.`

  const recs = await safeRecs(context, instruction, count)
  if (!recs.length) return null

  const exclude = env.excludeLibraryIds ?? libraryExcludeSet(env.library)
  const id = mixId('cultural-bridge')
  const { resolved, vetoed } = await resolveRecommendations(recs, {
    excludeIds: exclude,
    mixId: id,
  })
  if (!resolved.length) return null

  const blurb = await safeBlurb('cultural-bridge', {
    markers: env.tasteProfile.culturalMarkers,
    resolvedCount: resolved.length,
  })

  return {
    id,
    kind: 'cultural-bridge',
    seedRef: null,
    title: 'A cross-cultural bridge',
    blurb,
    trackIds: resolved.map(r => r.track.id),
    unresolvedCount: vetoed.length,
    ...nowEnvelope(),
    status: 'fresh',
  }
}

// ── Mood-from-prompt ── user-initiated
export async function generateMoodPlaylist(
  env: GeneratorEnv,
  prompt: string,
  options: { count?: number } = {},
): Promise<Mix | null> {
  const count = options.count ?? 15
  const context = buildSuggestionContext({
    libraryTracks: env.library,
    tasteProfile: env.tasteProfile,
    seed: {
      label: '## Mood prompt',
      body: prompt,
    },
  })

  const instruction = `Mood playlist: build a ${count}-track playlist matching the user's prompt. Think energy flow — the opener, the build, the closer. Respect the taste profile.`

  const recs = await safeRecs(context, instruction, count)
  if (!recs.length) return null

  const exclude = env.excludeLibraryIds ?? libraryExcludeSet(env.library)
  const id = mixId('setlist-seed') // shares kind semantically
  const { resolved, vetoed } = await resolveRecommendations(recs, {
    excludeIds: exclude,
    mixId: id,
  })
  if (!resolved.length) return null

  const blurb = await safeBlurb('mood', { prompt, resolvedCount: resolved.length })

  return {
    id,
    kind: 'setlist-seed',
    seedRef: { type: 'mood', prompt },
    title: prompt.slice(0, 80),
    blurb,
    trackIds: resolved.map(r => r.track.id),
    unresolvedCount: vetoed.length,
    focusPrompt: prompt,
    ...nowEnvelope(),
    status: 'fresh',
  }
}

// ── Setlist seed ── playlist-from-track with optional focus
export async function generateSetlistSeed(
  env: GeneratorEnv,
  seedTrack: Track,
  options: { count?: number; focusPrompt?: string; useProfile?: boolean } = {},
): Promise<Mix | null> {
  const count = options.count ?? 15
  const context = buildSuggestionContext({
    libraryTracks: env.library,
    tasteProfile: env.tasteProfile,
    includeProfile: options.useProfile !== false,
    seed: {
      label: '## Setlist seed',
      body: `Seed track: "${seedTrack.title}" — ${seedTrack.artist}.${options.focusPrompt ? `\nFocus: ${options.focusPrompt}` : ''}`,
    },
  })

  const instruction = `Setlist from track: build a ${count}-track DJ-friendly set starting from the seed. Respect BPM/energy flow — opener, build, peak, wind-down. Vary artists, no repeats. Prefer tracks that would beatmatch or key-mix well.`

  const recs = await safeRecs(context, instruction, count)
  if (!recs.length) return null

  const id = mixId('setlist-seed')
  const { resolved, vetoed } = await resolveRecommendations(recs, {
    mixId: id,
  })
  if (!resolved.length) return null

  const blurb = await safeBlurb('setlist-seed', {
    seed: { title: seedTrack.title, artist: seedTrack.artist },
    focus: options.focusPrompt,
  })

  return {
    id,
    kind: 'setlist-seed',
    seedRef: { type: 'track', id: seedTrack.id },
    title: `Setlist from ${seedTrack.title}`,
    blurb,
    trackIds: resolved.map(r => r.track.id),
    unresolvedCount: vetoed.length,
    focusPrompt: options.focusPrompt,
    ...nowEnvelope(),
    status: 'fresh',
  }
}

// ── Playlist footer ── "you might also like"
export async function generatePlaylistFooter(
  env: GeneratorEnv,
  playlist: Playlist,
  playlistTracks: Track[],
  options: { count?: number } = {},
): Promise<Mix | null> {
  if (!playlistTracks.length) return null
  const count = options.count ?? 8
  const sample = playlistTracks.slice(-15)
    .map(t => `- "${t.title}" — ${t.artist}`)
    .join('\n')

  const context = buildSuggestionContext({
    libraryTracks: env.library,
    tasteProfile: env.tasteProfile,
    seed: {
      label: `## Footer for: ${playlist.name}`,
      body: `Last tracks in playlist:\n${sample}`,
    },
  })

  const instruction = `Playlist footer: recommend ${count} tracks that would make sense AFTER the last track in this playlist — same energy lane, flowing onward. These should be new to the user's library.`

  const recs = await safeRecs(context, instruction, count)
  if (!recs.length) return null

  const exclude = env.excludeLibraryIds ?? libraryExcludeSet(env.library)
  const id = mixId('playlist-footer')
  const { resolved, vetoed } = await resolveRecommendations(recs, {
    excludeIds: exclude,
    mixId: id,
  })
  if (!resolved.length) return null

  const blurb = await safeBlurb('playlist-footer', {
    playlistName: playlist.name,
    resolvedCount: resolved.length,
  })

  return {
    id,
    kind: 'playlist-footer',
    seedRef: { type: 'playlist', id: playlist.id },
    title: 'You might also like',
    blurb,
    trackIds: resolved.map(r => r.track.id),
    unresolvedCount: vetoed.length,
    ...nowEnvelope(),
    status: 'fresh',
  }
}

// ── Auto-radio batch ── returns raw Tidal tracks for the queue, not a Mix
export async function generateAutoRadioBatch(
  env: GeneratorEnv,
  seedTrack: Track,
  size = 10,
): Promise<Track[]> {
  const context = buildSuggestionContext({
    libraryTracks: env.library,
    tasteProfile: env.tasteProfile,
    seed: {
      label: '## Auto-radio seed',
      body: `Seed: "${seedTrack.title}" — ${seedTrack.artist}. Keep the energy lane, expand the horizon. Do not repeat library tracks.`,
    },
  })

  const instruction = `Auto-radio: ${size} tracks that continue the session. All tracks must be NEW to the library. Vary artists. Focus on natural DJ flow, not just taste similarity.`

  const recs = await safeRecs(context, instruction, size)
  if (!recs.length) return []

  const exclude = env.excludeLibraryIds ?? libraryExcludeSet(env.library)
  const { resolved } = await resolveRecommendations(recs, {
    excludeIds: exclude,
    mixId: `auto-radio-${Date.now()}`,
  })
  return resolved.map(r => r.track)
}

// ── Helpers ──

async function safeRecs(
  context: ReturnType<typeof buildSuggestionContext>,
  instruction: string,
  count: number,
): Promise<Recommendation[]> {
  try {
    return await getRecommendationsCached(context, instruction, { count })
  } catch (err) {
    console.error('Recommendation call failed', err)
    return []
  }
}

async function safeBlurb(kind: string, payload: Record<string, unknown>): Promise<string> {
  try {
    return await buildBlurb(kind, payload)
  } catch {
    return ''
  }
}

// ── Playlist doctor ── reorder existing tracks for energy flow
export interface DoctorResult {
  orderedTrackIds: string[]
  rationale: string
}

export async function playlistDoctor(
  playlist: Playlist,
  playlistTracks: Track[],
): Promise<DoctorResult | null> {
  if (playlistTracks.length < 3) return null

  const lines = playlistTracks
    .map((t, i) => {
      const tags = t.tags
      const energy = tags?.energy != null ? `e=${tags.energy.toFixed(2)}` : null
      const bpm = tags?.bpmEstimate ? `bpm=${tags.bpmEstimate}` : null
      const mood = tags?.mood ?? null
      const meta = [energy, bpm, mood].filter(Boolean).join(' ')
      return `${i}: "${t.title}" — ${t.artist}${meta ? ` [${meta}]` : ''}`
    })
    .join('\n')

  const prompt = `You are a DJ assistant. Reorder this playlist for a smooth energy arc — opener, build, peak, wind-down. Use the energy/bpm/mood hints when present. Do NOT add or remove tracks; only reorder.

Playlist: ${playlist.name}
Tracks (current order):
${lines}

Respond as JSON: {"order": [<index>, ...], "rationale": "<one or two sentences>"}.
The order array must contain every original index exactly once, length ${playlistTracks.length}.`

  const response = await callClaudeDirect(
    [{ role: 'user', content: prompt }],
    { model: MODEL_SONNET_46, maxTokens: 800 },
  )

  const json = extractJsonObject(response)
  if (!json) return null
  const orderRaw = Array.isArray(json.order) ? json.order : null
  if (!orderRaw || orderRaw.length !== playlistTracks.length) return null

  const seen = new Set<number>()
  const indices: number[] = []
  for (const v of orderRaw) {
    const i = Number(v)
    if (!Number.isInteger(i) || i < 0 || i >= playlistTracks.length) return null
    if (seen.has(i)) return null
    seen.add(i)
    indices.push(i)
  }
  if (indices.length !== playlistTracks.length) return null

  return {
    orderedTrackIds: indices.map(i => playlistTracks[i].id),
    rationale: typeof json.rationale === 'string' ? json.rationale : '',
  }
}

function extractJsonObject(s: string): Record<string, unknown> | null {
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(s.slice(start, end + 1))
  } catch {
    return null
  }
}

// Re-export for callers wanting types
export type { MixSeedRef }
