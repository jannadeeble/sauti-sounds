import type { TasteProfile, Track, TrackTags } from '../types'
import { apiPost } from './api'

export type { TasteProfile, TrackTags } from '../types'

export type LLMProvider = 'claude' | 'openai' | 'gemini' | 'openrouter'

// Default models for the suggestion stack. Sonnet 4.6 + extended thinking for
// generation; Haiku 4.5 (no thinking) for cheap adjudication and blurbs.
export const MODEL_SONNET_46 = 'claude-sonnet-4-6'
export const MODEL_HAIKU_45 = 'claude-haiku-4-5-20251001'
export const OPENROUTER_DEFAULT_MODEL = 'anthropic/claude-sonnet-4.6'
export const DEFAULT_THINKING_BUDGET = 16_000

interface LLMConfig {
  provider: LLMProvider
  apiKey: string
  model?: string
}

let config: LLMConfig | null = null

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

interface LLMChatResponse {
  text: string
}

export interface ClaudeSystemBlock {
  type: 'text'
  text: string
  cache_control?: { type: 'ephemeral' }
}

export interface ClaudeCallOptions {
  model?: string
  maxTokens?: number
  thinkingBudget?: number
  // When provided, takes precedence over the system message inside `messages`.
  // Pass an array of blocks to attach `cache_control` to the static prefix.
  systemBlocks?: ClaudeSystemBlock[]
}

async function callLLM(messages: ChatMessage[], maxTokens = 2048): Promise<string> {
  if (!config) throw new Error('LLM not configured')

  return callConfiguredProvider(messages, { maxTokens })
}

function mergeSystemPrompt(messages: ChatMessage[], systemBlocks?: ClaudeSystemBlock[]): ChatMessage[] {
  if (!systemBlocks?.length) return messages

  const injected = systemBlocks
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join('\n\n')

  if (!injected) return messages

  const existingSystem = messages.find((message) => message.role === 'system')?.content.trim()
  const mergedSystem = existingSystem ? `${injected}\n\n${existingSystem}` : injected
  const withoutSystem = messages.filter((message) => message.role !== 'system')
  return [{ role: 'system', content: mergedSystem }, ...withoutSystem]
}

async function callConfiguredProvider(
  messages: ChatMessage[],
  opts: ClaudeCallOptions = {},
): Promise<string> {
  if (!config) throw new Error('LLM not configured')

  switch (config.provider) {
    case 'claude':
      return callClaude(messages, opts)
    case 'openai':
      return callOpenAI(mergeSystemPrompt(messages, opts.systemBlocks), opts.maxTokens ?? 2048)
    case 'gemini':
      return callGemini(mergeSystemPrompt(messages, opts.systemBlocks), opts.maxTokens ?? 2048)
    case 'openrouter':
      return callOpenRouter(mergeSystemPrompt(messages, opts.systemBlocks), opts.maxTokens ?? 2048)
    default:
      throw new Error(`Unknown provider: ${config.provider}`)
  }
}

async function callClaude(messages: ChatMessage[], opts: ClaudeCallOptions = {}): Promise<string> {
  const data = await apiPost<LLMChatResponse>('/api/llm/chat', {
    provider: 'claude',
    apiKey: config!.apiKey,
    model: opts.model || config!.model || MODEL_SONNET_46,
    messages,
    maxTokens: opts.maxTokens ?? 2048,
    thinkingBudget: opts.thinkingBudget,
    systemBlocks: opts.systemBlocks,
  })
  return data.text
}

/**
 * Direct provider call with first-class options. Claude keeps prompt caching
 * and thinking support; other configured providers receive the same prompt
 * without Claude-specific features.
 */
export async function callClaudeDirect(
  messages: ChatMessage[],
  opts: ClaudeCallOptions = {},
): Promise<string> {
  return callConfiguredProvider(messages, opts)
}

async function callOpenAI(messages: ChatMessage[], maxTokens: number): Promise<string> {
  const data = await apiPost<LLMChatResponse>('/api/llm/chat', {
    provider: 'openai',
    apiKey: config!.apiKey,
    model: config!.model || 'gpt-4o',
    messages,
    maxTokens,
  })
  return data.text
}

export interface OpenRouterModel {
  id: string
  name: string
  contextLength?: number
  promptPrice?: number
  completionPrice?: number
}

interface OpenRouterModelsResponse {
  data?: Array<{
    context_length?: number
    id: string
    name?: string
    pricing?: {
      completion?: string
      prompt?: string
    }
  }>
}

interface GeneratedTrackTags {
  bpmEstimate?: number
  culturalContext?: string
  energy?: number
  genres?: unknown
  mood?: string
  vibeDescriptors?: unknown
}

let openRouterModelsCache: OpenRouterModel[] | null = null
let openRouterModelsPromise: Promise<OpenRouterModel[]> | null = null

/**
 * Fetches the OpenRouter model catalog. The endpoint is public (no auth
 * required) and returns a few hundred models. Results are cached for the
 * lifetime of the page so repeat visits to Settings don't re-fetch.
 */
