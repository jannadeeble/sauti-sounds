import type { Track } from '../types'
import type { AudioAnalysis, BeatGrid } from './audioAnalysis'
import { parseCamelot, compatibilityScore, type CamelotKey } from './camelot'
import { isLLMConfigured } from './llm'

export interface DJTrack {
  track: Track
  analysis: AudioAnalysis
  camelotKey: CamelotKey
}

export interface Transition {
  from: DJTrack
  to: DJTrack
  mixOutTime: number    // seconds — start fading out the outgoing track
  mixInTime: number     // seconds — start fading in the incoming track
  transitionBars: number
  bpmAdjustment: number // percentage to adjust incoming BPM
  technique: TransitionTechnique
}

export type TransitionTechnique = 'bass-swap' | 'filter-sweep' | 'echo-out' | 'cut'

export interface DJSet {
  tracks: DJTrack[]
  transitions: Transition[]
  totalDuration: number
  energyArc: number[]
  description?: string // LLM-generated description
}

// ── Compatibility Graph ──

interface CompatibilityEdge {
  from: number
  to: number
  score: number // 0-10
}

/**
 * Build a compatibility graph between all tracks
 * Score based on: key compatibility, BPM proximity, energy flow, artist diversity
 */
function buildCompatibilityGraph(djTracks: DJTrack[]): CompatibilityEdge[] {
  const edges: CompatibilityEdge[] = []

  for (let i = 0; i < djTracks.length; i++) {
    for (let j = 0; j < djTracks.length; j++) {
      if (i === j) continue

      const a = djTracks[i]
      const b = djTracks[j]
      let score = 0

      // Key compatibility (0-3)
      const keyScore = compatibilityScore(a.camelotKey, b.camelotKey)
      score += keyScore

      // BPM proximity (0-3)
      const bpmDiff = Math.abs(a.analysis.bpm - b.analysis.bpm) / a.analysis.bpm
      if (bpmDiff < 0.02) score += 3       // Within 2%
      else if (bpmDiff < 0.05) score += 2   // Within 5%
      else if (bpmDiff < 0.10) score += 1   // Within 10%

      // Energy flow (0-2) — gentle shifts are better
      const energyDiff = Math.abs(a.analysis.energy - b.analysis.energy)
      if (energyDiff < 0.15) score += 2      // Very similar energy
      else if (energyDiff < 0.3) score += 1   // Moderate shift

      // Artist diversity bonus (0-2)
      if (a.track.artist !== b.track.artist) score += 2

      edges.push({ from: i, to: j, score })
    }
  }

  return edges
}

// ── Set Builder ──

/**
 * Build an optimal track ordering using a greedy path algorithm
 * Walks the Camelot wheel while managing BPM and energy
 */
function greedyOrder(djTracks: DJTrack[], edges: CompatibilityEdge[]): number[] {
  if (djTracks.length <= 1) return djTracks.map((_, i) => i)

  // Build adjacency map
  const adj = new Map<number, CompatibilityEdge[]>()
  for (const edge of edges) {
    if (!adj.has(edge.from)) adj.set(edge.from, [])
    adj.get(edge.from)!.push(edge)
  }

  // Start with the track that has the lowest energy (opener)
  const visited = new Set<number>()
  let current = 0
  let lowestEnergy = Infinity
  for (let i = 0; i < djTracks.length; i++) {
    if (djTracks[i].analysis.energy < lowestEnergy) {
      lowestEnergy = djTracks[i].analysis.energy
      current = i
    }
  }

  const order: number[] = [current]
  visited.add(current)

  // Greedy: always pick the best-scored unvisited neighbor
  while (order.length < djTracks.length) {
    const neighbors = (adj.get(current) || [])
      .filter(e => !visited.has(e.to))
      .sort((a, b) => b.score - a.score)

    if (neighbors.length === 0) {
      // No compatible neighbors, just pick the closest unvisited by energy
      let best = -1
      let bestDiff = Infinity
      for (let i = 0; i < djTracks.length; i++) {
        if (!visited.has(i)) {
          const diff = Math.abs(djTracks[i].analysis.energy - djTracks[current].analysis.energy)
          if (diff < bestDiff) {
            bestDiff = diff
            best = i
          }
        }
      }
      if (best === -1) break
      current = best
    } else {
      current = neighbors[0].to
    }

    order.push(current)
    visited.add(current)
  }

  return order
}

/**
 * Snap a time to the nearest downbeat in the beat grid
 */
function snapToNearestDownbeat(time: number, beatGrid: BeatGrid): number {
  let closest = time
  let minDist = Infinity
  for (const db of beatGrid.downbeats) {
    const dist = Math.abs(db - time)
    if (dist < minDist) {
      minDist = dist
      closest = db
    }
  }
  return closest
}

