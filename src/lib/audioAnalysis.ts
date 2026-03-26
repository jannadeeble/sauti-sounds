import type { Track } from '../types'
import { keyToCamelot } from './camelot'

export interface AudioAnalysis {
  bpm: number
  key: string // Camelot notation (e.g., "8A")
  energy: number // 0-1 overall energy
  sections: Section[]
  energyMap: number[] // energy values at regular intervals
  waveformData: number[] // normalized amplitude data for visualization
}

export interface Section {
  type: 'intro' | 'verse' | 'chorus' | 'breakdown' | 'drop' | 'outro' | 'unknown'
  startTime: number
  endTime: number
  energy: number
  hasVocals: boolean
}

/**
 * Analyze an audio file using Web Audio API
 */
export async function analyzeTrack(track: Track): Promise<AudioAnalysis | null> {
  if (track.source !== 'local' || !track.fileHandle) return null

  try {
    const file = await track.fileHandle.getFile()
    const arrayBuffer = await file.arrayBuffer()
    const audioContext = new AudioContext()
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)

    const channelData = audioBuffer.getChannelData(0) // mono
    const sampleRate = audioBuffer.sampleRate
    const duration = audioBuffer.duration

    // Run analysis
    const bpm = detectBPM(channelData, sampleRate)
    const key = detectKey(channelData, sampleRate)
    const energyMap = computeEnergyMap(channelData, sampleRate, duration)
    const sections = detectSections(energyMap, duration)
    const waveformData = generateWaveform(channelData, 800)
    const overallEnergy = energyMap.reduce((a, b) => a + b, 0) / energyMap.length

    audioContext.close()

    return {
      bpm,
      key,
      energy: overallEnergy,
      sections,
      energyMap,
      waveformData,
    }
  } catch (err) {
    console.error('Audio analysis failed:', err)
    return null
  }
}

/**
 * BPM Detection using autocorrelation
 */
function detectBPM(channelData: Float32Array, sampleRate: number): number {
  // Downsample for performance
  const downsampleFactor = 4
  const samples = new Float32Array(Math.floor(channelData.length / downsampleFactor))
  for (let i = 0; i < samples.length; i++) {
    samples[i] = Math.abs(channelData[i * downsampleFactor])
  }
  const effectiveSR = sampleRate / downsampleFactor

  // Low-pass filter to isolate beats
  const filtered = lowPassFilter(samples, effectiveSR, 150)

  // Onset detection — find energy peaks
  const windowSize = Math.floor(effectiveSR * 0.01) // 10ms windows
  const energyValues: number[] = []
  for (let i = 0; i < filtered.length - windowSize; i += windowSize) {
    let sum = 0
    for (let j = 0; j < windowSize; j++) {
      sum += filtered[i + j] * filtered[i + j]
    }
    energyValues.push(sum / windowSize)
  }

  // Autocorrelation on energy values
  // BPM range: 60-200 → period in windows
  const minPeriod = Math.floor(60 / 200 / 0.01) // ~3 windows for 200 BPM
  const maxPeriod = Math.floor(60 / 60 / 0.01)   // ~100 windows for 60 BPM

  let bestCorrelation = 0
  let bestPeriod = 0

  for (let period = minPeriod; period <= Math.min(maxPeriod, energyValues.length / 2); period++) {
    let correlation = 0
    let count = 0
    for (let i = 0; i < energyValues.length - period; i++) {
      correlation += energyValues[i] * energyValues[i + period]
      count++
    }
    correlation /= count

    if (correlation > bestCorrelation) {
      bestCorrelation = correlation
      bestPeriod = period
    }
  }

  if (bestPeriod === 0) return 120 // fallback

  const bpm = 60 / (bestPeriod * 0.01)

  // Normalize to common range (60-180)
  let normalized = bpm
  while (normalized > 180) normalized /= 2
  while (normalized < 60) normalized *= 2

  return Math.round(normalized * 10) / 10
}

/**
 * Key Detection using chroma features
 */
