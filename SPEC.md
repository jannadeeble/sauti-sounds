# Sauti Sounds — Product Specification

**Version:** 0.1 (Draft)
**Date:** 2026-03-26
**Domain:** sautisounds.app
**Authors:** Janna + Claude

---

## 1. Vision

Sauti Sounds is a music player that unifies local files and streaming into a single experience, powered by an LLM-based recommendation engine that actually understands musical flow, energy, mood, and cultural context — not just "people who liked X also liked Y."

It replaces the need for:
- A local music player (no ads, no subscriptions, no bloat)
- A streaming app (Deezer integration)
- A playlist generator (LLM-powered, context-aware)
- A smart DJ tool (harmonic mixing, BPM matching, energy flow)

---

## 2. Users

| User | Device | Needs |
|------|--------|-------|
| Janna | Android | Local files + Deezer streaming + DJ mode |
| Clara | iPhone | Deezer streaming only |

Both share one Deezer Premium account.

---

## 3. Platform & Architecture

### 3.1 PWA (React)
- **Framework:** React (likely Next.js or Vite + React)
- **Deployment:** PWA hosted at sautisounds.app
- **Why PWA:** Cross-platform from day one. Can be wrapped later (Capacitor/Ionic) for app store distribution
- **Local file access:** Uses File System Access API on Android Chrome. Not available on iOS Safari, but Clara doesn't need it

### 3.2 Streaming Backend

**Decision needed: Deezer vs Tidal**

| Criteria | Deezer | Tidal |
|----------|--------|-------|
| Official SDK | Dead (deprecated 2023) | Has streaming SDK but restrictive licensing |
| Web Widget | Works for Premium users in browser | No web widget |
| API (search/metadata) | Public REST API, no auth for search | Public API for metadata |
| Unofficial SDK | deezer-py (Python), works | tidalapi (Python), works well |
| Audio Quality | HiFi (FLAC) on Premium | HiFi / Master (MQA) |
| Price | ~$10.99/mo | ~$10.99/mo (HiFi) |
| PWA Compatibility | Widget embeds in iframe | Would need reverse-engineered playback |
| AI Music Stance | Unknown | Actively pro-artist, anti-AI-slop |

**Current leaning:** Deezer — the web widget approach works naturally in a PWA context. Janna loves the Deezer UI. The widget handles auth, playback, and DRM without us needing to solve any of that.

**Fallback:** If Deezer widget proves too limiting, pivot to Tidal via tidalapi.

### 3.3 Backend Services
- **LLM API:** Platform-agnostic (Claude, GPT, Gemini — pluggable)
- **Track metadata DB:** SQLite via IndexedDB (client-side) or lightweight server
- **Audio analysis:** Web Audio API for local files (BPM, key detection) + pre-computed tags from LLM

---

## 4. Core Features

### 4.1 Unified Music Library

**Local Files:**
- Import from device storage (File System Access API)
- Support: MP3, FLAC, WAV, AAC, OGG, M4A
- Auto-fetch album artwork (MusicBrainz, Discogs, Last.fm APIs)
- Read embedded ID3/metadata tags
- Waveform generation for DJ mode

**Streaming (Deezer):**
- Browse Deezer catalog via search
- Play via Deezer web widget (Premium required)
- Import existing Deezer playlists/favorites

**Unified View:**
- Single library view combining local + streaming tracks
- Badge system: vinyl icon (local) / Deezer icon (streaming)
- Same badges appear in playlists, queue, now-playing
- Search across both sources simultaneously

### 4.2 Playlists

**Mixed playlists:**
- Local and streaming tracks side by side
- Visual badges on each track
- Drag and drop reordering
- Standard controls: shuffle, repeat, queue

**Spotify Import:**
- Parse Spotify account data export (JSON)
- LLM-powered matching to Deezer catalog (smart matcher with fuzzy fallbacks)
- Import playlist structure, track order, playlist names
- Match report: matched / uncertain / missing tracks
- User review step for uncertain matches

