export type TrackSource = 'local' | 'tidal'

export interface AppUser {
  id: string
  email: string
  name: string
}

export interface Track {
  id: string
  title: string
  artist: string
  album: string
  duration: number
  source: TrackSource
  filePath?: string
  folderPath?: string
  fileHandle?: FileSystemFileHandle
  providerTrackId?: string
  providerAlbumId?: string
  providerArtistIds?: string[]
  providerUrl?: string
  artworkUrl?: string
  artworkBlob?: Blob
  audioBlob?: Blob
  audioUrl?: string
  r2Key?: string
  artworkR2Key?: string
  genre?: string
  year?: number
  trackNumber?: number
  bpm?: number
  key?: string
  energy?: number
  mood?: string
  tags?: string[]
  isFavorite?: boolean
  addedAt?: number
}

export type PlaylistItem =
  | { source: 'local'; trackId: string }
  | { source: 'tidal'; providerTrackId: string }

export interface Playlist {
  id: string
  name: string
  description?: string
  artworkUrl?: string
  items: PlaylistItem[]
  createdAt: number
  updatedAt: number
  kind: 'app' | 'tidal'
  providerPlaylistId?: string
  writable?: boolean
  trackCount?: number
  folderId?: string
}

export interface PlaylistFolder {
  id: string
  name: string
  parentId?: string
  createdAt: number
  updatedAt: number
}

export type NotificationKind = 'info' | 'success' | 'warning' | 'error'

export interface AppNotification {
  id: string
  kind: NotificationKind
  title: string
  body?: string
  createdAt: number
  readAt?: number
}

export type RepeatMode = 'off' | 'all' | 'one'
export type ViewMode = 'list' | 'grid'
