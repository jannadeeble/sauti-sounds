export interface Track {
  id: string
  title: string
  artist: string
  album: string
  duration: number // seconds
  source: 'local' | 'tidal'
  // Local file fields
  filePath?: string
  fileHandle?: FileSystemFileHandle
  // Tidal fields
  tidalId?: number
  tidalUrl?: string
  // Metadata
  artworkUrl?: string
  artworkBlob?: Blob
  audioBlob?: Blob
  genre?: string
  year?: number
  trackNumber?: number
  // Audio analysis (Phase 5)
  bpm?: number
  key?: string // Camelot notation
  energy?: number // 0-1
  mood?: string
  // Tags
  tags?: string[]
}

export interface Playlist {
  id: string
  name: string
  description?: string
  artworkUrl?: string
  trackIds: string[]
  createdAt: number
  updatedAt: number
}

export type RepeatMode = 'off' | 'all' | 'one'

export type ViewMode = 'list' | 'grid'
