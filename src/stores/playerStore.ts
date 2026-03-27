import { create } from 'zustand'
import { Howl } from 'howler'
import type { Track, RepeatMode } from '../types'

interface PlayerState {
  // Current state
  currentTrack: Track | null
  isPlaying: boolean
  currentTime: number
  duration: number
  volume: number
  muted: boolean
  shuffle: boolean
  repeat: RepeatMode

  // Queue
  queue: Track[]
  queueIndex: number
  originalQueue: Track[] // pre-shuffle order

  // Howl instance
  howl: Howl | null

  // Actions
  play: (track?: Track) => void
  pause: () => void
  togglePlay: () => void
  next: () => void
  previous: () => void
  seek: (time: number) => void
  setVolume: (volume: number) => void
  toggleMute: () => void
  toggleShuffle: () => void
  cycleRepeat: () => void
  setQueue: (tracks: Track[], startIndex?: number) => void
  addToQueue: (track: Track) => void
  removeFromQueue: (index: number) => void
  clearQueue: () => void
}

function createHowlFromTrack(track: Track, volume: number): Promise<Howl> {
  return new Promise((resolve, reject) => {
    if (track.source === 'tidal') {
      // Tidal tracks: keep existing behavior (not yet implemented)
      reject(new Error('Tidal playback not yet implemented'))
      return
    }

    if (track.source === 'local' && track.audioBlob) {
      // Prefer stored audio blob (from IndexedDB import)
      const url = URL.createObjectURL(track.audioBlob)
      const ext = track.filePath?.split('.').pop() || 'mp3'
      const howl = new Howl({
        src: [url],
        html5: true,
        volume,
        format: [ext],
        onloaderror: (_id, err) => reject(err),
        onload: () => resolve(howl),
      })
      return
    }

    if (track.source === 'local' && track.fileHandle) {
      // Fall back to FileSystemFileHandle (backward compat)
      track.fileHandle.getFile().then(file => {
        const url = URL.createObjectURL(file)
        const howl = new Howl({
          src: [url],
          html5: true,
          volume,
          format: [file.name.split('.').pop() || 'mp3'],
          onloaderror: (_id, err) => reject(err),
          onload: () => resolve(howl),
        })
      }).catch(reject)
      return
    }

    reject(new Error('Cannot play this track: no audio source available'))
  })
}

function shuffleArray<T>(arr: T[]): T[] {
  const shuffled = [...arr]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  return shuffled
}