function detectKey(channelData: Float32Array, sampleRate: number): string {
  const fftSize = 4096
  const chromaBins = new Float64Array(12) // C, C#, D, D#, E, F, F#, G, G#, A, A#, B

  // Analyze multiple windows
  const hopSize = fftSize * 2
  const numWindows = Math.min(100, Math.floor(channelData.length / hopSize))

  for (let w = 0; w < numWindows; w++) {
    const offset = w * hopSize
    if (offset + fftSize > channelData.length) break

    // Extract window
    const window = new Float32Array(fftSize)
    for (let i = 0; i < fftSize; i++) {
      // Apply Hanning window
      const hann = 0.5 * (1 - Math.cos(2 * Math.PI * i / fftSize))
      window[i] = channelData[offset + i] * hann
    }

    // Simple DFT for chroma extraction (just the pitch class bins)
    for (let pitch = 0; pitch < 12; pitch++) {
      // Check multiple octaves (2-6)
      for (let octave = 2; octave <= 6; octave++) {
        const freq = 440 * Math.pow(2, (pitch - 9 + (octave - 4) * 12) / 12)
        const k = Math.round(freq * fftSize / sampleRate)
        if (k >= fftSize / 2) continue

        // Goertzel-like single-bin DFT
        let real = 0, imag = 0
        const omega = 2 * Math.PI * k / fftSize
        for (let i = 0; i < fftSize; i++) {
          real += window[i] * Math.cos(omega * i)
          imag += window[i] * Math.sin(omega * i)
        }
        chromaBins[pitch] += Math.sqrt(real * real + imag * imag)
      }
    }
  }

  // Normalize chroma
  const maxChroma = Math.max(...chromaBins)
  if (maxChroma > 0) {
    for (let i = 0; i < 12; i++) chromaBins[i] /= maxChroma
  }

  // Match against major and minor key profiles (Krumhansl-Kessler)
  const majorProfile = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
  const minorProfile = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]

  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

  let bestScore = -Infinity
  let bestKey = 'C major'

  for (let shift = 0; shift < 12; shift++) {
    // Try major
    let majorScore = 0
    let minorScore = 0
    for (let i = 0; i < 12; i++) {
      const chromaIdx = (i + shift) % 12
      majorScore += chromaBins[chromaIdx] * majorProfile[i]
      minorScore += chromaBins[chromaIdx] * minorProfile[i]
    }

    if (majorScore > bestScore) {
      bestScore = majorScore
      bestKey = `${noteNames[shift]} major`
    }
    if (minorScore > bestScore) {
      bestScore = minorScore
      bestKey = `${noteNames[shift]} minor`
    }
  }

  return keyToCamelot(bestKey) || '8B' // fallback to C major
}

/**
 * Compute energy map — energy value at regular intervals
 */
function computeEnergyMap(
  channelData: Float32Array,
  _sampleRate: number,
  _duration: number,
  resolution = 100 // number of data points
): number[] {
  const samplesPerBin = Math.floor(channelData.length / resolution)
  const energyMap: number[] = []
  let maxEnergy = 0

  for (let i = 0; i < resolution; i++) {
    const offset = i * samplesPerBin
    let sum = 0
    for (let j = 0; j < samplesPerBin && offset + j < channelData.length; j++) {
      sum += channelData[offset + j] * channelData[offset + j]
    }
    const energy = Math.sqrt(sum / samplesPerBin)
    energyMap.push(energy)
    if (energy > maxEnergy) maxEnergy = energy
  }

  // Normalize to 0-1
  if (maxEnergy > 0) {
    for (let i = 0; i < energyMap.length; i++) {
      energyMap[i] /= maxEnergy
    }
  }

  return energyMap
}

/**
 * Detect sections based on energy changes
 */