/**
 * Compute transition duration in seconds, using real beats-per-bar when available
 */
function transitionDurationSeconds(transition: Transition): number {
  const beatsPerBar = transition.from.analysis.beatGrid?.beatsPerBar ?? 4
  return transition.transitionBars * beatsPerBar * 60 / transition.from.analysis.bpm
}

/**
 * Compute the optimal transition between two tracks
 */
function computeTransition(from: DJTrack, to: DJTrack): Transition {
  const fromSections = from.analysis.sections
  const toSections = to.analysis.sections

  // Find mix-out point: prefer outro, breakdown, or low-vocal section near the end
  let mixOutTime = from.track.duration * 0.85 // default: 85% into track
  const outroSection = fromSections.find(s =>
    s.type === 'outro' || (s.type === 'breakdown' && s.startTime > from.track.duration * 0.6)
  )
  if (outroSection) {
    mixOutTime = outroSection.startTime
  }

  // Find mix-in point: prefer intro or pre-chorus section
  let mixInTime = 0
  const introSection = toSections.find(s => s.type === 'intro')
  if (introSection) {
    mixInTime = introSection.startTime
  }

  // Snap mix points to nearest downbeat when beat grid is available
  if (from.analysis.beatGrid) {
    mixOutTime = snapToNearestDownbeat(mixOutTime, from.analysis.beatGrid)
  }
  if (to.analysis.beatGrid) {
    mixInTime = snapToNearestDownbeat(mixInTime, to.analysis.beatGrid)
  }

  // BPM adjustment
  const bpmRatio = from.analysis.bpm / to.analysis.bpm
  const bpmAdjustment = (bpmRatio - 1) * 100 // percentage

  // Transition length in bars
  const beatsPerBar = from.analysis.beatGrid?.beatsPerBar ?? 4
  const beatsPerSecond = from.analysis.bpm / 60
  const transitionSeconds = Math.min(16, (from.track.duration - mixOutTime)) // max 16 seconds
  const transitionBars = Math.round(transitionSeconds * beatsPerSecond / beatsPerBar)

  // Choose technique based on context
  let technique: TransitionTechnique = 'bass-swap'
  const keyCompat = compatibilityScore(from.camelotKey, to.camelotKey)
  if (keyCompat === 0) {
    technique = 'echo-out' // incompatible keys: quick echo transition
  } else if (Math.abs(bpmAdjustment) > 8) {
    technique = 'cut' // big BPM difference: hard cut
  } else if (from.analysis.energy > 0.7 && to.analysis.energy > 0.7) {
    technique = 'filter-sweep' // high energy: filter sweep
  }

  return {
    from,
    to,
    mixOutTime,
    mixInTime,
    transitionBars: Math.max(2, transitionBars),
    bpmAdjustment: Math.round(bpmAdjustment * 10) / 10,
    technique,
  }
}

// ── Public API ──

/**
 * Build a complete DJ set from a list of tracks with analysis data
 */
export function buildDJSet(
  tracks: Track[],
  analysisMap: Map<string, AudioAnalysis>
): DJSet | null {
  // Filter to tracks that have analysis data and valid Camelot keys
  const djTracks: DJTrack[] = []
  for (const track of tracks) {
    const analysis = analysisMap.get(track.id)
    if (!analysis) continue
    const camelotKey = parseCamelot(analysis.key)
    if (!camelotKey) continue
    djTracks.push({ track, analysis, camelotKey })
  }

  if (djTracks.length < 2) return null

  // Build compatibility graph
  const edges = buildCompatibilityGraph(djTracks)

  // Find optimal ordering
  const order = greedyOrder(djTracks, edges)
  const orderedTracks = order.map(i => djTracks[i])

  // Compute transitions
  const transitions: Transition[] = []
  for (let i = 0; i < orderedTracks.length - 1; i++) {
    transitions.push(computeTransition(orderedTracks[i], orderedTracks[i + 1]))
  }

  // Compute energy arc
  const energyArc = orderedTracks.map(t => t.analysis.energy)

  // Compute total duration (accounting for overlapping transitions)
  let totalDuration = 0
  for (let i = 0; i < orderedTracks.length; i++) {
    const trackDuration = orderedTracks[i].track.duration
    if (i < transitions.length) {
      // Subtract overlap
      const overlap = trackDuration - transitions[i].mixOutTime
      totalDuration += trackDuration - overlap
    } else {
      totalDuration += trackDuration
    }
  }

  return {
    tracks: orderedTracks,
    transitions,
    totalDuration,
    energyArc,
  }
}

/**
 * Get LLM-enhanced set description and creative reordering suggestions
 */