export async function listOpenRouterModels(): Promise<OpenRouterModel[]> {
  if (openRouterModelsCache) return openRouterModelsCache
  if (openRouterModelsPromise) return openRouterModelsPromise

  openRouterModelsPromise = (async () => {
    const res = await fetch('https://openrouter.ai/api/v1/models')
    if (!res.ok) {
      openRouterModelsPromise = null
      throw new Error(`OpenRouter models fetch failed: ${res.status}`)
    }
    const data = await res.json() as OpenRouterModelsResponse
    const models: OpenRouterModel[] = (data.data ?? []).map((m) => ({
      id: m.id,
      name: m.name ?? m.id,
      contextLength: m.context_length,
      promptPrice: typeof m.pricing?.prompt === 'string' ? parseFloat(m.pricing.prompt) : undefined,
      completionPrice: typeof m.pricing?.completion === 'string' ? parseFloat(m.pricing.completion) : undefined,
    }))
    // Sort by provider prefix then name so grouped dropdowns render predictably.
    models.sort((a, b) => a.id.localeCompare(b.id))
    openRouterModelsCache = models
    return models
  })()

  return openRouterModelsPromise
}

// Models that support OpenRouter's `reasoning` parameter. Everything else in
// the list (Claude 3.5, Gemini 2.0, etc.) either ignores it or errors — we
// only opt in for families that we know thinking is live on.
function supportsReasoning(modelId: string): boolean {
  const id = modelId.toLowerCase()
  return (
    id.includes('claude-sonnet-4') ||
    id.includes('claude-opus-4') ||
    id.includes('claude-haiku-4') ||
    id.startsWith('openai/o1') ||
    id.startsWith('openai/o3') ||
    id.startsWith('openai/o4') ||
    id.includes('deepseek-r1') ||
    id.includes('gpt-5') ||
    id.includes('gemini-2.5')
  )
}

async function callOpenRouter(
  messages: ChatMessage[],
  maxTokens: number,
): Promise<string> {
  // OpenRouter is OpenAI-compatible. The HTTP-Referer and X-Title headers are
  // optional attribution metadata shown on OpenRouter's leaderboard.
  const model = config!.model || OPENROUTER_DEFAULT_MODEL

  const first = await callOpenRouterOnce(messages, maxTokens, model, true)
  if (first.ok) return first.text

  if (isOpenRouterEndpointGuardrailError(first.error)) {
    const retry = await callOpenRouterOnce(messages, maxTokens, model, false)
    if (retry.ok) return retry.text
    throw new Error(formatOpenRouterError(retry.status, retry.error))
  }

  throw new Error(formatOpenRouterError(first.status, first.error))
}

type OpenRouterCallResult =
  | { ok: true; text: string }
  | { ok: false; status: number; error: string }

async function callOpenRouterOnce(
  messages: ChatMessage[],
  maxTokens: number,
  model: string,
  useRouteEnhancements: boolean,
): Promise<OpenRouterCallResult> {
  try {
    const data = await apiPost<LLMChatResponse>('/api/llm/chat', {
      provider: 'openrouter',
      apiKey: config!.apiKey,
      model,
      messages,
      maxTokens,
      useRouteEnhancements: useRouteEnhancements && supportsReasoning(model),
    })
    return { ok: true, text: data.text }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown OpenRouter error'
    return { ok: false, status: extractProviderStatus(message) ?? 0, error: message }
  }
}

function isOpenRouterEndpointGuardrailError(error: string): boolean {
  return /no endpoints? found matching/i.test(error)
}

function extractProviderStatus(message: string): number | null {
  const status = message.match(/\b(?:Claude|OpenAI|Gemini|OpenRouter) API error: (\d{3})/)?.[1]
  return status ? Number(status) : null
}

function formatOpenRouterError(statusCode: number, error: string): string {
  let message = error.trim()
  try {
    const parsed = JSON.parse(error) as { error?: { message?: string } }
    message = parsed.error?.message || message
  } catch {
    // Keep raw body when OpenRouter returns plain text.
  }

  if (isOpenRouterEndpointGuardrailError(message)) {
    return `OpenRouter could not route the selected model under the current account/provider policy. In Settings, choose another OpenRouter model or update OpenRouter privacy/data settings. (${message})`
  }
  if (/^OpenRouter API error:/i.test(message)) {
    return message
  }

  return `OpenRouter API error: ${statusCode} ${message}`
}

async function callGemini(
  messages: ChatMessage[],
  maxTokens: number,
): Promise<string> {
  const data = await apiPost<LLMChatResponse>('/api/llm/chat', {
    provider: 'gemini',
    apiKey: config!.apiKey,
    model: config!.model || 'gemini-2.0-flash',
    messages,
    maxTokens,
  })
  return data.text
}

