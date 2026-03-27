import type { BeatGrid } from './audioAnalysis'
import { lowPassFilter } from './audioAnalysis'

const FRAME_SIZE = 2048
const HOP_SIZE = 512

/**
 * Detect beat grid and downbeats from audio data.
 * Uses spectral flux onset detection, phase-aligned grid snapping,
 * and low-frequency energy analysis for downbeat identification.
 */
export function detectBeatGrid(
  channelData: Float32Array,
  sampleRate: number,
  bpm: number,
  duration: number
): BeatGrid {
  const onsetEnvelope = computeOnsetEnvelope(channelData, sampleRate)
  const beats = constructBeatGrid(onsetEnvelope, sampleRate, bpm, duration)
  const { downbeats, beatsPerBar } = detectDownbeats(channelData, sampleRate, beats)

  return {
    beats,
    downbeats,
    beatsPerBar,
    firstBeatOffset: beats.length > 0 ? beats[0] : 0,
  }
}

// ── Stage A: Onset Detection via Spectral Flux ──

function computeOnsetEnvelope(
  channelData: Float32Array,
  _sampleRate: number
): Float32Array {
  const numFrames = Math.floor((channelData.length - FRAME_SIZE) / HOP_SIZE) + 1
  if (numFrames <= 1) return new Float32Array(0)

  const envelope = new Float32Array(numFrames)
  const halfSpectrum = FRAME_SIZE / 2 + 1

  let prevMagnitudes = new Float32Array(halfSpectrum)
  const frame = new Float32Array(FRAME_SIZE)
  const hanningWindow = createHanningWindow(FRAME_SIZE)

  for (let f = 0; f < numFrames; f++) {
    const offset = f * HOP_SIZE

    // Apply Hanning window
    for (let i = 0; i < FRAME_SIZE; i++) {
      frame[i] = (offset + i < channelData.length)
        ? channelData[offset + i] * hanningWindow[i]
        : 0
    }

    // Compute magnitude spectrum via FFT
    const magnitudes = computeMagnitudeSpectrum(frame)

    // Spectral flux: sum of positive magnitude differences
    let flux = 0
    for (let k = 0; k < halfSpectrum; k++) {
      const diff = magnitudes[k] - prevMagnitudes[k]
      if (diff > 0) flux += diff
    }

    envelope[f] = flux
    prevMagnitudes = new Float32Array(magnitudes)
  }

  // Normalize to 0-1
  let max = 0
  for (let i = 0; i < envelope.length; i++) {
    if (envelope[i] > max) max = envelope[i]
  }
  if (max > 0) {
    for (let i = 0; i < envelope.length; i++) {
      envelope[i] /= max
    }
  }

  return envelope
}

// ── Stage B: Beat Grid Construction ──

function constructBeatGrid(
  onsetEnvelope: Float32Array,
  sampleRate: number,
  bpm: number,
  duration: number
): number[] {
  if (onsetEnvelope.length === 0) return []

  const beatPeriodFrames = (60 / bpm) * (sampleRate / HOP_SIZE)
  const tolerance = 3 // frames of tolerance for onset alignment

  // Search for optimal phase offset
  const searchRange = Math.ceil(beatPeriodFrames)
  let bestOffset = 0
  let bestScore = -Infinity

  for (let offset = 0; offset < searchRange; offset++) {
    let score = 0
    let numBeats = 0

    for (let pos = offset; pos < onsetEnvelope.length; pos += beatPeriodFrames) {
      const frameIdx = Math.round(pos)
      // Sum onset envelope values in a tolerance window
      let localMax = 0
      for (let t = -tolerance; t <= tolerance; t++) {
        const idx = frameIdx + t
        if (idx >= 0 && idx < onsetEnvelope.length) {
          if (onsetEnvelope[idx] > localMax) localMax = onsetEnvelope[idx]
        }
      }
      score += localMax
      numBeats++
    }

    // Normalize by number of beats to avoid bias toward earlier offsets
    if (numBeats > 0) score /= numBeats

    if (score > bestScore) {
      bestScore = score
      bestOffset = offset
    }
  }

  // Generate beat timestamps
  const beats: number[] = []
  for (let pos = bestOffset; pos < onsetEnvelope.length; pos += beatPeriodFrames) {
    const timeSec = Math.round(pos) * HOP_SIZE / sampleRate
    if (timeSec >= 0 && timeSec <= duration) {
      beats.push(Math.round(timeSec * 1000) / 1000) // round to millisecond
    }
  }

  return beats
}

// ── Stage C: Downbeat Detection ──

