import Dexie, { type EntityTable } from 'dexie'
import type { Track, Playlist } from './types'

const db = new Dexie('SautiSoundsDB') as Dexie & {
  tracks: EntityTable<Track, 'id'>
  playlists: EntityTable<Playlist, 'id'>
}

db.version(1).stores({
  tracks: 'id, title, artist, album, source, genre, bpm, energy',
  playlists: 'id, name, createdAt',
})

export { db }
