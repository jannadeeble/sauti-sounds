import type { Track } from '../types'

export type LLMProvider = 'claude' | 'openai' | 'gemini'

interface LLMConfig {
  provider: LLMProvider
  apiKey: string
  model?: string
}

let config: LLMConfig | null = null

export const DEEP_THINKING_MODEL = 'claude-sonnet-4-5'
export const FAST_MODEL = 'claude-haiku-4-5-20251001'
const DEFAULT_THINKING_BUDGET = 6000

export function configureLLM(provider: LLMProvider, apiKey: string, model?: string) {
  config = { provider, apiKey, model }
}

export function isLLMConfigured(): boolean {
  return config !== null && !!config.apiKey
}

export function getLLMConfig(): LLMConfig | null {
  return config
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface CallOptions {
  maxTokens?: number
  thinking?: boolean
  thinkingBudget?: number
  modelOverride?: string
}

async function callLLM(messages: ChatMessage[], options: CallOptions = {}): Promise<string> {
  if (!config) throw new Error('LLM not configured')

  switch (config.provider) {
    case 'claude':
      return callClaude(messages, options)
    case 'openai':
      return callOpenAI(messages, options.maxTokens ?? 2048)
    case 'gemini':
      return callGemini(messages, options.maxTokens ?? 2048)
    default:
      throw new Error(`Unknown provider: ${config.provider}`)
  }
}

async function callClaude(messages: ChatMessage[], options: CallOptions): Promise<string> {
  const { maxTokens = 2048, thinking = false, thinkingBudget = DEFAULT_THINKING_BUDGET, modelOverride } = options
  const systemMsg = messages.find(m => m.role === 'system')?.content || ''
  const userMessages = messages.filter(m => m.role !== 'system').map(m => ({
    role: m.role,
    content: m.content,
  }))

  const model = modelOverride || config!.model || 'claude-sonnet-4-20250514'
  const body: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    system: systemMsg,
    messages: userMessages,
  }

  if (thinking) {
    body.thinking = { type: 'enabled', budget_tokens: thinkingBudget }
    if ((body.max_tokens as number) <= thinkingBudget) {
      body.max_tokens = thinkingBudget + 1024
    }
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config!.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Claude API error: ${res.status} ${err}`)
  }

  const data = await res.json()
  if (!Array.isArray(data.content)) return ''
  const textBlock = data.content.find((b: { type: string }) => b.type === 'text')
  return textBlock?.text ?? ''
}

async function callOpenAI(messages: ChatMessage[], maxTokens: number): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config!.apiKey}`,
    },
    body: JSON.stringify({
      model: config!.model || 'gpt-4o',
      max_tokens: maxTokens,
      messages,
    }),
  })

  if (!res.ok) throw new Error(`OpenAI API error: ${res.status}`)
  const data = await res.json()
  return data.choices[0].message.content
}

async function callGemini(messages: ChatMessage[], maxTokens: number): Promise<string> {
  const model = config!.model || 'gemini-2.0-flash'
  const contents = messages
    .filter(m => m.role !== 'system')
    .map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }))

  const systemInstruction = messages.find(m => m.role === 'system')

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config!.apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        systemInstruction: systemInstruction
          ? { parts: [{ text: systemInstruction.content }] }
          : undefined,
        generationConfig: { maxOutputTokens: maxTokens },
      }),
    }
  )

  if (!res.ok) throw new Error(`Gemini API error: ${res.status}`)
  const data = await res.json()
  return data.candidates[0].content.parts[0].text
}

// ── Track Tagging ──

export interface TrackTags {
  energy: number
  mood: string
  genres: string[]
  bpmEstimate?: number
  vibeDescriptors: string[]
  culturalContext?: string
}