// ── Track Tagging ──

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
        parsed.forEach((tags: GeneratedTrackTags, idx: number) => {
          if (batch[idx]) {
            results.set(batch[idx].id, {
              energy: typeof tags.energy === 'number' ? tags.energy : 0.5,
              mood: tags.mood || 'neutral',
              genres: Array.isArray(tags.genres) ? tags.genres : [],
              bpmEstimate: tags.bpmEstimate,
              vibeDescriptors: Array.isArray(tags.vibeDescriptors) ? tags.vibeDescriptors : [],
              culturalContext: tags.culturalContext,
              taggedAt: Date.now(),
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

export async function buildTasteProfile(tracks: Track[]): Promise<TasteProfile> {
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

function parseRecommendationResponse(response: string): Recommendation[] {
  const parsed = JSON.parse(response.replace(/```json?\n?|\n?```/g, ''))
  if (!Array.isArray(parsed)) {
    throw new Error('Recommendation response was not an array')
  }
  const recommendations = parsed.filter((item): item is Recommendation => (
    item &&
    typeof item.artist === 'string' &&
    typeof item.title === 'string' &&
    typeof item.reason === 'string'
  ))
  if (parsed.length > 0 && recommendations.length === 0) {
    throw new Error('Recommendation response did not include usable artist/title pairs')
  }
  return recommendations
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
    return parseRecommendationResponse(response)
  } catch (err) {
    console.error('Failed to parse recommendations', err)
    throw new Error('The AI provider returned recommendations in an unreadable format. Try again, or choose a different model if it keeps happening.')
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

// ── Suggestion-stack helpers ──
//
// These power the suggestion stack. Claude gets prompt caching + extended
// thinking; other configured providers reuse the same prompts without those
// Anthropic-only features.

export interface SuggestionContext {
  // The static, large, cache-friendly prefix (taste profile + tagged library).
  prefix: string
  // The seed-specific tail.
  tail: string
}

/**
 * Recommendation call using a SuggestionContext. On Claude, the prefix is sent
 * as a cache-controlled system block so the same prefix is free on the 2nd+
 * call within Anthropic's ~5min cache TTL.
 */
export async function getRecommendationsCached(
  context: SuggestionContext,
  instruction: string,
  options: { count?: number; thinkingBudget?: number; model?: string } = {},
): Promise<Recommendation[]> {
  const count = options.count ?? 10
  const systemPrompt = `You are an expert music curator and DJ. You deeply understand musical flow, energy, mood, genre, and cultural context.

Always respond with a valid JSON array of objects: [{"artist": "...", "title": "...", "reason": "..."}]. No markdown, no explanation outside the JSON.`

  const response = await callClaudeDirect(
    [
      { role: 'user', content: `${instruction}\n\nReturn exactly ${count} tracks.\n\n${context.tail}` },
    ],
    {
      model: options.model ?? MODEL_SONNET_46,
      maxTokens: 4096,
      thinkingBudget: options.thinkingBudget ?? DEFAULT_THINKING_BUDGET,
      systemBlocks: [
        { type: 'text', text: systemPrompt },
        { type: 'text', text: context.prefix, cache_control: { type: 'ephemeral' } },
      ],
    },
  )

  try {
    return parseRecommendationResponse(response)
  } catch (err) {
    console.error('Failed to parse cached recommendations', err)
    throw new Error('The AI provider returned recommendations in an unreadable format. Try again, or choose a different model if it keeps happening.')
  }
}

export interface AdjudicatorCandidate {
  id: string
  title: string
  artist: string
  album?: string
}

/**
 * Cheap Haiku call: pick the best candidate (by index) for a wanted artist+title,
 * or null if nothing matches. No thinking, no tools.
 */
export async function adjudicateMatch(
  wanted: { artist: string; title: string },
  candidates: AdjudicatorCandidate[],
): Promise<number | null> {
  if (!candidates.length) return null
  const payload = {
    wanted,
    candidates: candidates.map((c, idx) => ({
      index: idx,
      title: c.title,
      artist: c.artist,
      album: c.album,
    })),
  }
  const response = await callClaudeDirect(
    [
      {
        role: 'user',
        content: `Pick the candidate that is the best match for the wanted track. Reject if it's a clearly different track (a cover, live version, karaoke, or different artist). Respond with strict JSON only: {"pickIndex": <number>} or {"pickIndex": null}.\n\n${JSON.stringify(payload)}`,
      },
    ],
    { model: MODEL_HAIKU_45, maxTokens: 64 },
  )
  try {
    const parsed = JSON.parse(response.replace(/```json?\n?|\n?```/g, ''))
    return typeof parsed.pickIndex === 'number' ? parsed.pickIndex : null
  } catch {
    return null
  }
}

/**
 * 1-2 sentence blurb for a mix tile. Haiku, no thinking.
 */
export async function buildBlurb(
  kind: string,
  payload: Record<string, unknown>,
): Promise<string> {
  const response = await callClaudeDirect(
    [
      {
        role: 'user',
        content: `Write a 1-2 sentence blurb for a "${kind}" music mix. Voice: warm, knowledgeable, conversational. No headers, no quotes, no markdown — just the sentences. Context:\n${JSON.stringify(payload)}`,
      },
    ],
    { model: MODEL_HAIKU_45, maxTokens: 200 },
  )
  return response.trim()
}