export const usePlayerStore = create<PlayerState>((set, get) => {
  let animationFrame: number | null = null

  function startTimeTracking() {
    const tick = () => {
      const { howl, isPlaying } = get()
      if (howl && isPlaying) {
        set({ currentTime: howl.seek() as number })
        animationFrame = requestAnimationFrame(tick)
      }
    }
    if (animationFrame) cancelAnimationFrame(animationFrame)
    animationFrame = requestAnimationFrame(tick)
  }

  function updateMediaSession(track: Track) {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title,
        artist: track.artist,
        album: track.album,
        artwork: track.artworkUrl
          ? [{ src: track.artworkUrl, sizes: '512x512', type: 'image/jpeg' }]
          : [],
      })
      navigator.mediaSession.setActionHandler('play', () => get().togglePlay())
      navigator.mediaSession.setActionHandler('pause', () => get().pause())
      navigator.mediaSession.setActionHandler('previoustrack', () => get().previous())
      navigator.mediaSession.setActionHandler('nexttrack', () => get().next())
    }
  }

  async function loadAndPlay(track: Track) {
    const { howl: oldHowl, volume } = get()
    if (oldHowl) {
      oldHowl.unload()
    }
    if (animationFrame) cancelAnimationFrame(animationFrame)

    set({ currentTrack: track, isPlaying: false, currentTime: 0, duration: 0 })
    updateMediaSession(track)

    try {
      const howl = await createHowlFromTrack(track, volume)
      howl.on('end', () => {
        const state = get()
        if (state.repeat === 'one') {
          howl.seek(0)
          howl.play()
        } else {
          state.next()
        }
      })
      howl.play()
      set({ howl, isPlaying: true, duration: howl.duration() })
      startTimeTracking()
    } catch (err) {
      console.error('Failed to play track:', err)
      set({ isPlaying: false })
    }
  }

  return {
    currentTrack: null,
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    volume: 0.8,
    muted: false,
    shuffle: false,
    repeat: 'off',
    queue: [],
    queueIndex: -1,
    originalQueue: [],
    howl: null,

    play: (track) => {
      if (track) {
        loadAndPlay(track)
      } else {
        const { howl } = get()
        if (howl) {
          howl.play()
          set({ isPlaying: true })
          startTimeTracking()
        }
      }
    },

    pause: () => {
      const { howl } = get()
      if (howl) {
        howl.pause()
        set({ isPlaying: false })
        if (animationFrame) cancelAnimationFrame(animationFrame)
      }
    },

    togglePlay: () => {
      const { isPlaying, play, pause, currentTrack, queue, queueIndex } = get()
      if (isPlaying) {
        pause()
      } else if (currentTrack) {
        play()
      } else if (queue.length > 0) {
        loadAndPlay(queue[queueIndex >= 0 ? queueIndex : 0])
      }
    },

    next: () => {
      const { queue, queueIndex, repeat } = get()
      if (queue.length === 0) return
      let nextIndex = queueIndex + 1
      if (nextIndex >= queue.length) {
        if (repeat === 'all') nextIndex = 0
        else {
          set({ isPlaying: false })
          return
        }
      }
      set({ queueIndex: nextIndex })
      loadAndPlay(queue[nextIndex])
    },

    previous: () => {
      const { queue, queueIndex, currentTime } = get()
      if (queue.length === 0) return
      // If more than 3 seconds in, restart current track
      if (currentTime > 3) {
        const { howl } = get()
        if (howl) {
          howl.seek(0)
          set({ currentTime: 0 })
        }
        return
      }
      const prevIndex = queueIndex > 0 ? queueIndex - 1 : queue.length - 1
      set({ queueIndex: prevIndex })
      loadAndPlay(queue[prevIndex])
    },

    seek: (time) => {
      const { howl } = get()
      if (howl) {
        howl.seek(time)
        set({ currentTime: time })
      }
    },

    setVolume: (volume) => {
      const { howl } = get()
      if (howl) howl.volume(volume)
      set({ volume, muted: false })
    },

    toggleMute: () => {
      const { howl, muted, volume } = get()
      if (howl) howl.volume(muted ? volume : 0)
      set({ muted: !muted })
    },

    toggleShuffle: () => {
      const { shuffle, queue, originalQueue, queueIndex, currentTrack } = get()
      if (!shuffle) {
        const original = [...queue]
        const shuffled = shuffleArray(queue)
        // Move current track to front
        if (currentTrack) {
          const idx = shuffled.findIndex(t => t.id === currentTrack.id)
          if (idx > 0) {
            [shuffled[0], shuffled[idx]] = [shuffled[idx], shuffled[0]]
          }
        }
        set({ shuffle: true, originalQueue: original, queue: shuffled, queueIndex: 0 })
      } else {
        // Restore original order
        const currentId = queue[queueIndex]?.id
        const restoredIndex = originalQueue.findIndex(t => t.id === currentId)
        set({ shuffle: false, queue: [...originalQueue], queueIndex: restoredIndex >= 0 ? restoredIndex : 0 })
      }
    },

    cycleRepeat: () => {
      const { repeat } = get()
      const modes: RepeatMode[] = ['off', 'all', 'one']
      const next = modes[(modes.indexOf(repeat) + 1) % modes.length]
      set({ repeat: next })
    },

    setQueue: (tracks, startIndex = 0) => {
      set({ queue: tracks, originalQueue: [...tracks], queueIndex: startIndex, shuffle: false })
      if (tracks.length > 0) {
        loadAndPlay(tracks[startIndex])
      }
    },

    addToQueue: (track) => {
      set(state => ({ queue: [...state.queue, track] }))
    },

    removeFromQueue: (index) => {
      set(state => {
        const newQueue = state.queue.filter((_, i) => i !== index)
        let newIndex = state.queueIndex
        if (index < state.queueIndex) newIndex--
        return { queue: newQueue, queueIndex: newIndex }
      })
    },

    clearQueue: () => {
      const { howl } = get()
      if (howl) howl.unload()
      if (animationFrame) cancelAnimationFrame(animationFrame)
      set({
        queue: [],
        queueIndex: -1,
        currentTrack: null,
        isPlaying: false,
        currentTime: 0,
        duration: 0,
        howl: null,
      })
    },
  }
})
