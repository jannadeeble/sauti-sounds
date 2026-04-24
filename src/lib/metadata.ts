import * as mm from 'music-metadata-browser'
import type { Track } from '../types'

function generateWaveform(channelData: Float32Array, numBars: number): number[] {
  const samplesPerBar = Math.max(1, Math.floor(channelData.length / numBars))
  const waveform: number[] = []
  let max = 0

  for (let index = 0; index < numBars; index++) {
    const offset = index * samplesPerBar
    let peak = 0
    let sum = 0
    let count = 0

    for (let sampleIndex = 0; sampleIndex < samplesPerBar && offset + sampleIndex < channelData.length; sampleIndex++) {
      const value = Math.abs(channelData[offset + sampleIndex])
      peak = Math.max(peak, value)
      sum += value * value
      count++
    }

    const rms = count > 0 ? Math.sqrt(sum / count) : 0
    const amplitude = (peak * 0.72) + (rms * 0.28)
    waveform.push(amplitude)
    max = Math.max(max, amplitude)
  }

  return max > 0 ? waveform.map((bar) => bar / max) : waveform
}

async function extractWaveformData(file: File): Promise<number[] | undefined> {
  const AudioContextConstructor = window.AudioContext
    ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioContextConstructor) return undefined

  const audioContext = new AudioContextConstructor()
  try {
    const audioBuffer = await audioContext.decodeAudioData(await file.arrayBuffer())
    return generateWaveform(audioBuffer.getChannelData(0), 96)
  } catch {
    return undefined
  } finally {
    void audioContext.close()
  }
}

export async function parseFile(handle: FileSystemFileHandle): Promise<Track> {
  const file = await handle.getFile()
  const metadata = await mm.parseBlob(file)
  const { common, format } = metadata
  const waveformData = await extractWaveformData(file)

  let artworkBlob: Blob | undefined
  if (common.picture && common.picture.length > 0) {
    const pic = common.picture[0]
    artworkBlob = new Blob([new Uint8Array(pic.data)], { type: pic.format })
  }

  return {
    id: `local-${file.name}-${file.size}-${file.lastModified}`,
    title: common.title || file.name.replace(/\.[^/.]+$/, ''),
    artist: common.artist || 'Unknown Artist',
    album: common.album || 'Unknown Album',
    duration: format.duration || 0,
    source: 'local',
    audioBlob: file,
    fileHandle: handle,
    artworkBlob,
    genre: common.genre?.[0],
    year: common.year,
    trackNumber: common.track?.no ?? undefined,
    waveformData,
  }
}

export async function parseFileBlob(file: File): Promise<Track> {
  const metadata = await mm.parseBlob(file)
  const { common, format } = metadata
  const waveformData = await extractWaveformData(file)

  let artworkBlob: Blob | undefined
  if (common.picture && common.picture.length > 0) {
    const pic = common.picture[0]
    artworkBlob = new Blob([new Uint8Array(pic.data)], { type: pic.format })
  }

  return {
    id: `local-${file.name}-${file.size}-${file.lastModified}`,
    title: common.title || file.name.replace(/\.[^/.]+$/, ''),
    artist: common.artist || 'Unknown Artist',
    album: common.album || 'Unknown Album',
    duration: format.duration || 0,
    source: 'local',
    audioBlob: file,
    artworkBlob,
    genre: common.genre?.[0],
    year: common.year,
    trackNumber: common.track?.no ?? undefined,
    waveformData,
  }
}

export function formatTime(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return '0:00'
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}
