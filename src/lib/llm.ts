import type { Track } from '../types'

export type LLMProvider = 'claude' | 'openai' | 'gemini'

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

async function callLLM(messages: ChatMessage[], maxTokens = 2048): Promise<string> {
  if (!config) throw new Error('LLM not configured')

  switch (config.provider) {
    case 'claude':
      return callClaude(messages, maxTokens)
    case 'openai':
      return callOpenAI(messages, maxTokens)
    case 'gemini':
      return callGemini(messages, maxTokens)
    default:
      throw new Error(`Unknown provider: ${config.provider}`)
  }
}

async function callClaude(messages: ChatMessage[], maxTokens: number): Promise<string> {
  const systemMsg = messages.find(m => m.role === 'system')?.content || ''
  const userMessages = messages.filter(m => m.role !== 'system').map(m => ({
    role: m.role,
    content: m.content,
  }))

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config!.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: config!.model || 'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      system: systemMsg,
      messages: userMessages,
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Claude API error: ${res.status} ${err}`)
  }

  const data = await res.json()
  return data.content[0].text
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