export async function enhanceSetWithLLM(set: DJSet): Promise<string> {
  if (!isLLMConfigured()) {
    return generateBasicDescription(set)
  }

  // Dynamic import to avoid circular deps
  const { default: callChat } = await import('./llm').then(m => ({
    default: m.chat
  }))

  const trackList = set.tracks.map((t, i) => {
    const trans = set.transitions[i]
    return `${i + 1}. "${t.track.title}" by ${t.track.artist} — ${t.analysis.bpm} BPM, Key: ${t.analysis.key}, Energy: ${(t.analysis.energy * 100).toFixed(0)}%${
      trans ? ` → [${trans.technique}, ${trans.transitionBars} bars]` : ''
    }`
  }).join('\n')

  const description = await callChat(
    `Describe this DJ set as a brief narrative (2-3 sentences). What's the energy journey? How does it flow?\n\n${trackList}`,
    {}
  )

  return description
}

function generateBasicDescription(set: DJSet): string {
  const startEnergy = set.energyArc[0]
  const peakEnergy = Math.max(...set.energyArc)
  const endEnergy = set.energyArc[set.energyArc.length - 1]
  const avgBPM = set.tracks.reduce((s, t) => s + t.analysis.bpm, 0) / set.tracks.length
  const minutes = Math.round(set.totalDuration / 60)

  let journey = 'steady'
  if (startEnergy < 0.4 && peakEnergy > 0.7) journey = 'building'
  if (endEnergy < startEnergy - 0.2) journey = 'winding down'
  if (startEnergy > 0.6 && endEnergy > 0.6) journey = 'high energy throughout'

  return `${minutes}-minute set, ${set.tracks.length} tracks, ~${Math.round(avgBPM)} BPM average. Energy: ${journey}.`
}

// ── Playback Engine ──

export interface DJPlaybackState {
  currentTrackIndex: number
  isTransitioning: boolean
  transitionProgress: number // 0-1
  outgoingVolume: number
  incomingVolume: number
  lowPassFreq: number // Hz for incoming track filter
}

/**
 * Create audio nodes for DJ transition effects
 */
export function createTransitionNodes(audioContext: AudioContext) {
  // Low-pass filter for incoming track
  const lowPass = audioContext.createBiquadFilter()
  lowPass.type = 'lowpass'
  lowPass.frequency.value = 200 // start with bass only
  lowPass.Q.value = 0.7

  // Gain nodes for crossfade
  const outgoingGain = audioContext.createGain()
  const incomingGain = audioContext.createGain()
  incomingGain.gain.value = 0

  return { lowPass, outgoingGain, incomingGain }
}

/**
 * Schedule a bass-swap transition
 * 1. Incoming fades in through low-pass filter
 * 2. At the swap point, bass switches from outgoing to incoming
 * 3. Outgoing fades out
 */
export function scheduleBassSwapTransition(
  _audioContext: AudioContext,
  outgoingGain: GainNode,
  incomingGain: GainNode,
  lowPass: BiquadFilterNode,
  transition: Transition,
  startTime: number
) {
  const duration = transitionDurationSeconds(transition)
  const halfTime = startTime + duration / 2

  // Phase 1: Incoming fades in with low-pass (first half)
  incomingGain.gain.setValueAtTime(0, startTime)
  incomingGain.gain.linearRampToValueAtTime(0.7, halfTime)
  lowPass.frequency.setValueAtTime(200, startTime)
  lowPass.frequency.exponentialRampToValueAtTime(800, halfTime)

  // Phase 2: Bass swap at midpoint
  lowPass.frequency.setValueAtTime(800, halfTime)
  lowPass.frequency.exponentialRampToValueAtTime(20000, halfTime + 0.5) // Open filter fully

  // Phase 3: Outgoing fades out (second half)
  outgoingGain.gain.setValueAtTime(1, halfTime)
  outgoingGain.gain.linearRampToValueAtTime(0, startTime + duration)
  incomingGain.gain.linearRampToValueAtTime(1, startTime + duration)
}

/**
 * Schedule a filter sweep transition
 */
export function scheduleFilterSweepTransition(
  _audioContext: AudioContext,
  outgoingGain: GainNode,
  incomingGain: GainNode,
  lowPass: BiquadFilterNode,
  transition: Transition,
  startTime: number
) {
  const duration = transitionDurationSeconds(transition)

  // Gradual crossfade with filter sweep on incoming
  incomingGain.gain.setValueAtTime(0, startTime)
  incomingGain.gain.linearRampToValueAtTime(1, startTime + duration)

  outgoingGain.gain.setValueAtTime(1, startTime)
  outgoingGain.gain.linearRampToValueAtTime(0, startTime + duration)

  lowPass.frequency.setValueAtTime(100, startTime)
  lowPass.frequency.exponentialRampToValueAtTime(20000, startTime + duration)
}