**Playlist Data (Janna's Spotify):**
- 376 playlists
- 9,991 playlist track entries
- 1,306 saved/liked tracks
- 19 saved albums

### 4.3 Standard Player Features
- Play / Pause / Skip / Previous
- Seek bar with time display
- Volume control
- Queue management (up next, add to queue, reorder)
- Shuffle / Repeat (all, one, off)
- Now Playing screen with album art
- Mini player (collapsed view)
- Background playback (via PWA/service worker)
- Media session API integration (lock screen controls, notification controls)

---

## 5. LLM Recommendation Engine

### 5.1 Architecture
- **LLM-agnostic:** Pluggable API layer (Claude, GPT, Gemini, local models)
- **Taste Profile:** Built from Spotify import + listening history, stored locally
- **Track Tags:** Each track tagged with energy (0-1), mood, genre, BPM range, vibe descriptors, cultural context
- **Context Window:** Last N tracks played + current playlist context + taste profile

### 5.2 Recommendation Modes

**Song Radio:**
- Trigger: Track ends with no queue/playlist, or user selects "Song Radio"
- Input: The seed track only
- Output: Continuous stream of similar tracks
- Logic: Match energy level, genre, mood, cultural context of the seed track
- Draws from both local library and Deezer catalog

**Playlist Continuation:**
- Trigger: Playlist ends
- Input: The entire playlist as context
- Output: Additional tracks that continue the playlist's arc
- Logic: Understand the playlist's energy curve, genre flow, and mood trajectory — continue it, don't restart it

**"Build Me a Playlist Like This":**
- Trigger: Three-dot menu on any playlist
- Input: The playlist + user's full library
- Output: A new playlist with similar vibe but different tracks

**"Extend This Playlist":**
- Trigger: Three-dot menu
- Input: Existing playlist
- Output: Additional tracks appended
- Respects the existing energy arc

**"Add Songs to Beginning / Middle / End":**
- Trigger: Three-dot menu submenu
- Input: Playlist + position context
- Output: Tracks inserted at specified position
- Beginning: Tracks that lead into the playlist's opening
- Middle: Tracks that bridge the existing flow
- End: Tracks that wind down or extend the closing mood

**"Create a Playlist For...":**
- Trigger: New playlist dialog or chat interface
- Input: Natural language description ("2-hour sunset playlist", "morning coffee", "high-energy workout")
- Output: Complete playlist from library + Deezer catalog
- AI can ask clarifying questions ("What energy level? Any genres to avoid? Indoor or outdoor vibe?")

### 5.3 Taste Profile System

Built from Spotify data analysis. Janna's profile includes:
- **Core identity:** DJ with East African roots, warm rhythm-driven music bridging traditional and electronic
- **Primary genres:** Afro-house, electro-folklore, amapiano, organic house, afro-lofi, nu-jazz/funk
- **Energy preferences:** Generally mid-energy (0.3-0.8), favors builds over peaks
- **Cultural markers:** Swahili, Latin American, West African, South African influences
- **Anti-preferences:** Banned Beyonce. Not into mainstream pop.

Profile evolves over time with listening data.

### 5.4 Cost Management
- LLM calls are the main cost driver
- Batch tagging on import (not per-play)
- Cache recommendations (don't re-call for same context)
- Use smaller/cheaper models for simple tasks (tag lookup) vs larger models for creative tasks (playlist generation)
- Estimated cost: pennies per playlist generation, near-zero for cached song radio

---

## 6. DJ Mode

### 6.1 Overview
Not a gimmicky crossfade. A proper harmonic mixing engine that creates DJ-style transitions between tracks.

### 6.2 Audio Analysis (Per Track)
- **Key detection:** Camelot wheel system (e.g., 7A, 7B, 8A)
- **BPM detection:** Beats per minute via audio analysis
- **Section detection:** Identify intro, verse, chorus, breakdown, outro
- **Energy mapping:** Energy level over time within the track
- **Vocal detection:** Identify vocal vs instrumental sections

For local files: Web Audio API analysis on import.
For streaming: Use Deezer's audio features API where available + LLM inference from metadata.

### 6.3 Mixing Algorithm

**Track Selection Rules:**
1. Compatible key (same Camelot number, or +/- 1, or inner/outer wheel match)
2. Compatible BPM (within ~5% range, adjustable via pitch/time-stretch)
3. Energy flow (next track should maintain or gently shift the energy arc)
4. No immediate artist repeat
5. Genre coherence (LLM-assisted)

**Transition Formula:**
1. Identify **mix-out point** on outgoing track: a section that is melodic, preferably instrumental, ideally a breakdown or outro. Minimal vocals.
2. Identify **mix-in point** on incoming track: the intro or a pre-drop section before anything exciting happens. Pre-melody is ideal.
3. BPM match: Adjust incoming track's BPM to match outgoing track
4. Apply **low-pass filter** to incoming track (remove bass/low-end)
5. **Gradual fade-in** of incoming track (1-2 bars, configurable)
6. **Bass swap:** At the transition point, switch the low-end from outgoing to incoming track
7. **Release:** Fade out the outgoing track, let the incoming track play fully
8. Total transition: typically 4-16 bars depending on tracks

### 6.4 DJ Mode Flow

**Input:** A playlist (or "Song Radio" seed)

**Process:**
1. Analyze all tracks (key, BPM, sections, energy)
2. Build a **compatibility graph** (which tracks can mix into which)
3. **Programmatic ordering:** Sort by key progression (Camelot wheel walk), BPM gradient, energy arc
4. **LLM creative pass:** Send the ordered list to LLM for creative refinement — it can reorder for better storytelling, genre flow, emotional journey
5. Present the proposed set to the user: "Here's your 2-hour mix. Starting with [Track A] at 118 BPM, building through afro-house into amapiano, peaking at [Track X], winding down with [Track Z]."
6. User can approve, tweak, or regenerate

**Playback:**
- Seamless gapless playback with pre-computed transitions
- Visual: waveforms, current position, upcoming transition preview
- Optional: display Camelot key + BPM on each track

### 6.5 Future DJ Mode Enhancements (V2+)
- EQ mixing (not just low-pass, but 3-band EQ transitions)
- Loop sections for extended transitions
- Effects (reverb tail on outgoing track)
- User override: manually set mix points
- Record/export the mixed set as a single audio file
- Live mode: DJ controls for manual mixing with AI assistance

---

## 7. UI Design

### 7.1 Design Language
Emulate Deezer's UI aesthetic:
- Clean, modern, dark mode default
- Large album artwork
- Smooth animations and transitions
- Bottom navigation (mobile), sidebar navigation (desktop)
- Glassmorphism / translucent elements
- Accent color: TBD (consider warm orange/amber to match African/sunset vibes)

### 7.2 Key Screens

**Home:**
- Recently played
- LLM-generated suggestions ("Because you've been in an amapiano mood...")
- Quick access to playlists
- "Create a playlist for..." prompt bar

**Library:**
- All tracks (local + streaming, filterable)
- Albums, Artists, Playlists tabs
- Sort by: name, date added, energy, genre
- Badges on every track (local/streaming)

**Now Playing:**
- Full-screen album art
- Playback controls
- Queue view (swipe up)
- Lyrics (if available via Deezer)
- "Song Radio" button
- Track info (BPM, key, energy — useful for DJ context)

**Playlist View:**
- Track list with badges
- Three-dot menu: extend, add songs, build similar, DJ mode
- Playlist artwork (auto-generated collage or custom)

**DJ Mode:**
- Dual waveform display (outgoing + incoming)
- Transition preview
- Set overview (tracklist with flow visualization)
- BPM and key display per track
- Energy arc visualization across the set

**Search:**
- Unified search across local library + Deezer catalog
- Results grouped: Local Library / Deezer Catalog
- Quick actions: play, add to queue, add to playlist

**Settings:**
- Deezer account connection
- Local music folder selection
- LLM provider selection + API key
- Audio quality preferences
- DJ Mode defaults (transition length, key compatibility strictness)
- Import Spotify data

**AI Chat / Command Bar:**
- Accessible from anywhere (floating button or swipe gesture)
- Natural language: "Play something chill for working"
- AI can respond with clarifying questions
- Shows generated playlists inline

---

## 8. Spotify Import Pipeline

### 8.1 Data Available
From Janna's Spotify export:
- `YourLibrary.json` — 1,306 saved tracks, 19 albums, 4 followed artists
- `Playlist1.json` + `Playlist2.json` — 376 playlists, 9,991 track entries
- `StreamingHistory_music_0.json` — listening history with timestamps
- `Follow.json` — followed artists/users
- `SearchQueries.json` — search history
- `Wrapped2025.json` — yearly stats

### 8.2 Import Process
1. **Parse** all JSON files
2. **Build taste profile** from library + history + playlists (LLM-analyzed)
3. **Match tracks to Deezer** using smart matcher:
   - Exact search (artist + track)
   - Relaxed search (fuzzy matching)
   - Strip remix/feat info, search base track
   - Artist catalog browse
   - Album search fallback
4. **Generate match report:** matched / uncertain / not found
5. **User review:** approve uncertain matches, acknowledge missing tracks
6. **Create playlists** on Deezer / locally with matched tracks
7. **Tag all tracks** with energy, mood, genre, BPM (LLM batch job)

---

## 9. Album Artwork Auto-Fetch (Local Files)

For local files missing embedded artwork:
1. **Read ID3 tags** for artist + album + track name
2. **Search MusicBrainz** for release + cover art via Cover Art Archive
3. **Fallback: Discogs API** — search by artist + album
4. **Fallback: Last.fm API** — album.getInfo for images
5. **Fallback: iTunes Search API** — often has good artwork
6. **Cache** all fetched artwork locally
7. **User override:** manual artwork selection (pick from search results or upload)

---

## 10. Technical Stack (Proposed)

| Layer | Technology |
|-------|-----------|
| Frontend | React + TypeScript + Vite |
| UI Library | TBD (Tailwind CSS + Headless UI, or Chakra, or custom) |
| State Management | Zustand or Jotai |
| Audio (Local) | Web Audio API + Howler.js |
| Audio (Streaming) | Deezer Web Widget (iframe embed) |
| Audio Analysis | Essentia.js (WASM) for BPM/key detection |
| Database | IndexedDB via Dexie.js (client-side) |
| LLM Integration | Abstraction layer over Claude/GPT/Gemini APIs |
| PWA | Workbox for service worker + offline support |
| Album Art | MusicBrainz / Discogs / Last.fm / iTunes APIs |
| Deployment | Vercel or Cloudflare Pages |
| Native Wrap (future) | Capacitor (iOS + Android app store) |

---

## 11. Development Phases

### Phase 1: Foundation
- [ ] Project scaffolding (Vite + React + TypeScript + PWA)
- [ ] Basic audio player (local files via Web Audio API)
- [ ] File system access (browse + import local music)
- [ ] Library view with track listing
- [ ] Now Playing screen
- [ ] Basic playback controls (play, pause, skip, seek, volume)
- [ ] ID3 tag reading
- [ ] Album artwork auto-fetch

### Phase 2: Deezer Integration
- [ ] Deezer web widget integration
- [ ] Deezer search
- [ ] Unified library (local + streaming)
- [ ] Badge system (local vs streaming icons)
- [ ] Mixed playlists

### Phase 3: Smart Import
- [ ] Spotify data parser
- [ ] Smart track matcher (Deezer fuzzy matching)
- [ ] Match report + review UI
- [ ] Playlist import
- [ ] Batch track tagging via LLM

### Phase 4: LLM Recommendation Engine
- [ ] LLM API abstraction layer
- [ ] Taste profile builder
- [ ] Track tagging system (energy, mood, genre, BPM, vibe)
- [ ] Song Radio mode
- [ ] Playlist continuation
- [ ] "Build me a playlist like this"
- [ ] "Add songs to beginning/middle/end"
- [ ] "Create a playlist for..." with AI chat
- [ ] AI clarifying questions

### Phase 5: DJ Mode
- [ ] BPM detection (Essentia.js)
- [ ] Key detection (Camelot system)
- [ ] Section detection (intro/verse/chorus/outro)
- [ ] Mixing algorithm (harmonic + BPM matching)
- [ ] Transition engine (fade, bass swap, low-pass filter)
- [ ] Set builder (programmatic ordering + LLM creative pass)
- [ ] DJ Mode UI (dual waveforms, set overview, energy arc)

### Phase 6: Polish & Ship
- [ ] Deezer-inspired UI polish
- [ ] Dark mode
- [ ] Responsive design (mobile + desktop)
- [ ] Offline support (service worker for local files)
- [ ] Performance optimization
- [ ] Capacitor wrap for app stores (if needed)

---

## 12. Open Questions

1. **Deezer vs Tidal:** Widget approach (Deezer) vs API approach (Tidal). Test Deezer widget limitations early.
2. **Audio analysis for streaming tracks:** Can we get BPM/key from Deezer's API, or do we need to analyze audio ourselves? If streaming-only, we may need to rely on LLM inference + metadata databases.
3. **LLM cost model:** How many API calls per session? Need to estimate and set budgets.
4. **Deezer shared account:** Two users on one Premium account — verify this works with the widget approach (likely one active session at a time).
5. **PWA audio limitations on iOS:** Safari has restrictions on background audio in PWAs. Clara's experience may need a native wrapper earlier.
6. **Export DJ mix:** Legal implications of recording/exporting mixed sets from streaming tracks.

---

*Sauti Sounds — music is the remedy.*
