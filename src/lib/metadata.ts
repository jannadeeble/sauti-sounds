import * as mm from 'music-metadata-browser'
import type { Track } from '../types'

export async function parseFile(handle: FileSystemFileHandle): Promise<Track> {
  const file = await handle.getFile()
  const metadata = await mm.parseBlob(file)
  const { common, format } = metadata

  let artworkUrl: string | undefined
  if (common.picture && common.picture.length > 0) {
    const pic = common.picture[0]
    const blob = new Blob([new Uint8Array(pic.data)], { type: pic.format })
    artworkUrl = URL.createObjectURL(blob)
  }

  return {
    id: `local-${file.name}-${file.size}-${file.lastModified}`,
    title: common.title || file.name.replace(/\.[^/.]+$/, ''),
    artist: common.artist || 'Unknown Artist',
    album: common.album || 'Unknown Album',
    duration: format.duration || 0,
    source: 'local',
    fileHandle: handle,
    artworkUrl,
    genre: common.genre?.[0],
    year: common.year,
    trackNumber: common.track?.no ?? undefined,
  }
}

export async function parseFileBlob(file: File): Promise<Track> {
  const metadata = await mm.parseBlob(file)
  const { common, format } = metadata

  let artworkUrl: string | undefined
  if (common.picture && common.picture.length > 0) {
    const pic = common.picture[0]
    const blob = new Blob([new Uint8Array(pic.data)], { type: pic.format })
    artworkUrl = URL.createObjectURL(blob)
  }

  return {
    id: `local-${file.name}-${file.size}-${file.lastModified}`,
    title: common.title || file.name.replace(/\.[^/.]+$/, ''),
    artist: common.artist || 'Unknown Artist',
    album: common.album || 'Unknown Album',
    duration: format.duration || 0,
    source: 'local',
    audioBlob: file,
    artworkUrl,
    genre: common.genre?.[0],
    year: common.year,
    trackNumber: common.track?.no ?? undefined,
  }
}

export function formatTime(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return '0:00'
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}