export async function tagTracks(tracks: Track[]): Promise<Map<string, TrackTags>> {
  const batchSize = 20
  const results = new Map<string, TrackTags>()

  for (let i = 0; i < tracks.length; i += batchSize) {
    const batch = tracks.slice(i, i + batchSize)
    const trackList = batch.map((t, idx) =>
      `${idx + 1}. "${t.title}" by ${t.artist} (Album: ${t.album}${t.genre ? `, Genre: ${t.genre}` : ''})`
    ).join('\n')

    const response = await callLLM([
      {
        role: 'system',
        content: `You are a music analysis expert. Tag each track with:
- energy: 0.0-1.0 (0=calm/ambient, 0.5=moderate, 1.0=peak energy)
- mood: one primary mood word (e.g., melancholic, euphoric, chill, energetic, dreamy, groovy)
- genres: 1-3 specific genres (e.g., afro-house, amapiano, deep house, nu-jazz)
- bpmEstimate: estimated BPM if you can infer it
- vibeDescriptors: 2-4 descriptive words about the vibe
- culturalContext: cultural origin/influence if identifiable

Respond with valid JSON array only, one object per track. No markdown, no explanation.`,
      },
      {
        role: 'user',
        content: `Tag these tracks:\n${trackList}`,
      },
    ])

    try {
      const parsed = JSON.parse(response.replace(/```json?\n?|\n?```/g, ''))
      if (Array.isArray(parsed)) {
        parsed.forEach((tags: any, idx: number) => {
          if (batch[idx]) {
            results.set(batch[idx].id, {
              energy: typeof tags.energy === 'number' ? tags.energy : 0.5,
              mood: tags.mood || 'neutral',
              genres: Array.isArray(tags.genres) ? tags.genres : [],
              bpmEstimate: tags.bpmEstimate,
              vibeDescriptors: Array.isArray(tags.vibeDescriptors) ? tags.vibeDescriptors : [],
              culturalContext: tags.culturalContext,
            })
          }
        })
      }
    } catch {
      console.error('Failed to parse LLM tag response')
    }
  }

  return results
}

// ── Taste Profile ──

export interface TasteProfile {
  coreIdentity: string
  primaryGenres: string[]
  energyPreference: { min: number; max: number; sweet_spot: number }
  culturalMarkers: string[]
  antiPreferences: string[]
  favoriteArtists: string[]
  moodPreferences: string[]
}

export async function buildTasteProfile(tracks: Track[], _listeningHistory?: any[]): Promise<TasteProfile> {
  const trackSummary = tracks.slice(0, 200).map(t =>
    `"${t.title}" by ${t.artist}${t.genre ? ` [${t.genre}]` : ''}`
  ).join('\n')

  const response = await callLLM([
    {
      role: 'system',
      content: `You are a music taste analyst. Based on a user's library, create a detailed taste profile. Respond with valid JSON only matching this structure:
{
  "coreIdentity": "brief description of their musical identity",
  "primaryGenres": ["genre1", "genre2", ...],
  "energyPreference": { "min": 0.0, "max": 1.0, "sweet_spot": 0.5 },
  "culturalMarkers": ["influence1", "influence2", ...],
  "antiPreferences": ["things they probably don't like"],
  "favoriteArtists": ["artist1", "artist2", ...],
  "moodPreferences": ["mood1", "mood2", ...]
}`,
    },
    {
      role: 'user',
      content: `Build a taste profile from this library (${tracks.length} total tracks, showing first 200):\n${trackSummary}`,
    },
  ])

  try {
    return JSON.parse(response.replace(/```json?\n?|\n?```/g, ''))
  } catch {
    return {
      coreIdentity: 'Music enthusiast',
      primaryGenres: [],
      energyPreference: { min: 0.2, max: 0.8, sweet_spot: 0.5 },
      culturalMarkers: [],
      antiPreferences: [],
      favoriteArtists: [],
      moodPreferences: [],
    }
  }
}

// ── Recommendations ──

export interface RecommendationRequest {
  mode: 'song-radio' | 'playlist-continuation' | 'build-similar' | 'extend' | 'create-for'
  seedTracks?: Track[]
  seedPlaylist?: Track[]
  prompt?: string // for "create for" mode
  tasteProfile?: TasteProfile
  count?: number
}

export interface Recommendation {
  artist: string
  title: string
  reason: string
}

