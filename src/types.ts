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
  waveformData?: number[]
  mood?: string
  tags?: TrackTags
  isFavorite?: boolean
  addedAt?: number
}

export interface TrackTags {
  energy: number
  mood: string
  genres: string[]
  bpmEstimate?: number
  vibeDescriptors: string[]
  culturalContext?: string
  taggedAt: number
}

export type PlaylistItem =
  | { source: 'local'; trackId: string }
  | { source: 'tidal'; providerTrackId: string }

export type PlaylistOrigin = 'manual' | 'generated' | 'imported'

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
  origin?: PlaylistOrigin
  generatedFromMixId?: string
  generatedPrompt?: string
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

export type PlaybackContext =
  | 'library'
  | 'search-local'
  | 'search-tidal'
  | 'app-playlist'
  | 'tidal-playlist'

export interface SelectedPlaylist {
  kind: 'app' | 'tidal'
  id: string
}

export type PersistedTrackSnapshot = Omit<Track, 'audioBlob' | 'artworkBlob' | 'fileHandle' | 'waveformData'>

export interface PersistedQueueItem {
  id: string
  source: TrackSource
  providerTrackId?: string
  track: PersistedTrackSnapshot
}

export interface PersistedPlaybackState {
  context: PlaybackContext
  queue: PersistedQueueItem[]
  currentTrackId: string | null
  currentIndex: number
  currentTime: number
  duration: number
  wasPlaying: boolean
  selectedPlaylist?: SelectedPlaylist
  updatedAt: number
}

export type RepeatMode = 'off' | 'all' | 'one'
export type ViewMode = 'list' | 'grid'

export interface HistoryEntry {
  id: string
  trackId: string
  playedAt: number
  source: TrackSource
  title: string
  artist: string
  album?: string
  duration: number
  providerTrackId?: string
  artworkUrl?: string
}

export type ListenContext =
  | 'manual'
  | `playlist:${string}`
  | `suggestion:${string}`
  | 'auto-radio'
  | 'search'

export interface ListenEvent {
  id: string
  trackId: string
  startedAt: number
  msListened: number
  completed: boolean
  skipped: boolean
  context: ListenContext
}

export interface TasteProfile {
  coreIdentity: string
  primaryGenres: string[]
  energyPreference: { min: number; max: number; sweet_spot: number }
  culturalMarkers: string[]
  antiPreferences: string[]
  favoriteArtists: string[]
  moodPreferences: string[]
}

export interface TasteProfileRecord {
  id: 'current'
  profile: TasteProfile
  builtAt: number
  builtFromTrackCount: number
}

export type MixKind =
  | 'mood-playlist'
  | 'playlist-echo'
  | 'track-echo'
  | 'similar-artist'
  | 'rediscovery'
  | 'cultural-bridge'
  | 'setlist-seed'
  | 'playlist-footer'
  | 'auto-radio-buffer'

export type MixSeedRef =
  | { type: 'playlist'; id: string }
  | { type: 'track'; id: string }
  | { type: 'artist'; name: string }
  | { type: 'mood'; prompt: string }
  | null

export type MixStatus = 'fresh' | 'stale' | 'dismissed' | 'saved'

export interface UnresolvedRecommendation {
  artist: string
  title: string
  reason: string
  message: string
  round?: number
  score?: number
  candidate?: {
    artist?: string
    title?: string
    album?: string
  }
  error?: string
}

export interface Mix {
  id: string
  kind: MixKind
  seedRef: MixSeedRef
  title: string
  blurb: string
  trackIds: string[]
  unresolvedCount: number
  unresolvedTracks?: UnresolvedRecommendation[]
  focusPrompt?: string
  generatedAt: number
  expiresAt: number
  status: MixStatus
}
