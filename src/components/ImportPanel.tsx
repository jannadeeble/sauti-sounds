import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, CheckCircle, FileJson, FolderOpen, ListMusic, Music, Upload, XCircle } from 'lucide-react'
import {
  buildLibraryMatchMap,
  buildPlaylistsFromMatches,
  collectPlaylistTracks,
  matchSpotifyToTidal,
  parseSpotifyLibrary,
  parseSpotifyPlaylists,
  type ImportProgress,
  type MatchResult,
  type SpotifyPlaylist,
  type SpotifyTrackEntry,
} from '../lib/spotifyImport'
import type { LocalDedupMatch } from '../lib/localDedup'
import { useLibraryStore } from '../stores/libraryStore'
import { usePlaylistStore } from '../stores/playlistStore'
import { useTidalStore } from '../stores/tidalStore'
import type { Track } from '../types'

type Step = 'upload' | 'parsing' | 'matching' | 'review' | 'dedupe-review' | 'done'
type ConflictMode = 'skip' | 'merge' | 'replace'
type SpotifyMode = 'tracks' | 'playlists'

export interface ImportDoneResult {
  importedTracks?: Track[]
}

interface ImportPanelProps {
  onDone: (result?: ImportDoneResult) => void
}

export default function ImportPanel({ onDone }: ImportPanelProps) {
  const importFilesViaInput = useLibraryStore((state) => state.importFilesViaInput)
  const importFolder = useLibraryStore((state) => state.importFolder)
  const importing = useLibraryStore((state) => state.importing)
  const importProgress = useLibraryStore((state) => state.importProgress)
  const cacheTidalTracks = useLibraryStore((state) => state.cacheTidalTracks)
  const libraryTracks = useLibraryStore((state) => state.tracks)
  const pendingLocalSwaps = useLibraryStore((state) => state.pendingLocalSwaps)
  const applyLocalSwaps = useLibraryStore((state) => state.applyLocalSwaps)
  const clearPendingLocalSwaps = useLibraryStore((state) => state.clearPendingLocalSwaps)
  const appPlaylists = usePlaylistStore((state) => state.appPlaylists)
  const loadPlaylists = usePlaylistStore((state) => state.loadPlaylists)
  const bulkImportAppPlaylists = usePlaylistStore((state) => state.bulkImportAppPlaylists)
  const tidalConnected = useTidalStore((state) => state.tidalConnected)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [step, setStep] = useState<Step>('upload')
  const [spotifyMode, setSpotifyMode] = useState<SpotifyMode>('tracks')
  const [spotifyTracks, setSpotifyTracks] = useState<SpotifyTrackEntry[]>([])
  const [spotifyPlaylists, setSpotifyPlaylists] = useState<SpotifyPlaylist[]>([])
  const [matched, setMatched] = useState<MatchResult[]>([])
  const [uncertain, setUncertain] = useState<MatchResult[]>([])
  const [missing, setMissing] = useState<MatchResult[]>([])
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [reviewTab, setReviewTab] = useState<'matched' | 'uncertain' | 'missing'>('matched')
  const [acceptedUncertain, setAcceptedUncertain] = useState<Set<number>>(new Set())
  const [rejectedMatched, setRejectedMatched] = useState<Set<number>>(new Set())
  const [conflictMode, setConflictMode] = useState<ConflictMode>('skip')
  const [finishing, setFinishing] = useState(false)
  const [finishError, setFinishError] = useState<string | null>(null)
  const [finishSummary, setFinishSummary] = useState<{
    tracks: number
    created: number
    merged: number
    replaced: number
    skipped: number
    unresolvedPlaylistTracks?: number
  } | null>(null)
  const [dedupeMatches, setDedupeMatches] = useState<LocalDedupMatch[]>([])
  const [acceptedDedupe, setAcceptedDedupe] = useState<Set<number>>(new Set())
  const [applyingDedupe, setApplyingDedupe] = useState(false)
  const [dedupeAutoApplied, setDedupeAutoApplied] = useState(0)
  // In playlists-only mode the library lookup happens at parse time; keep the
  // resolved map around so finishImport() doesn't re-do the work.
  const [libraryMatchMap, setLibraryMatchMap] = useState<Map<string, Track>>(new Map())

  // Keep loaded app playlists in sync so conflict detection reflects reality.
  useEffect(() => {
    if (step === 'upload') {
      void loadPlaylists()
    }
  }, [step, loadPlaylists])

  // If the user arrives at the panel with pending dedupe matches queued from
  // a quick-import elsewhere, surface the review immediately.
  useEffect(() => {
    if (step === 'upload' && pendingLocalSwaps.length > 0 && dedupeMatches.length === 0) {
      setDedupeMatches(pendingLocalSwaps)
      setAcceptedDedupe(new Set(pendingLocalSwaps.map((_, i) => i)))
      setDedupeAutoApplied(0)
      setStep('dedupe-review')
    }
  }, [step, pendingLocalSwaps, dedupeMatches.length])

  const existingPlaylistNames = useMemo(() => {
    const set = new Set<string>()
    for (const p of appPlaylists) set.add(p.name.toLowerCase())
    return set
  }, [appPlaylists])

  const conflictCount = useMemo(
    () => spotifyPlaylists.filter((p) => existingPlaylistNames.has(p.name.toLowerCase())).length,
    [spotifyPlaylists, existingPlaylistNames],
  )

  const selectedTrackCount =
    matched.length - rejectedMatched.size + acceptedUncertain.size

  const handleLocalImport = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget
    const files = input.files
    if (!files || files.length === 0) return

    const result = await importFilesViaInput(files)
    input.value = ''
    if (result.dedupeUncertain.length > 0) {
      setDedupeMatches(result.dedupeUncertain)
      setAcceptedDedupe(new Set(result.dedupeUncertain.map((_, i) => i)))
      setDedupeAutoApplied(result.dedupeApplied)
      setStep('dedupe-review')
      return
    }
    onDone({ importedTracks: result.tracks })
  }, [importFilesViaInput, onDone])

  const handleFolderImport = useCallback(async () => {
    try {
      const pickerWindow = window as unknown as Window & {
        showDirectoryPicker: (options?: object) => Promise<FileSystemDirectoryHandle>
      }

      const handle = await pickerWindow.showDirectoryPicker()
      const result = await importFolder(handle)

      if (result.playlists.length > 0) {
        await usePlaylistStore.getState().loadPlaylists()
      }

      if (result.dedupeUncertain.length > 0) {
        setDedupeMatches(result.dedupeUncertain)
        setAcceptedDedupe(new Set(result.dedupeUncertain.map((_, i) => i)))
        setDedupeAutoApplied(result.dedupeApplied)
        setStep('dedupe-review')
        return
      }

      onDone({ importedTracks: result.tracks })
    } catch (error) {
      if (!(error instanceof DOMException) || error.name !== 'AbortError') {
        const message = error instanceof Error ? error.message : 'Failed to import folder.'
        alert(message)
      }
    }
  }, [importFolder, onDone])

  const handleSpotifyUpload = useCallback(async (mode: SpotifyMode) => {
    try {
      const pickerWindow = window as unknown as Window & {
        showOpenFilePicker: (options: object) => Promise<FileSystemFileHandle[]>
      }

      const handles = await pickerWindow.showOpenFilePicker({
        multiple: true,
        types: [{ description: 'JSON files', accept: { 'application/json': ['.json'] } }],
      })

      setSpotifyMode(mode)
      setStep('parsing')
      setFinishError(null)
      setRejectedMatched(new Set())
      setAcceptedUncertain(new Set())
      setLibraryMatchMap(new Map())
      setMatched([])
      setUncertain([])
      setMissing([])

      const allLibraryTracks: SpotifyTrackEntry[] = []
      const allPlaylists: SpotifyPlaylist[] = []

      for (const handle of handles) {
        const file = await handle.getFile()
        const text = await file.text()
        const json = JSON.parse(text)

        allLibraryTracks.push(...parseSpotifyLibrary(json))
        allPlaylists.push(...parseSpotifyPlaylists(json))
      }

      if (mode === 'tracks') {
        // Tracks mode: YourLibrary + anything embedded in playlist files, all
        // flattened into one matchable pool. No playlists get created here —
        // that's a second pass the user runs after tracks land.
        const combined: SpotifyTrackEntry[] = [...allLibraryTracks]
        for (const playlist of allPlaylists) combined.push(...playlist.tracks)

        const seen = new Set<string>()
        const uniqueTracks = combined.filter((track) => {
          const key = `${track.artistName}|||${track.trackName}`.toLowerCase()
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })

        setSpotifyTracks(uniqueTracks)
        setSpotifyPlaylists([])

        if (uniqueTracks.length === 0) {
          alert('No tracks found in the selected files. Pick YourLibrary.json or a Playlist*.json export.')
          setStep('upload')
          return
        }

        if (!tidalConnected) {
          setMissing(uniqueTracks.map((t) => ({ spotify: t, tidalMatch: null, confidence: 'none' as const })))
          setStep('review')
          return
        }

        setStep('matching')
        const results = await matchSpotifyToTidal(uniqueTracks, setProgress)
        setMatched(results.matched)
        setUncertain(results.uncertain)
        setMissing(results.missing)
        setStep('review')
        return
      }

      // Playlists mode: use only the Playlist*.json files. Resolve each track
      // against the library already in IndexedDB; TIDAL is consulted only for
      // leftovers so we don't force round-trips for tracks we already have.
      if (allPlaylists.length === 0) {
        alert('No playlists found in the selected files. Pick Playlist1.json / Playlist2.json etc.')
        setStep('upload')
        return
      }

      // Spotify-generated auto-playlists tend to be huge and full of tracks
      // the user never actually picked (Discover Weekly gets a new 30 tracks
      // every Monday). Skip them so the playlist list isn't dominated by
      // algorithm spam.
      const filteredPlaylists = allPlaylists.filter((p) => {
        const name = p.name.toLowerCase()
        if (name.includes('discover weekly')) return false
        if (name.includes('release radar')) return false
        if (name.startsWith('daily mix')) return false
        if (name.startsWith('your daily mix')) return false
        return true
      })

      if (filteredPlaylists.length === 0) {
        alert('All playlists in the selection were auto-generated (Discover Weekly, Daily Mix) and were skipped. Pick a file with hand-made playlists.')
        setStep('upload')
        return
      }

      const playlistTracks = collectPlaylistTracks(filteredPlaylists)
      setSpotifyTracks(playlistTracks)
      setSpotifyPlaylists(filteredPlaylists)

      const libMatches = buildLibraryMatchMap(playlistTracks, libraryTracks)
      setLibraryMatchMap(libMatches)

      const unresolved = playlistTracks.filter(
        (t) => !libMatches.has(`${t.artistName}|||${t.trackName}`.toLowerCase()),
      )

      if (unresolved.length === 0 || !tidalConnected) {
        // Everything already in library (or TIDAL disconnected, in which case
        // we can still build playlists from whatever matched locally).
        setMissing(unresolved.map((t) => ({ spotify: t, tidalMatch: null, confidence: 'none' as const })))
        setStep('review')
        return
      }

      setStep('matching')
      const results = await matchSpotifyToTidal(unresolved, setProgress)
      setMatched(results.matched)
      setUncertain(results.uncertain)
      setMissing(results.missing)
      setStep('review')
    } catch (error) {
      if (!(error instanceof DOMException) || error.name !== 'AbortError') {
        const message = error instanceof Error ? error.message : 'Failed to parse Spotify export.'
        alert(message)
      }
      setStep('upload')
    }
  }, [tidalConnected, libraryTracks])

  async function finishImport() {
    setFinishing(true)
    setFinishError(null)
    try {
      // Explicit add: exactly the tracks the user opted to keep.
      const acceptedMatched = matched
        .map((result, index) => ({ result, index }))
        .filter(({ index }) => !rejectedMatched.has(index))
        .map(({ result }) => result)

      const acceptedUncertainResults = uncertain
        .map((result, index) => ({ result, index }))
        .filter(({ index }) => acceptedUncertain.has(index))
        .map(({ result }) => result)

      const tracksToSave = [
        ...acceptedMatched.map((r) => r.tidalMatch!).filter(Boolean),
        ...acceptedUncertainResults.map((r) => r.tidalMatch!).filter(Boolean),
      ]

      // Route through the canonical library helper so the store refreshes
      // and any future write-path changes (analytics, R2, etc.) apply here too.
      if (tracksToSave.length > 0) {
        await cacheTidalTracks(tracksToSave)
      }

      if (spotifyMode === 'tracks') {
        // Tracks-only: we just cached tracks, nothing else to do.
        setFinishSummary({
          tracks: tracksToSave.length,
          created: 0,
          merged: 0,
          replaced: 0,
          skipped: 0,
        })
        setStep('done')
        return
      }

      // Playlists mode: combine pre-existing library hits + newly-matched
      // TIDAL results into one match map, then build playlists from it.
      const matchMap = new Map<string, Track>(libraryMatchMap)
      for (const result of acceptedMatched) {
        if (result.tidalMatch) {
          matchMap.set(
            `${result.spotify.artistName}|||${result.spotify.trackName}`.toLowerCase(),
            result.tidalMatch,
          )
        }
      }
      for (const result of acceptedUncertainResults) {
        if (result.tidalMatch) {
          matchMap.set(
            `${result.spotify.artistName}|||${result.spotify.trackName}`.toLowerCase(),
            result.tidalMatch,
          )
        }
      }

      const playlistsToSave = buildPlaylistsFromMatches(spotifyPlaylists, matchMap)
      const summary = playlistsToSave.length > 0
        ? await bulkImportAppPlaylists(playlistsToSave, conflictMode)
        : { created: 0, merged: 0, replaced: 0, skipped: 0 }

      // Count tracks that still didn't resolve — useful feedback for users
      // who ran playlists-only before importing their full tracks library.
      const unresolvedCount = spotifyPlaylists.reduce((sum, pl) => {
        let missingInPl = 0
        for (const t of pl.tracks) {
          const key = `${t.artistName}|||${t.trackName}`.toLowerCase()
          if (!matchMap.has(key)) missingInPl += 1
        }
        return sum + missingInPl
      }, 0)

      setFinishSummary({
        tracks: tracksToSave.length,
        ...summary,
        unresolvedPlaylistTracks: unresolvedCount,
      })
      setStep('done')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Import failed.'
      setFinishError(message)
    } finally {
      setFinishing(false)
    }
  }

  function toggleUncertain(index: number) {
    setAcceptedUncertain((current) => {
      const next = new Set(current)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  function toggleDedupe(index: number) {
    setAcceptedDedupe((current) => {
      const next = new Set(current)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  async function finishDedupeReview() {
    setApplyingDedupe(true)
    try {
      const accepted = dedupeMatches.filter((_, i) => acceptedDedupe.has(i))
      if (accepted.length > 0) {
        await applyLocalSwaps(accepted)
      }
      clearPendingLocalSwaps()
      setDedupeMatches([])
      setAcceptedDedupe(new Set())
      setDedupeAutoApplied(0)
      setStep('upload')
      onDone()
    } finally {
      setApplyingDedupe(false)
    }
  }

  function skipDedupeReview() {
    clearPendingLocalSwaps()
    setDedupeMatches([])
    setAcceptedDedupe(new Set())
    setDedupeAutoApplied(0)
    setStep('upload')
    onDone()
  }

  function toggleMatched(index: number) {
    setRejectedMatched((current) => {
      const next = new Set(current)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  const cardClass = 'sauti-modal-card p-5'
  const iconChipClass = 'flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#f1f1f4]'
  const primaryBtnClass =
    'inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-accent px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-accent-dark disabled:opacity-50'
  const secondaryBtnClass =
    'inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-black/8 bg-[#f8f8f9] px-4 py-3 text-sm font-medium text-[#111116] transition-colors hover:bg-[#f1f1f4] disabled:opacity-50'

  const primaryLabel = importing && importProgress
    ? `Uploading ${importProgress.current}/${importProgress.total}`
    : 'Choose files'
  const secondaryLabel = importing && importProgress
    ? `Uploading ${importProgress.current}/${importProgress.total}`
    : 'Choose folder'

  return (
    <div className="space-y-6 pb-6">
      {step === 'upload' ? (
        <div className="space-y-4">
          <section className={cardClass}>
            <header className="mb-4 flex items-center gap-3">
              <div className={iconChipClass}>
                <Music size={20} className="text-accent" />
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-[#111116]">Local files</h3>
                <p className="text-sm text-[#7a7b86]">Audio stored on this device</p>
              </div>
            </header>

            <p className="mb-4 text-sm text-[#7a7b86]">
              Supports MP3, FLAC, WAV, AAC, OGG, and M4A. Files are cached for direct playback.
            </p>

            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".mp3,.flac,.wav,.aac,.ogg,.m4a,audio/*"
              className="hidden"
              onChange={handleLocalImport}
            />

            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={importing}
                className={primaryBtnClass}
              >
                <Upload size={16} />
                {primaryLabel}
              </button>

              <button
                type="button"
                onClick={() => void handleFolderImport()}
                disabled={importing}
                className={secondaryBtnClass}
              >
                <FolderOpen size={16} />
                {secondaryLabel}
              </button>
            </div>

            {importing && importProgress ? (
              <div className="sauti-modal-card-muted mt-4 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-[#111116]">Uploading to your library</p>
                  <span className="shrink-0 rounded-full bg-white px-3 py-1 text-xs font-semibold text-[#555661]">
                    {importProgress.current}/{importProgress.total}
                  </span>
                </div>
                <p className="mt-1 truncate text-xs text-[#7a7b86]">
                  {importProgress.currentFile
                    ? `Processing ${importProgress.currentFile}`
                    : 'Caching audio and artwork…'}
                </p>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-white">
                  <div
                    className="h-full rounded-full bg-accent transition-[width] duration-300"
                    style={{ width: `${(importProgress.current / importProgress.total) * 100}%` }}
                  />
                </div>
              </div>
            ) : null}
          </section>

          <section className={cardClass}>
            <header className="mb-4 flex items-center gap-3">
              <div className={iconChipClass}>
                <FileJson size={20} className="text-[#1db954]" />
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-[#111116]">Spotify export</h3>
                <p className="text-sm text-[#7a7b86]">Tracks first, then rebuild playlists</p>
              </div>
            </header>

            <p className="mb-4 text-sm text-[#7a7b86]">
              Run these in order. <span className="font-semibold text-[#111116]">Step 1</span> takes any Spotify
              JSON (YourLibrary.json, Playlist1.json, Playlist2.json, or all of them at once) and pulls every
              track it finds into your library. <span className="font-semibold text-[#111116]">Step 2</span> rebuilds
              your playlists — wiring each one to tracks already in your library, no re-matching. Discover Weekly
              and Daily Mix are skipped automatically.
              {!tidalConnected
                ? ' Connect TIDAL in Settings first to auto-match tracks you don\'t already have locally.'
                : ''}
            </p>

            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => void handleSpotifyUpload('tracks')}
                className={primaryBtnClass}
              >
                <Music size={16} />
                1. Upload tracks
              </button>

              <button
                type="button"
                onClick={() => void handleSpotifyUpload('playlists')}
                disabled={libraryTracks.length === 0}
                className={secondaryBtnClass}
                title={libraryTracks.length === 0 ? 'Upload tracks first so playlists have something to reference' : undefined}
              >
                <ListMusic size={16} />
                2. Upload playlists
              </button>
            </div>

            <p className="mt-3 text-xs text-[#8b8c95]">
              {libraryTracks.length === 0
                ? 'Library is empty — run step 1 first.'
                : `Library has ${libraryTracks.length.toLocaleString()} track${libraryTracks.length === 1 ? '' : 's'} ready to reference.`}
            </p>
          </section>
        </div>
      ) : null}

      {step === 'parsing' ? (
        <div className="py-16 text-center text-[#7a7b86]">Parsing Spotify export...</div>
      ) : null}

      {step === 'dedupe-review' ? (
        <div>
          <div className="mb-4">
            <h3 className="text-base font-semibold text-[#111116]">Replace TIDAL duplicates?</h3>
            <p className="mt-1 text-sm text-[#7a7b86]">
              {dedupeAutoApplied > 0
                ? `Auto-replaced ${dedupeAutoApplied} obvious duplicate${dedupeAutoApplied === 1 ? '' : 's'}. `
                : ''}
              These {dedupeMatches.length} look{dedupeMatches.length === 1 ? 's' : ''} close but we're not sure.
              Accepted swaps drop the TIDAL track from your library and rewire every playlist to the local file.
            </p>
          </div>

          <div className="max-h-[52vh] space-y-2 overflow-y-auto">
            {dedupeMatches.map((match, index) => {
              const accepted = acceptedDedupe.has(index)
              const scorePct = Math.round(match.score * 100)
              return (
                <button
                  key={`${match.local.id}-${match.tidal.id}`}
                  type="button"
                  onClick={() => toggleDedupe(index)}
                  className={`flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition-colors ${
                    accepted
                      ? 'border border-accent/30 bg-accent/5'
                      : 'border border-black/6 bg-white hover:bg-[#fafafb]'
                  }`}
                >
                  <AlertCircle size={16} className="shrink-0 text-yellow-400" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs uppercase tracking-wide text-[#8c8d96]">Local</p>
                    <p className="truncate text-sm text-[#111116]">{match.local.title}</p>
                    <p className="truncate text-xs text-[#7a7b86]">{match.local.artist}</p>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs uppercase tracking-wide text-[#8c8d96]">TIDAL (will be replaced)</p>
                    <p className="truncate text-sm text-[#111116]">{match.tidal.title}</p>
                    <p className="truncate text-xs text-[#7a7b86]">{match.tidal.artist}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="rounded-full bg-[#f3f3f6] px-2 py-0.5 text-[11px] font-medium text-[#686973]">
                      {scorePct}%
                    </span>
                    <div className={`h-5 w-5 rounded-full border ${accepted ? 'border-accent bg-accent' : 'border-[#b4b6c0]'}`} />
                  </div>
                </button>
              )
            })}
          </div>

          <div className="mt-6 grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => void finishDedupeReview()}
              disabled={applyingDedupe}
              className={primaryBtnClass}
            >
              {applyingDedupe
                ? 'Applying…'
                : `Replace ${acceptedDedupe.size} TIDAL track${acceptedDedupe.size === 1 ? '' : 's'}`}
            </button>
            <button
              type="button"
              onClick={skipDedupeReview}
              disabled={applyingDedupe}
              className={secondaryBtnClass}
            >
              Skip — keep everything
            </button>
          </div>
        </div>
      ) : null}

      {step === 'matching' && progress ? (
        <div className="py-12 text-center">
          <p className="text-sm font-medium">
            Matching tracks on TIDAL ({progress.current}/{progress.total})
          </p>
          <p className="mx-auto mt-2 max-w-sm text-xs text-[#8c8d96]">{progress.message}</p>
          <div className="mx-auto mt-4 h-2 w-64 rounded-full bg-[#efeff2]">
            <div
              className="h-full rounded-full bg-accent"
              style={{ width: `${(progress.current / progress.total) * 100}%` }}
            />
          </div>
        </div>
      ) : null}

      {step === 'review' ? (
        <div>
          <div className="mb-6 grid grid-cols-3 gap-3">
            <div className="rounded-2xl border border-black/8 bg-[#f8f8f9] p-3 text-center">
              <p className="text-2xl font-semibold text-[#111116]">{matched.length}</p>
              <p className="text-xs text-[#7a7b86]">Matched</p>
            </div>
            <div className="rounded-2xl border border-[#f4c6cc] bg-[#fff4f6] p-3 text-center">
              <p className="text-2xl font-semibold text-[#8d3140]">{uncertain.length}</p>
              <p className="text-xs text-[#8d3140]">Uncertain</p>
            </div>
            <div className="rounded-2xl border border-black/8 bg-[#f8f8f9] p-3 text-center">
              <p className="text-2xl font-semibold text-[#686973]">{missing.length}</p>
              <p className="text-xs text-[#7a7b86]">Missing</p>
            </div>
          </div>

          <p className="mb-4 text-xs text-[#8c8d96]">
            {spotifyMode === 'tracks'
              ? `${spotifyTracks.length} unique tracks parsed from your export.`
              : `${spotifyPlaylists.length} playlist${spotifyPlaylists.length === 1 ? '' : 's'} parsed · ${libraryMatchMap.size} track${libraryMatchMap.size === 1 ? '' : 's'} resolved from your library${matched.length + uncertain.length > 0 ? `, ${matched.length + uncertain.length} fetched from TIDAL` : ''}.`}
          </p>

          {spotifyMode === 'playlists' && conflictCount > 0 ? (
            <div className="mb-4 rounded-2xl border border-[#f4c6cc] bg-[#fff4f6] p-4">
              <p className="text-sm font-semibold text-[#8d3140]">
                {conflictCount} playlist{conflictCount === 1 ? '' : 's'} already exist in your library
              </p>
              <p className="mt-1 text-xs text-[#b25563]">
                Choose how to handle name conflicts. Non-conflicting playlists will always be created.
              </p>
              <div className="mt-3 flex gap-1 rounded-full border border-[var(--sauti-accent-wash-border)] bg-white p-1">
                {(['skip', 'merge', 'replace'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setConflictMode(mode)}
                    className={`flex-1 rounded-full px-3 py-2 text-xs font-medium capitalize transition-colors ${
                      conflictMode === mode ? 'bg-[#ef5466] text-white' : 'text-[#8d3140] hover:bg-[#fff4f6]'
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-[#b25563]">
                {conflictMode === 'skip' && 'Leave existing playlists untouched.'}
                {conflictMode === 'merge' && 'Append new tracks, dedupe against existing items.'}
                {conflictMode === 'replace' && 'Delete existing playlists and create fresh ones.'}
              </p>
            </div>
          ) : null}

          <div className="mb-4 flex gap-1 rounded-full border border-black/8 bg-[#f8f8f9] p-1">
            {(['matched', 'uncertain', 'missing'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setReviewTab(tab)}
                className={`flex-1 rounded-full px-3 py-2 text-xs font-medium capitalize transition-colors ${
                  reviewTab === tab ? 'bg-[#ef5466] text-white' : 'text-[#7a7b86] hover:bg-[#ffffff]'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          <div className="max-h-[42vh] space-y-2 overflow-y-auto">
            {reviewTab === 'matched'
              ? matched.map((result, index) => {
                  const rejected = rejectedMatched.has(index)
                  return (
                    <button
                      key={`${result.spotify.trackName}-${index}`}
                      type="button"
                      onClick={() => toggleMatched(index)}
                      className={`flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition-colors ${
                        rejected ? 'border border-black/6 bg-[#f8f8f9] opacity-60' : 'border border-black/6 bg-white hover:bg-[#fafafb]'
                      }`}
                    >
                      <CheckCircle size={16} className={rejected ? 'text-[#b4b6c0]' : 'text-green-400'} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-[#111116]">{result.spotify.trackName}</p>
                        <p className="truncate text-xs text-[#7a7b86]">{result.spotify.artistName}</p>
                      </div>
                      <div className="min-w-0 flex-1 text-right">
                        <p className={`truncate text-sm ${rejected ? 'text-[#7a7b86]' : 'text-green-700'}`}>
                          {result.tidalMatch?.title}
                        </p>
                        <p className="truncate text-xs text-[#7a7b86]">{result.tidalMatch?.artist}</p>
                      </div>
                      <div className={`h-5 w-5 rounded-full border ${rejected ? 'border-[#b4b6c0]' : 'border-accent bg-accent'}`} />
                    </button>
                  )
                })
              : null}

            {reviewTab === 'uncertain'
              ? uncertain.map((result, index) => {
                  const accepted = acceptedUncertain.has(index)

                  return (
                    <button
                      key={`${result.spotify.trackName}-${index}`}
                      type="button"
                      onClick={() => toggleUncertain(index)}
                      className={`flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition-colors ${
                        accepted ? 'border border-yellow-500/20 bg-yellow-500/10' : 'border border-black/6 bg-white hover:bg-[#fafafb]'
                      }`}
                    >
                      <AlertCircle size={16} className="text-yellow-400" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-[#111116]">{result.spotify.trackName}</p>
                        <p className="truncate text-xs text-[#7a7b86]">{result.spotify.artistName}</p>
                      </div>
                      <div className="min-w-0 flex-1 text-right">
                        <p className="truncate text-sm text-yellow-700">{result.tidalMatch?.title}</p>
                        <p className="truncate text-xs text-[#7a7b86]">{result.tidalMatch?.artist}</p>
                      </div>
                      <div className={`h-5 w-5 rounded-full border ${accepted ? 'border-accent bg-accent' : 'border-[#b4b6c0]'}`} />
                    </button>
                  )
                })
              : null}

            {reviewTab === 'missing'
              ? missing.map((result, index) => (
                  <div key={`${result.spotify.trackName}-${index}`} className="flex items-center gap-3 rounded-2xl border border-black/6 bg-white px-4 py-3">
                    <XCircle size={16} className="text-red-400/70" />
                    <div className="min-w-0">
                      <p className="truncate text-sm text-[#111116]">{result.spotify.trackName}</p>
                      <p className="truncate text-xs text-[#7a7b86]">{result.spotify.artistName}</p>
                    </div>
                  </div>
                ))
              : null}
          </div>

          {finishError ? (
            <div className="mt-4 rounded-2xl border border-[#f4c6cc] bg-[#fff4f6] p-4 text-sm text-[#8d3140]">
              {finishError}
            </div>
          ) : null}

          <button
            type="button"
            onClick={() => void finishImport()}
            disabled={
              finishing ||
              (spotifyMode === 'tracks'
                ? selectedTrackCount === 0
                : libraryMatchMap.size === 0 && selectedTrackCount === 0)
            }
            className="mt-6 inline-flex w-full items-center justify-center rounded-2xl bg-accent px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-accent-dark disabled:opacity-50"
          >
            {finishing
              ? spotifyMode === 'tracks'
                ? 'Adding to library…'
                : 'Creating playlists…'
              : spotifyMode === 'tracks'
                ? `Add ${selectedTrackCount} track${selectedTrackCount === 1 ? '' : 's'} to library`
                : `Create ${spotifyPlaylists.length} playlist${spotifyPlaylists.length === 1 ? '' : 's'}`}
          </button>
        </div>
      ) : null}

      {step === 'done' && finishSummary ? (
        <div className="py-12 text-center">
          <CheckCircle size={48} className="mx-auto mb-4 text-green-400" />
          <h3 className="text-lg font-semibold">
            {spotifyMode === 'tracks' ? 'Tracks added' : 'Playlists ready'}
          </h3>

          {spotifyMode === 'tracks' ? (
            <>
              <p className="mx-auto mt-2 max-w-sm text-sm text-[#7a7b86]">
                Added {finishSummary.tracks} track{finishSummary.tracks === 1 ? '' : 's'} to your library.
              </p>
              <p className="mx-auto mt-1 max-w-sm text-xs text-[#8c8d96]">
                Run step 2 next to rebuild your playlists against these tracks.
              </p>
            </>
          ) : (
            <>
              <p className="mx-auto mt-2 max-w-sm text-sm text-[#7a7b86]">
                {finishSummary.created} created
                {finishSummary.merged > 0 ? `, ${finishSummary.merged} merged` : ''}
                {finishSummary.replaced > 0 ? `, ${finishSummary.replaced} replaced` : ''}
                {finishSummary.skipped > 0 ? `, ${finishSummary.skipped} skipped` : ''}.
              </p>
              {finishSummary.tracks > 0 ? (
                <p className="mx-auto mt-1 max-w-sm text-xs text-[#8c8d96]">
                  Pulled {finishSummary.tracks} extra track{finishSummary.tracks === 1 ? '' : 's'} from TIDAL to fill gaps.
                </p>
              ) : null}
              {finishSummary.unresolvedPlaylistTracks && finishSummary.unresolvedPlaylistTracks > 0 ? (
                <p className="mx-auto mt-1 max-w-sm text-xs text-[#b25563]">
                  {finishSummary.unresolvedPlaylistTracks} track{finishSummary.unresolvedPlaylistTracks === 1 ? '' : 's'} couldn't be resolved and were dropped from playlists.
                </p>
              ) : null}
            </>
          )}

          <button
            type="button"
            onClick={() => onDone()}
            className="mt-6 inline-flex items-center justify-center rounded-2xl bg-accent px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-accent-dark"
          >
            Return to workspace
          </button>
        </div>
      ) : null}
    </div>
  )
}