export async function getRecommendations(req: RecommendationRequest): Promise<Recommendation[]> {
  const count = req.count || 10

  let systemPrompt = `You are an expert music curator and DJ. You deeply understand musical flow, energy, mood, genre, and cultural context. You recommend tracks that create natural listening experiences — not just "similar" tracks, but tracks that make sense following each other.

Always respond with a valid JSON array of objects: [{"artist": "...", "title": "...", "reason": "..."}]
No markdown, no explanation outside the JSON.`

  let userPrompt = ''

  if (req.tasteProfile) {
    systemPrompt += `\n\nUser's taste profile:
- Identity: ${req.tasteProfile.coreIdentity}
- Primary genres: ${req.tasteProfile.primaryGenres.join(', ')}
- Energy sweet spot: ${req.tasteProfile.energyPreference.sweet_spot}
- Cultural influences: ${req.tasteProfile.culturalMarkers.join(', ')}
- Avoids: ${req.tasteProfile.antiPreferences.join(', ')}`
  }

  switch (req.mode) {
    case 'song-radio': {
      const seed = req.seedTracks?.[0]
      if (!seed) throw new Error('Song radio needs a seed track')
      userPrompt = `Song Radio: Generate ${count} tracks that flow naturally from "${seed.title}" by ${seed.artist}${seed.genre ? ` [${seed.genre}]` : ''}.
Match the energy level, genre feel, and mood. Vary the artists — no repeats. Think like a DJ building a cohesive set from this starting point.`
      break
    }

    case 'playlist-continuation': {
      const playlist = req.seedPlaylist
      if (!playlist?.length) throw new Error('Need playlist to continue')
      const playlistStr = playlist.slice(-10).map(t => `"${t.title}" by ${t.artist}`).join('\n')
      userPrompt = `Continue this playlist with ${count} more tracks. Understand the energy arc and mood trajectory — continue it, don't restart it.

Last tracks in playlist:
${playlistStr}`
      break
    }

    case 'build-similar': {
      const playlist = req.seedPlaylist
      if (!playlist?.length) throw new Error('Need playlist to build from')
      const playlistStr = playlist.slice(0, 20).map(t => `"${t.title}" by ${t.artist}`).join('\n')
      userPrompt = `Build a new playlist with a similar vibe but DIFFERENT tracks (no overlaps). ${count} tracks.

Original playlist:
${playlistStr}`
      break
    }

    case 'extend': {
      const playlist = req.seedPlaylist
      if (!playlist?.length) throw new Error('Need playlist to extend')
      const playlistStr = playlist.map(t => `"${t.title}" by ${t.artist}`).join('\n')
      userPrompt = `Add ${count} tracks to extend this playlist. Respect the existing energy arc.

Current playlist:
${playlistStr}`
      break
    }

    case 'create-for': {
      if (!req.prompt) throw new Error('Need a description')
      userPrompt = `Create a ${count}-track playlist for: "${req.prompt}"
Consider energy flow, genre coherence, and mood journey. Start with a track that sets the scene, build through the middle, and end intentionally.`
      break
    }
  }

  const response = await callLLM([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ])

  try {
    return JSON.parse(response.replace(/```json?\n?|\n?```/g, ''))
  } catch {
    console.error('Failed to parse recommendations')
    return []
  }
}

// ── AI Chat ──

export async function chat(
  message: string,
  context: { currentTrack?: Track; recentTracks?: Track[]; tasteProfile?: TasteProfile }
): Promise<string> {
  let systemPrompt = `You are Sauti, an AI music assistant inside the Sauti Sounds music player. You help users discover music, build playlists, and understand their taste. Be warm, knowledgeable, and conversational. You have deep knowledge of global music — especially African, Latin, electronic, jazz, and world music.

When recommending tracks, format them clearly. When asked to create playlists, respond with a JSON code block containing an array of {artist, title, reason} objects.`

  if (context.tasteProfile) {
    systemPrompt += `\n\nUser's music taste: ${context.tasteProfile.coreIdentity}. Genres: ${context.tasteProfile.primaryGenres.join(', ')}.`
  }

  let contextStr = ''
  if (context.currentTrack) {
    contextStr += `\nCurrently playing: "${context.currentTrack.title}" by ${context.currentTrack.artist}`
  }
  if (context.recentTracks?.length) {
    contextStr += `\nRecent tracks: ${context.recentTracks.slice(0, 5).map(t => `"${t.title}" by ${t.artist}`).join(', ')}`
  }

  const userMessage = contextStr ? `${contextStr}\n\nUser: ${message}` : message

  return callLLM([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ])
}

// ── Atomized Suggestion Generators ──