function detectDownbeats(
  channelData: Float32Array,
  sampleRate: number,
  beats: number[]
): { downbeats: number[]; beatsPerBar: number } {
  if (beats.length < 4) {
    // Not enough beats to detect meter — default to 4/4
    return {
      downbeats: beats.filter((_, i) => i % 4 === 0),
      beatsPerBar: 4,
    }
  }

  // Low-pass filter to isolate kick drum frequencies (~250Hz)
  const filtered = lowPassFilter(channelData, sampleRate, 250)

  // Compute RMS bass energy at each beat position
  const windowSamples = Math.floor(sampleRate * 0.05) // 50ms window
  const beatEnergies: number[] = []

  for (const beatTime of beats) {
    const centerSample = Math.floor(beatTime * sampleRate)
    const start = Math.max(0, centerSample - Math.floor(windowSamples / 2))
    const end = Math.min(filtered.length, start + windowSamples)

    let sum = 0
    for (let i = start; i < end; i++) {
      sum += filtered[i] * filtered[i]
    }
    beatEnergies.push(Math.sqrt(sum / Math.max(1, end - start)))
  }

  // Test periodicity at candidate meters (3, 4, 6)
  const candidates = [3, 4, 6]
  let bestPeriod = 4
  let bestContrast = -Infinity

  for (const period of candidates) {
    if (beats.length < period * 2) continue

    // For each possible phase within the period, compute average energy
    const phaseEnergies: number[] = []
    for (let phase = 0; phase < period; phase++) {
      let sum = 0
      let count = 0
      for (let i = phase; i < beatEnergies.length; i += period) {
        sum += beatEnergies[i]
        count++
      }
      phaseEnergies.push(count > 0 ? sum / count : 0)
    }

    // Contrast: ratio of max phase energy to mean of other phases
    const maxPhaseEnergy = Math.max(...phaseEnergies)
    const otherSum = phaseEnergies.reduce((a, b) => a + b, 0) - maxPhaseEnergy
    const otherMean = otherSum / Math.max(1, period - 1)
    const contrast = otherMean > 0 ? maxPhaseEnergy / otherMean : 0

    if (contrast > bestContrast) {
      bestContrast = contrast
      bestPeriod = period
    }
  }

  // If contrast is too weak, default to 4/4
  if (bestContrast < 1.1) {
    bestPeriod = 4
  }

  // Find the phase with highest bass energy (= downbeat phase)
  let downbeatPhase = 0
  let maxPhaseEnergy = 0
  for (let phase = 0; phase < bestPeriod; phase++) {
    let sum = 0
    let count = 0
    for (let i = phase; i < beatEnergies.length; i += bestPeriod) {
      sum += beatEnergies[i]
      count++
    }
    const avg = count > 0 ? sum / count : 0
    if (avg > maxPhaseEnergy) {
      maxPhaseEnergy = avg
      downbeatPhase = phase
    }
  }

  // Extract downbeat timestamps
  const downbeats: number[] = []
  for (let i = downbeatPhase; i < beats.length; i += bestPeriod) {
    downbeats.push(beats[i])
  }

  return { downbeats, beatsPerBar: bestPeriod }
}

// ── FFT Implementation (Radix-2 Cooley-Tukey) ──

function createHanningWindow(size: number): Float32Array {
  const window = new Float32Array(size)
  for (let i = 0; i < size; i++) {
    window[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (size - 1)))
  }
  return window
}

function computeMagnitudeSpectrum(frame: Float32Array): Float32Array {
  const n = frame.length
  const real = new Float32Array(n)
  const imag = new Float32Array(n)
  real.set(frame)

  fft(real, imag)

  const halfN = n / 2 + 1
  const magnitudes = new Float32Array(halfN)
  for (let k = 0; k < halfN; k++) {
    magnitudes[k] = Math.sqrt(real[k] * real[k] + imag[k] * imag[k])
  }
  return magnitudes
}

/**
 * In-place radix-2 Cooley-Tukey FFT
 */
function fft(real: Float32Array, imag: Float32Array): void {
  const n = real.length
  if (n <= 1) return

  // Bit-reversal permutation
  let j = 0
  for (let i = 0; i < n - 1; i++) {
    if (i < j) {
      let tmp = real[i]; real[i] = real[j]; real[j] = tmp
      tmp = imag[i]; imag[i] = imag[j]; imag[j] = tmp
    }
    let m = n >> 1
    while (m >= 1 && j >= m) {
      j -= m
      m >>= 1
    }
    j += m
  }

  // Butterfly operations
  for (let size = 2; size <= n; size *= 2) {
    const halfSize = size / 2
    const angleStep = -2 * Math.PI / size

    for (let i = 0; i < n; i += size) {
      for (let k = 0; k < halfSize; k++) {
        const angle = angleStep * k
        const twiddleReal = Math.cos(angle)
        const twiddleImag = Math.sin(angle)

        const evenIdx = i + k
        const oddIdx = i + k + halfSize

        const tReal = twiddleReal * real[oddIdx] - twiddleImag * imag[oddIdx]
        const tImag = twiddleReal * imag[oddIdx] + twiddleImag * real[oddIdx]

        real[oddIdx] = real[evenIdx] - tReal
        imag[oddIdx] = imag[evenIdx] - tImag
        real[evenIdx] += tReal
        imag[evenIdx] += tImag
      }
    }
  }
}
