import { useCallback, useRef, useState } from 'react'
import { AlertCircle, CheckCircle, FileJson, FolderOpen, Music, Upload, XCircle } from 'lucide-react'
import {
  buildPlaylistsFromMatches,
  matchSpotifyToTidal,
  parseSpotifyLibrary,
  parseSpotifyPlaylists,
  type ImportProgress,
  type MatchResult,
  type SpotifyPlaylist,
  type SpotifyTrackEntry,
} from '../lib/spotifyImport'
import { db } from '../db'
import { useLibraryStore } from '../stores/libraryStore'
import { usePlaylistStore } from '../stores/playlistStore'
import { useTidalStore } from '../stores/tidalStore'
import type { Track } from '../types'

type Step = 'upload' | 'parsing' | 'matching' | 'review' | 'done'

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
  const tidalConnected = useTidalStore((state) => state.tidalConnected)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [step, setStep] = useState<Step>('upload')
  const [spotifyTracks, setSpotifyTracks] = useState<SpotifyTrackEntry[]>([])
  const [spotifyPlaylists, setSpotifyPlaylists] = useState<SpotifyPlaylist[]>([])
  const [matched, setMatched] = useState<MatchResult[]>([])
  const [uncertain, setUncertain] = useState<MatchResult[]>([])
  const [missing, setMissing] = useState<MatchResult[]>([])
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [reviewTab, setReviewTab] = useState<'matched' | 'uncertain' | 'missing'>('matched')
  const [acceptedUncertain, setAcceptedUncertain] = useState<Set<number>>(new Set())

  const handleLocalImport = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget
    const files = input.files
    if (!files || files.length === 0) return

    const importedTracks = await importFilesViaInput(files)
    input.value = ''
    onDone({ importedTracks })
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
      
      onDone({ importedTracks: result.tracks })
    } catch (error) {
      if (!(error instanceof DOMException) || error.name !== 'AbortError') {
        const message = error instanceof Error ? error.message : 'Failed to import folder.'
        alert(message)
      }
    }
  }, [importFolder, onDone])

  const handleSpotifyUpload = useCallback(async () => {
    try {
      const pickerWindow = window as unknown as Window & {
        showOpenFilePicker: (options: object) => Promise<FileSystemFileHandle[]>
      }

      const handles = await pickerWindow.showOpenFilePicker({
        multiple: true,
        types: [{ description: 'JSON files', accept: { 'application/json': ['.json'] } }],
      })

      setStep('parsing')

      const allTracks: SpotifyTrackEntry[] = []
      const allPlaylists: SpotifyPlaylist[] = []

      for (const handle of handles) {
        const file = await handle.getFile()
        const text = await file.text()
        const json = JSON.parse(text)

        allTracks.push(...parseSpotifyLibrary(json))

        const playlists = parseSpotifyPlaylists(json)
        allPlaylists.push(...playlists)
        for (const playlist of playlists) {
          allTracks.push(...playlist.tracks)
        }
      }

      const seen = new Set<string>()
      const uniqueTracks = allTracks.filter((track) => {
        const key = `${track.artistName}|||${track.trackName}`.toLowerCase()
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })

      setSpotifyTracks(uniqueTracks)
      setSpotifyPlaylists(allPlaylists)

      if (!tidalConnected) {
        setMatched([])
        setUncertain([])
        setMissing(uniqueTracks.map((track) => ({ spotify: track, tidalMatch: null, confidence: 'none' as const })))
        setStep('review')
        return
      }

      setStep('matching')
      const results = await matchSpotifyToTidal(uniqueTracks, setProgress)
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
  }, [tidalConnected])

  async function finishImport() {
    const tracksToSave = [
      ...matched.filter((result) => result.tidalMatch).map((result) => result.tidalMatch!),
      ...uncertain
        .filter((_, index) => acceptedUncertain.has(index))
        .map((result) => result.tidalMatch!)
        .filter(Boolean),
    ]

    for (const track of tracksToSave) {
      await db.tracks.put({
        ...track,
        addedAt: track.addedAt || Date.now(),
      })
    }

    const matchMap = new Map<string, typeof tracksToSave[number]>()

    for (const result of matched) {
      if (result.tidalMatch) {
        matchMap.set(`${result.spotify.artistName}|||${result.spotify.trackName}`.toLowerCase(), result.tidalMatch)
      }
    }

    uncertain.forEach((result, index) => {
      if (acceptedUncertain.has(index) && result.tidalMatch) {
        matchMap.set(`${result.spotify.artistName}|||${result.spotify.trackName}`.toLowerCase(), result.tidalMatch)
      }
    })

    const playlistsToSave = buildPlaylistsFromMatches(spotifyPlaylists, matchMap)
    if (playlistsToSave.length > 0) {
      await db.playlists.bulkPut(playlistsToSave)
    }

    setStep('done')
  }

  function toggleUncertain(index: number) {
    setAcceptedUncertain((current) => {
      const next = new Set(current)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  const cardClass = 'rounded-[24px] border border-black/8 bg-white p-5'
  const iconChipClass = 'flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#f3f3f6]'
  const primaryBtnClass =
    'inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-accent px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-accent-dark disabled:opacity-50'
  const secondaryBtnClass =
    'inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm font-medium text-[#111116] transition-colors hover:bg-[#fafafb] disabled:opacity-50'

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
              <div className="mt-4 rounded-2xl border border-black/8 bg-[#f8f8f9] p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-[#111116]">Uploading to your library</p>
                  <span className="shrink-0 rounded-full bg-white px-3 py-1 text-xs font-semibold text-[#111116] shadow-[0_0_0_1px_rgba(17,17,22,0.06)]">
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
                <p className="text-sm text-[#7a7b86]">Rebuild playlists from your export</p>
              </div>
            </header>

            <p className="mb-4 text-sm text-[#7a7b86]">
              Upload the JSON files from your Spotify data export.
              {tidalConnected
                ? ' Sauti will try to match each track on TIDAL.'
                : ' Connect TIDAL in Settings first to auto-match tracks; otherwise Sauti will only parse the export.'}
            </p>

            <button
              type="button"
              onClick={() => void handleSpotifyUpload()}
              className={primaryBtnClass}
            >
              <Upload size={16} />
              Choose Spotify JSON files
            </button>
          </section>
        </div>
      ) : null}

      {step === 'parsing' ? (
        <div className="py-16 text-center text-[#7a7b86]">Parsing Spotify export...</div>
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
            {spotifyPlaylists.length} playlists found with {spotifyTracks.length} unique tracks
          </p>

          <div className="mb-4 flex gap-1 rounded-full border border-black/8 bg-[#f8f8f9] p-1">
            {(['matched', 'uncertain', 'missing'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setReviewTab(tab)}
                className={`flex-1 rounded-full px-3 py-2 text-xs font-medium capitalize transition-colors ${
                  reviewTab === tab ? 'bg-[#ef5466] text-white' : 'text-[#7a7b86] hover:bg-white'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          <div className="max-h-[42vh] space-y-2 overflow-y-auto">
            {reviewTab === 'matched'
              ? matched.map((result, index) => (
                  <div key={`${result.spotify.trackName}-${index}`} className="flex items-center gap-3 rounded-2xl border border-black/6 bg-white px-4 py-3">
                    <CheckCircle size={16} className="text-green-400" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-[#111116]">{result.spotify.trackName}</p>
                      <p className="truncate text-xs text-[#7a7b86]">{result.spotify.artistName}</p>
                    </div>
                    <div className="min-w-0 flex-1 text-right">
                      <p className="truncate text-sm text-green-700">{result.tidalMatch?.title}</p>
                      <p className="truncate text-xs text-[#7a7b86]">{result.tidalMatch?.artist}</p>
                    </div>
                  </div>
                ))
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

          <button
            type="button"
            onClick={() => void finishImport()}
            className="mt-6 inline-flex w-full items-center justify-center rounded-2xl bg-accent px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-accent-dark"
          >
            Add {matched.length + acceptedUncertain.size} matched tracks
          </button>
        </div>
      ) : null}

      {step === 'done' ? (
        <div className="py-12 text-center">
          <CheckCircle size={48} className="mx-auto mb-4 text-green-400" />
          <h3 className="text-lg font-semibold">Upload complete</h3>
          <p className="mx-auto mt-2 max-w-sm text-sm text-[#7a7b86]">
            {matched.length + acceptedUncertain.size} tracks were added and {spotifyPlaylists.length} playlists were rebuilt.
          </p>
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