function parseJsonArray<T>(raw: string): T[] {
  const cleaned = raw.replace(/```json?\n?|\n?```/g, '').trim()
  const firstBracket = cleaned.indexOf('[')
  const lastBracket = cleaned.lastIndexOf(']')
  const sliced = firstBracket >= 0 && lastBracket > firstBracket
    ? cleaned.slice(firstBracket, lastBracket + 1)
    : cleaned
  try {
    const parsed = JSON.parse(sliced)
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch {
    return []
  }
}

export interface TrackCandidate {
  title: string
  artist: string
  reason: string
}

export interface SeedTrackSummary {
  title: string
  artist: string
  genre?: string
  bpm?: number
  energy?: number
  mood?: string
  tags?: string[]
}

export interface LibrarySummaryEntry {
  title: string
  artist: string
  source: 'local' | 'tidal'
  genre?: string
  playCount?: number
  lastPlayedAt?: number
}

function formatSeed(seed: SeedTrackSummary) {
  const extras: string[] = []
  if (seed.genre) extras.push(`genre: ${seed.genre}`)
  if (seed.bpm) extras.push(`~${seed.bpm} BPM`)
  if (typeof seed.energy === 'number') extras.push(`energy ${seed.energy.toFixed(2)}`)
  if (seed.mood) extras.push(`mood: ${seed.mood}`)
  if (seed.tags?.length) extras.push(`tags: ${seed.tags.join(', ')}`)
  return `"${seed.title}" by ${seed.artist}${extras.length ? ` [${extras.join(' · ')}]` : ''}`
}

function formatLibrarySample(entries: LibrarySummaryEntry[], limit = 120) {
  return entries
    .slice(0, limit)
    .map((entry) => `"${entry.title}" by ${entry.artist}${entry.genre ? ` [${entry.genre}]` : ''}`)
    .join('\n')
}

export interface SetlistSeedsInput {
  seed: SeedTrackSummary
  librarySample: LibrarySummaryEntry[]
  tasteProfile?: TasteProfile
  recentPlays?: LibrarySummaryEntry[]
  count?: number
}

export async function generateSetlistSeeds(input: SetlistSeedsInput): Promise<TrackCandidate[]> {
  const count = input.count ?? 15

  const system = `You are a DJ-grade music curator helping a DJ build a 15-track setlist from a single seed track.

Your only job is to output ${count} tracks that flow naturally from the seed, as a JSON array.
Do NOT order by energy — the app will re-order using BPM/energy metadata.
Do NOT restate the seed track. Do NOT include tracks the user already owns (list is provided).
Each track must be a real, published recording that would exist on Tidal.

Output strictly a JSON array of objects: [{"title": "...", "artist": "...", "reason": "..."}]
"reason" must be one short sentence explaining the musical connection.
No markdown. No commentary outside the JSON.`

  const tasteBlock = input.tasteProfile
    ? `\n\nUser taste profile:\n- Identity: ${input.tasteProfile.coreIdentity}\n- Primary genres: ${input.tasteProfile.primaryGenres.join(', ')}\n- Cultural influences: ${input.tasteProfile.culturalMarkers.join(', ')}\n- Avoids: ${input.tasteProfile.antiPreferences.join(', ')}`
    : ''

  const recentBlock = input.recentPlays?.length
    ? `\n\nRecently played (signal, not to repeat):\n${formatLibrarySample(input.recentPlays, 15)}`
    : ''

  const user = `Seed track: ${formatSeed(input.seed)}${tasteBlock}${recentBlock}

User library (exclude these from your picks):
${formatLibrarySample(input.librarySample, 150)}

Return exactly ${count} track picks.`

  const response = await callLLM(
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    { thinking: true, thinkingBudget: DEFAULT_THINKING_BUDGET, maxTokens: 4096, modelOverride: DEEP_THINKING_MODEL },
  )

  return parseJsonArray<TrackCandidate>(response).slice(0, count)
}

export interface PlaylistFooterInput {
  playlistName: string
  tracks: SeedTrackSummary[]
  librarySample: LibrarySummaryEntry[]
  tasteProfile?: TasteProfile
  count?: number
}

export async function generatePlaylistFooterSuggestions(input: PlaylistFooterInput): Promise<TrackCandidate[]> {
  const count = input.count ?? 8

  const avgBpm = average(input.tracks.map((t) => t.bpm).filter((v): v is number => typeof v === 'number'))
  const avgEnergy = average(input.tracks.map((t) => t.energy).filter((v): v is number => typeof v === 'number'))
  const moodSet = new Set(input.tracks.map((t) => t.mood).filter(Boolean) as string[])
  const genreSet = new Set(input.tracks.map((t) => t.genre).filter(Boolean) as string[])

  const system = `You are a music curator extending a specific playlist.

Output exactly ${count} new tracks that match the playlist's character but are not already in the user's library.
Prioritize the playlist's dominant genre, mood, and energy band.
Output strictly a JSON array: [{"title": "...", "artist": "...", "reason": "..."}]
"reason" must be one short sentence anchored to the playlist's vibe. No markdown, no prose outside the JSON.`

  const summary = [
    avgBpm ? `average BPM ~${Math.round(avgBpm)}` : null,
    avgEnergy ? `average energy ${avgEnergy.toFixed(2)}` : null,
    moodSet.size ? `moods: ${[...moodSet].join(', ')}` : null,
    genreSet.size ? `genres: ${[...genreSet].join(', ')}` : null,
  ].filter(Boolean).join(' · ')

  const tasteBlock = input.tasteProfile
    ? `\n\nUser taste:\n- Identity: ${input.tasteProfile.coreIdentity}\n- Cultural influences: ${input.tasteProfile.culturalMarkers.join(', ')}`
    : ''

  const user = `Playlist: "${input.playlistName}"
Summary: ${summary || '(sparse metadata — infer from titles)'}

Tracks in the playlist:
${input.tracks.slice(0, 40).map((t) => `- ${formatSeed(t)}`).join('\n')}
${tasteBlock}

User library (exclude):
${formatLibrarySample(input.librarySample, 120)}

Return exactly ${count} picks.`

  const response = await callLLM(
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    { thinking: true, thinkingBudget: DEFAULT_THINKING_BUDGET, maxTokens: 3072, modelOverride: DEEP_THINKING_MODEL },
  )

  return parseJsonArray<TrackCandidate>(response).slice(0, count)
}

export interface SimilarArtistInput {
  seedArtist: string
  librarySample: LibrarySummaryEntry[]
  tasteProfile?: TasteProfile
  count?: number
}

export interface SimilarArtistResult {
  artist: string
  characterization: string
  picks: TrackCandidate[]
}

export async function generateSimilarArtist(input: SimilarArtistInput): Promise<SimilarArtistResult | null> {
  const count = input.count ?? 5
  const system = `You recommend one artist similar to a given artist, with a characterization and ${count} signature picks.

Output strictly a JSON object:
{"artist": "...", "characterization": "one sentence on what links them and what's distinctive", "picks": [{"title": "...", "artist": "...", "reason": "..."}, ...]}
No markdown, no prose outside the JSON.`

  const tasteBlock = input.tasteProfile
    ? `\n\nUser cultural influences: ${input.tasteProfile.culturalMarkers.join(', ')}`
    : ''

  const user = `Seed artist: ${input.seedArtist}${tasteBlock}

Artists already in user's library (avoid suggesting these):
${[...new Set(input.librarySample.map((e) => e.artist))].slice(0, 60).join(', ')}

Suggest one similar artist with ${count} picks.`

  const response = await callLLM(
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    { thinking: true, thinkingBudget: 3500, maxTokens: 2048, modelOverride: DEEP_THINKING_MODEL },
  )

  try {
    const cleaned = response.replace(/```json?\n?|\n?```/g, '').trim()
    const first = cleaned.indexOf('{')
    const last = cleaned.lastIndexOf('}')
    const sliced = first >= 0 && last > first ? cleaned.slice(first, last + 1) : cleaned
    const parsed = JSON.parse(sliced)
    if (parsed && typeof parsed.artist === 'string') {
      return {
        artist: parsed.artist,
        characterization: parsed.characterization ?? '',
        picks: Array.isArray(parsed.picks) ? parsed.picks.slice(0, count) : [],
      }
    }
  } catch {
    return null
  }
  return null
}

export interface AdjudicatorInput {
  target: { title: string; artist: string }
  candidates: Array<{ title: string; artist: string; album?: string }>
}

export async function pickBestTidalMatch(input: AdjudicatorInput): Promise<{ index: number; reason: string } | null> {
  if (input.candidates.length === 0) return null
  if (input.candidates.length === 1) return { index: 0, reason: 'single candidate' }

  const system = `You pick which Tidal search result matches a target track. Respond with ONLY JSON: {"index": N, "reason": "..."} or {"index": -1, "reason": "..."} if none match.

Prefer original studio versions over live/karaoke/instrumental/cover unless the target explicitly asks for one. Index is zero-based.`

  const user = `Target: "${input.target.title}" by ${input.target.artist}

Candidates:
${input.candidates.map((c, i) => `${i}. "${c.title}" by ${c.artist}${c.album ? ` (album: ${c.album})` : ''}`).join('\n')}`

  const response = await callLLM(
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    { maxTokens: 256, modelOverride: FAST_MODEL },
  )

  try {
    const cleaned = response.replace(/```json?\n?|\n?```/g, '').trim()
    const first = cleaned.indexOf('{')
    const last = cleaned.lastIndexOf('}')
    const sliced = first >= 0 && last > first ? cleaned.slice(first, last + 1) : cleaned
    const parsed = JSON.parse(sliced)
    if (typeof parsed.index === 'number') {
      if (parsed.index < 0 || parsed.index >= input.candidates.length) return null
      return { index: parsed.index, reason: String(parsed.reason ?? '') }
    }
  } catch {
    return null
  }
  return null
}

function average(values: number[]): number | null {
  if (!values.length) return null
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

// ── Library Summary Helper ──

export function toLibrarySummary(track: Track, playCount?: number, lastPlayedAt?: number): LibrarySummaryEntry {
  return {
    title: track.title,
    artist: track.artist,
    source: track.source,
    genre: track.genre,
    playCount,
    lastPlayedAt,
  }
}