function detectSections(energyMap: number[], duration: number): Section[] {
  const sections: Section[] = []
  const segmentDuration = duration / energyMap.length

  // Smooth energy for section detection
  const smoothed = smoothArray(energyMap, 5)

  // Find significant energy transitions
  const threshold = 0.15
  let currentType: Section['type'] = 'intro'
  let sectionStart = 0

  for (let i = 1; i < smoothed.length; i++) {
    const diff = smoothed[i] - smoothed[i - 1]
    let newType: Section['type'] | null = null

    const time = i * segmentDuration
    const progress = i / smoothed.length

    if (progress < 0.05) {
      newType = 'intro'
    } else if (progress > 0.92) {
      newType = 'outro'
    } else if (diff > threshold) {
      // Energy increase
      newType = smoothed[i] > 0.7 ? 'drop' : 'chorus'
    } else if (diff < -threshold) {
      // Energy decrease
      newType = smoothed[i] < 0.3 ? 'breakdown' : 'verse'
    }

    if (newType && newType !== currentType) {
      const sectionEnergy = smoothed.slice(
        Math.floor(sectionStart / segmentDuration),
        i
      ).reduce((a, b) => a + b, 0) / Math.max(1, i - Math.floor(sectionStart / segmentDuration))

      sections.push({
        type: currentType,
        startTime: sectionStart,
        endTime: time,
        energy: sectionEnergy,
        hasVocals: sectionEnergy > 0.3 && sectionEnergy < 0.8, // rough heuristic
      })

      currentType = newType
      sectionStart = time
    }
  }

  // Final section
  const remaining = smoothed.slice(Math.floor(sectionStart / segmentDuration))
  const finalEnergy = remaining.length > 0
    ? remaining.reduce((a, b) => a + b, 0) / remaining.length
    : 0

  sections.push({
    type: currentType,
    startTime: sectionStart,
    endTime: duration,
    energy: finalEnergy,
    hasVocals: finalEnergy > 0.3 && finalEnergy < 0.8,
  })

  return sections
}

/**
 * Generate waveform data for visualization
 */
function generateWaveform(channelData: Float32Array, numBars: number): number[] {
  const samplesPerBar = Math.floor(channelData.length / numBars)
  const waveform: number[] = []
  let max = 0

  for (let i = 0; i < numBars; i++) {
    const offset = i * samplesPerBar
    let peak = 0
    for (let j = 0; j < samplesPerBar && offset + j < channelData.length; j++) {
      const abs = Math.abs(channelData[offset + j])
      if (abs > peak) peak = abs
    }
    waveform.push(peak)
    if (peak > max) max = peak
  }

  // Normalize
  if (max > 0) {
    for (let i = 0; i < waveform.length; i++) {
      waveform[i] /= max
    }
  }

  return waveform
}

// ── Helpers ──

function lowPassFilter(data: Float32Array, sampleRate: number, cutoff: number): Float32Array {
  const rc = 1.0 / (cutoff * 2 * Math.PI)
  const dt = 1.0 / sampleRate
  const alpha = dt / (rc + dt)
  const filtered = new Float32Array(data.length)
  filtered[0] = data[0]
  for (let i = 1; i < data.length; i++) {
    filtered[i] = filtered[i - 1] + alpha * (data[i] - filtered[i - 1])
  }
  return filtered
}

function smoothArray(arr: number[], windowSize: number): number[] {
  const result: number[] = []
  const half = Math.floor(windowSize / 2)
  for (let i = 0; i < arr.length; i++) {
    let sum = 0
    let count = 0
    for (let j = Math.max(0, i - half); j <= Math.min(arr.length - 1, i + half); j++) {
      sum += arr[j]
      count++
    }
    result.push(sum / count)
  }
  return result
}

/**
 * Analyze multiple tracks (batch)
 */
export async function analyzePlaylist(
  tracks: Track[],
  onProgress?: (current: number, total: number) => void
): Promise<Map<string, AudioAnalysis>> {
  const results = new Map<string, AudioAnalysis>()

  for (let i = 0; i < tracks.length; i++) {
    onProgress?.(i + 1, tracks.length)
    const analysis = await analyzeTrack(tracks[i])
    if (analysis) {
      results.set(tracks[i].id, analysis)
    }
  }

  return results
}
