import { useState, useCallback } from 'react'
import { Upload, CheckCircle, AlertCircle, XCircle, ArrowLeft, FileJson } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import {
  parseSpotifyLibrary,
  parseSpotifyPlaylists,
  matchSpotifyToTidal,
  type SpotifyTrackEntry,
  type SpotifyPlaylist,
  type MatchResult,
  type ImportProgress,
} from '../lib/spotifyImport'
import { isTidalConfigured } from '../lib/tidal'
import { db } from '../db'

type Step = 'upload' | 'parsing' | 'matching' | 'review' | 'done'

export default function ImportPage() {
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>('upload')
  const [spotifyTracks, setSpotifyTracks] = useState<SpotifyTrackEntry[]>([])
  const [spotifyPlaylists, setSpotifyPlaylists] = useState<SpotifyPlaylist[]>([])
  const [matched, setMatched] = useState<MatchResult[]>([])
  const [uncertain, setUncertain] = useState<MatchResult[]>([])
  const [missing, setMissing] = useState<MatchResult[]>([])
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [reviewTab, setReviewTab] = useState<'matched' | 'uncertain' | 'missing'>('matched')
  const [acceptedUncertain, setAcceptedUncertain] = useState<Set<number>>(new Set())

  const handleFileUpload = useCallback(async () => {
    try {
      const handles = await (window as any).showOpenFilePicker({
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

        const tracks = parseSpotifyLibrary(json)
        const playlists = parseSpotifyPlaylists(json)

        allTracks.push(...tracks)
        allPlaylists.push(...playlists)

        // Also extract tracks from playlists
        for (const p of playlists) {
          allTracks.push(...p.tracks)
        }
      }

      // Deduplicate
      const seen = new Set<string>()
      const unique = allTracks.filter(t => {
        const key = `${t.artistName}|||${t.trackName}`.toLowerCase()
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })

      setSpotifyTracks(unique)
      setSpotifyPlaylists(allPlaylists)

      if (!isTidalConfigured()) {
        setMissing(unique.map(t => ({ spotify: t, tidalMatch: null, confidence: 'none' as const })))
        setStep('review')
        return
      }

      setStep('matching')
      const results = await matchSpotifyToTidal(unique, setProgress)
      setMatched(results.matched)
      setUncertain(results.uncertain)
      setMissing(results.missing)
      setStep('review')
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error('Import error:', err)
        alert('Failed to parse files: ' + err.message)
      }
      setStep('upload')
    }
  }, [])

  async function finishImport() {
    // Save matched tracks to library
    const tracksToSave = [
      ...matched.filter(m => m.tidalMatch).map(m => m.tidalMatch!),
      ...uncertain.filter((_, i) => acceptedUncertain.has(i)).map(m => m.tidalMatch!),
    ]

    for (const track of tracksToSave) {
      await db.tracks.put(track)
    }

    // Save playlists
    // TODO: Build playlists from match map

    setStep('done')
  }

  function toggleUncertain(index: number) {
    setAcceptedUncertain(prev => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  return (
    <div className="px-4 pt-6 pb-4">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/settings')} className="p-2 -ml-2 hover:bg-white/10 rounded-full">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-2xl font-bold">Spotify Import</h1>
      </div>

      {/* Upload step */}
      {step === 'upload' && (
        <div className="text-center py-12">
          <FileJson size={48} className="mx-auto text-green-400 mb-4" />
          <h2 className="text-lg font-medium mb-2">Import Your Spotify Data</h2>
          <p className="text-sm text-gray-400 mb-2 max-w-sm mx-auto">
            Upload your Spotify export JSON files (YourLibrary.json, Playlist1.json, etc.)
          </p>
          {!isTidalConfigured() && (
            <p className="text-xs text-yellow-400/70 mb-4">
              Configure Tidal in Settings first for track matching.
              Without it, we'll only parse — no matching.
            </p>
          )}
          <button
            onClick={handleFileUpload}
            className="bg-green-500 hover:bg-green-600 text-white rounded-full px-6 py-3 text-sm font-medium transition-colors inline-flex items-center gap-2"
          >
            <Upload size={18} />
            Select Spotify JSON Files
          </button>
        </div>
      )}

      {/* Parsing step */}
      {step === 'parsing' && (
        <div className="text-center py-16">
          <div className="animate-spin w-8 h-8 border-2 border-accent border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-gray-400">Parsing Spotify data...</p>
        </div>
      )}

      {/* Matching step */}
      {step === 'matching' && progress && (
        <div className="text-center py-12">
          <div className="animate-spin w-8 h-8 border-2 border-accent border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-sm font-medium mb-2">
            Matching tracks on Tidal ({progress.current}/{progress.total})
          </p>
          <p className="text-xs text-gray-500 truncate max-w-sm mx-auto">{progress.message}</p>
          <div className="w-64 mx-auto mt-4 bg-surface-700 rounded-full h-2">
            <div
              className="bg-accent h-full rounded-full transition-all"
              style={{ width: `${(progress.current / progress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Review step */}
      {step === 'review' && (
        <div>
          {/* Summary */}
          <div className="grid grid-cols-3 gap-3 mb-6">
            <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-3 text-center">
              <p className="text-2xl font-bold text-green-400">{matched.length}</p>
              <p className="text-xs text-green-400/70">Matched</p>
            </div>
            <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-3 text-center">
              <p className="text-2xl font-bold text-yellow-400">{uncertain.length}</p>
              <p className="text-xs text-yellow-400/70">Uncertain</p>
            </div>
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3 text-center">
              <p className="text-2xl font-bold text-red-400">{missing.length}</p>
              <p className="text-xs text-red-400/70">Not Found</p>
            </div>
          </div>

          {spotifyPlaylists.length > 0 && (
            <p className="text-xs text-gray-500 mb-4">
              {spotifyPlaylists.length} playlists found with {spotifyTracks.length} unique tracks
            </p>
          )}

          {/* Tabs */}
          <div className="flex gap-1 bg-surface-800 rounded-lg p-1 mb-4">
            {(['matched', 'uncertain', 'missing'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setReviewTab(tab)}
                className={`flex-1 text-xs py-1.5 rounded-md transition-colors capitalize ${
                  reviewTab === tab ? 'bg-surface-600 text-white font-medium' : 'text-gray-400'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* Track list */}
          <div className="space-y-1 max-h-80 overflow-y-auto">
            {reviewTab === 'matched' && matched.map((m, i) => (
              <div key={i} className="flex items-center gap-2 px-3 py-2 bg-surface-800 rounded-lg">
                <CheckCircle size={14} className="text-green-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs truncate">{m.spotify.trackName}</p>
                  <p className="text-xs text-gray-500 truncate">{m.spotify.artistName}</p>
                </div>
                <span className="text-[10px] text-gray-600">→</span>
                <div className="flex-1 min-w-0 text-right">
                  <p className="text-xs text-green-400/80 truncate">{m.tidalMatch?.title}</p>
                  <p className="text-xs text-gray-500 truncate">{m.tidalMatch?.artist}</p>
                </div>
              </div>
            ))}

            {reviewTab === 'uncertain' && uncertain.map((m, i) => (
              <button
                key={i}
                onClick={() => toggleUncertain(i)}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-colors ${
                  acceptedUncertain.has(i) ? 'bg-yellow-500/10 border border-yellow-500/20' : 'bg-surface-800'
                }`}
              >
                <AlertCircle size={14} className="text-yellow-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs truncate">{m.spotify.trackName}</p>
                  <p className="text-xs text-gray-500 truncate">{m.spotify.artistName}</p>
                </div>
                <span className="text-[10px] text-gray-600">→</span>
                <div className="flex-1 min-w-0 text-right">
                  <p className="text-xs text-yellow-400/80 truncate">{m.tidalMatch?.title}</p>
                  <p className="text-xs text-gray-500 truncate">{m.tidalMatch?.artist}</p>
                </div>
                <div className={`w-5 h-5 rounded border flex items-center justify-center flex-shrink-0 ${
                  acceptedUncertain.has(i) ? 'bg-accent border-accent' : 'border-gray-600'
                }`}>
                  {acceptedUncertain.has(i) && <CheckCircle size={12} />}
                </div>
              </button>
            ))}

            {reviewTab === 'missing' && missing.map((m, i) => (
              <div key={i} className="flex items-center gap-2 px-3 py-2 bg-surface-800 rounded-lg">
                <XCircle size={14} className="text-red-400/50 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs truncate text-gray-400">{m.spotify.trackName}</p>
                  <p className="text-xs text-gray-500 truncate">{m.spotify.artistName}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Import button */}
          <button
            onClick={finishImport}
            className="mt-6 w-full bg-accent hover:bg-accent-dark text-white rounded-xl py-3 text-sm font-medium transition-colors"
          >
            Import {matched.length + acceptedUncertain.size} Tracks to Library
          </button>
        </div>
      )}

      {/* Done step */}
      {step === 'done' && (
        <div className="text-center py-16">
          <CheckCircle size={48} className="mx-auto text-green-400 mb-4" />
          <h2 className="text-lg font-medium mb-2">Import Complete!</h2>
          <p className="text-sm text-gray-400 mb-6">
            {matched.length + acceptedUncertain.size} tracks added to your library.
          </p>
          <button
            onClick={() => navigate('/library')}
            className="bg-accent hover:bg-accent-dark text-white rounded-full px-6 py-2.5 text-sm font-medium transition-colors"
          >
            Go to Library
          </button>
        </div>
      )}
    </div>
  )
}
