import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft, Play, Pause, Loader2,
  Disc3, Zap, Music2, RefreshCw, ChevronDown, ChevronUp,
} from 'lucide-react'
import { useLibraryStore } from '../stores/libraryStore'
import { usePlayerStore } from '../stores/playerStore'
import { db } from '../db'
import { analyzePlaylist, type AudioAnalysis } from '../lib/audioAnalysis'
import { buildDJSet, enhanceSetWithLLM, type DJSet } from '../lib/djEngine'
import { formatCamelot, getCamelotColor } from '../lib/camelot'
import Waveform from '../components/Waveform'
import EnergyArc from '../components/EnergyArc'
import { formatTime } from '../lib/metadata'

type Phase = 'select' | 'analyzing' | 'building' | 'ready' | 'playing'

export default function DJModePage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const tracks = useLibraryStore(s => s.tracks)
  const { setQueue, currentTrack, isPlaying, togglePlay } = usePlayerStore()

  const [phase, setPhase] = useState<Phase>('select')
  const [selectedTrackIds, setSelectedTrackIds] = useState<Set<string>>(new Set())
  const [analysisMap, setAnalysisMap] = useState<Map<string, AudioAnalysis>>(new Map())
  const [djSet, setDjSet] = useState<DJSet | null>(null)
  const [setDescription, setSetDescription] = useState('')
  const [analyzeProgress, setAnalyzeProgress] = useState({ current: 0, total: 0 })
  const [expandedTrack, setExpandedTrack] = useState<number | null>(null)
  const [currentDJIndex, setCurrentDJIndex] = useState(0)

  const [devImporting, setDevImporting] = useState(false)
  const loadTracks = useLibraryStore(s => s.loadTracks)

  const devImportTestAudio = async () => {
    setDevImporting(true)
    try {
      const testFiles = [
        'Dandara,Anissa Damali,III - Quiero (Radio Edit).mp3',
        'Dibidabo - San Paulo.mp3',
        'Fakear - Red Lines.mp3',
      ]
      for (const filename of testFiles) {
        const resp = await fetch(`/test-audio/${encodeURIComponent(filename)}`)
        if (!resp.ok) { console.error(`Failed to fetch ${filename}: ${resp.status}`); continue }
        const blob = await resp.blob()
        const file = new File([blob], filename, { type: 'audio/mpeg' })
        // Parse metadata
        const mm = await import('music-metadata-browser')
        const metadata = await mm.parseBlob(file)
        const { common, format } = metadata
        let artworkUrl: string | undefined
        if (common.picture && common.picture.length > 0) {
          const pic = common.picture[0]
          const artBlob = new Blob([new Uint8Array(pic.data)], { type: pic.format })
          artworkUrl = URL.createObjectURL(artBlob)
        }
        const track = {
          id: `local-${file.name}-${file.size}-${file.lastModified}`,
          title: common.title || file.name.replace(/\.[^/.]+$/, ''),
          artist: common.artist || 'Unknown Artist',
          album: common.album || 'Unknown Album',
          duration: format.duration || 0,
          source: 'local' as const,
          audioBlob: file,
          artworkUrl,
          genre: common.genre?.[0],
          year: common.year,
          trackNumber: common.track?.no ?? undefined,
        }
        await db.tracks.put(track)
        console.log(`Imported: ${track.title} by ${track.artist}`)
      }
      await loadTracks()
    } catch (err) {
      console.error('Dev import failed:', err)
    } finally {
      setDevImporting(false)
    }
  }

  // Load tracks from IndexedDB on mount
  useEffect(() => { loadTracks() }, [loadTracks])

  // Auto-select all tracks if coming from a playlist or "all tracks"
  // Also auto-start analysis if autostart param is present
  const [autoStarted, setAutoStarted] = useState(false)
  useEffect(() => {
    const mode = searchParams.get('mode')
    if (mode === 'all' && tracks.length > 0) {
      const localIds = new Set(tracks.filter(t => t.source === 'local').map(t => t.id))
      setSelectedTrackIds(localIds)
      // Auto-start analysis if autostart is set
      if (searchParams.get('autostart') === '1' && !autoStarted && localIds.size >= 2) {
        setAutoStarted(true)
        setTimeout(() => {
          // Trigger analysis
          document.getElementById('dj-analyze-btn')?.click()
        }, 500)
      }
    }
  }, [searchParams, tracks, autoStarted])

  const toggleTrack = (id: string) => {
    setSelectedTrackIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectAll = () => {
    const localTracks = tracks.filter(t => t.source === 'local')
    setSelectedTrackIds(new Set(localTracks.map(t => t.id)))
  }

  const startAnalysis = useCallback(async () => {
    const selected = tracks.filter(t => selectedTrackIds.has(t.id))
    if (selected.length < 2) {
      alert('Select at least 2 tracks for DJ Mode')
      return
    }

    setPhase('analyzing')
    const results = await analyzePlaylist(selected, (current, total) => {
      setAnalyzeProgress({ current, total })
    })
    setAnalysisMap(results)

    setPhase('building')
    const set = buildDJSet(selected, results)
    if (!set) {
      alert('Could not build a DJ set. Make sure tracks have valid audio data.')
      setPhase('select')
      return
    }

    setDjSet(set)

    // Get LLM description in background
    enhanceSetWithLLM(set).then(desc => setSetDescription(desc))

    setPhase('ready')
  }, [tracks, selectedTrackIds])

  const playSet = () => {
    if (!djSet) return
    const setTracks = djSet.tracks.map(t => t.track)
    setQueue(setTracks, 0)
    setCurrentDJIndex(0)
    setPhase('playing')
  }

  const regenerateSet = async () => {
    if (!djSet) return
    setPhase('building')
    const selected = tracks.filter(t => selectedTrackIds.has(t.id))
    // Shuffle the input to get a different result
    const shuffled = [...selected].sort(() => Math.random() - 0.5)
    const newSet = buildDJSet(shuffled, analysisMap)
    if (newSet) {
      setDjSet(newSet)
      enhanceSetWithLLM(newSet).then(desc => setSetDescription(desc))
    }
    setPhase('ready')
  }

  // Track the current playing track in the DJ set
  useEffect(() => {
    if (phase === 'playing' && currentTrack && djSet) {
      const idx = djSet.tracks.findIndex(t => t.track.id === currentTrack.id)
      if (idx >= 0) setCurrentDJIndex(idx)
    }
  }, [currentTrack, djSet, phase])

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5">
        <button onClick={() => navigate(-1)} className="p-2 -ml-2 hover:bg-white/10 rounded-full">
          <ArrowLeft size={20} />
        </button>
        <div className="flex items-center gap-2">
          <Disc3 size={20} className="text-accent" />
          <h1 className="text-lg font-bold">DJ Mode</h1>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">

        {/* ── SELECT PHASE ── */}
        {phase === 'select' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-medium">Select Tracks</h2>
                <p className="text-xs text-gray-500">
                  {selectedTrackIds.size} selected (min 2)
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={selectAll}
                  className="text-xs text-accent hover:text-accent-light px-3 py-1.5 rounded-lg bg-accent/10"
                >
                  Select All Local
                </button>
              </div>
            </div>

            <div className="space-y-1 mb-6">
              {tracks.filter(t => t.source === 'local').map(track => (
                <button
                  key={track.id}
                  onClick={() => toggleTrack(track.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                    selectedTrackIds.has(track.id) ? 'bg-accent/10 border border-accent/20' : 'bg-surface-800 hover:bg-surface-700'
                  }`}
                >
                  <div className={`w-5 h-5 rounded border flex items-center justify-center flex-shrink-0 ${
                    selectedTrackIds.has(track.id) ? 'bg-accent border-accent' : 'border-gray-600'
                  }`}>
                    {selectedTrackIds.has(track.id) && (
                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                  <div className="w-8 h-8 rounded bg-surface-600 overflow-hidden flex-shrink-0">
                    {track.artworkUrl ? (
                      <img src={track.artworkUrl} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-600 text-xs">♪</div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{track.title}</p>
                    <p className="text-xs text-gray-500 truncate">{track.artist}</p>
                  </div>
                  <span className="text-xs text-gray-600">{formatTime(track.duration)}</span>
                </button>
              ))}
            </div>

            {tracks.filter(t => t.source === 'local').length === 0 && (
              <div className="text-center py-12 text-gray-500">
                <Disc3 size={40} className="mx-auto mb-3 opacity-30" />
                <p className="text-sm">Import local music files first</p>
                <p className="text-xs text-gray-600 mt-1">DJ Mode analyzes audio from local files</p>
                <button
                  onClick={devImportTestAudio}
                  disabled={devImporting}
                  className="mt-4 px-4 py-2 bg-accent/20 text-accent rounded-lg text-xs hover:bg-accent/30"
                >
                  {devImporting ? 'Importing test audio...' : 'Load Test Audio (Dev)'}
                </button>
              </div>
            )}

            <button
              id="dj-analyze-btn"
              onClick={startAnalysis}
              disabled={selectedTrackIds.size < 2}
              className="w-full bg-accent hover:bg-accent-dark disabled:opacity-30 text-white rounded-xl py-3 text-sm font-medium transition-colors mt-2"
            >
              Analyze & Build Set ({selectedTrackIds.size} tracks)
            </button>
          </div>
        )}

        {/* ── ANALYZING PHASE ── */}
        {phase === 'analyzing' && (
          <div className="text-center py-16">
            <Loader2 size={36} className="mx-auto animate-spin text-accent mb-4" />
            <h2 className="text-lg font-medium mb-2">Analyzing Audio</h2>
            <p className="text-sm text-gray-400 mb-4">
              Detecting BPM, key, energy, sections, and beat grid...
            </p>
            <p className="text-xs text-gray-500">
              Track {analyzeProgress.current} of {analyzeProgress.total}
            </p>
            <div className="w-64 mx-auto mt-3 bg-surface-700 rounded-full h-2">
              <div
                className="bg-accent h-full rounded-full transition-all"
                style={{ width: `${analyzeProgress.total > 0 ? (analyzeProgress.current / analyzeProgress.total) * 100 : 0}%` }}
              />
            </div>
          </div>
        )}

        {/* ── BUILDING PHASE ── */}
        {phase === 'building' && (
          <div className="text-center py-16">
            <Disc3 size={36} className="mx-auto animate-spin text-accent mb-4" />
            <h2 className="text-lg font-medium mb-2">Building Your Set</h2>
            <p className="text-sm text-gray-400">
              Finding optimal key progression, BPM flow, and energy arc...
            </p>
          </div>
        )}

        {/* ── READY / PLAYING PHASE ── */}
        {(phase === 'ready' || phase === 'playing') && djSet && (
          <div>
            {/* Set Summary */}
            <div className="bg-surface-800 rounded-xl p-4 mb-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="text-sm font-medium">Your DJ Set</h2>
                  <p className="text-xs text-gray-500">
                    {djSet.tracks.length} tracks · {formatTime(djSet.totalDuration)}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={regenerateSet}
                    className="p-2 hover:bg-white/10 rounded-full text-gray-400"
                    title="Regenerate set"
                  >
                    <RefreshCw size={16} />
                  </button>
                </div>
              </div>

              {setDescription && (
                <p className="text-xs text-gray-400 italic mb-3">{setDescription}</p>
              )}

              {/* Energy Arc */}
              <div className="mb-2">
                <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Energy Flow</p>
                <EnergyArc
                  values={djSet.energyArc}
                  currentIndex={phase === 'playing' ? currentDJIndex : -1}
                  height={60}
                />
              </div>

              {/* Set Stats */}
              <div className="grid grid-cols-3 gap-2 mt-3">
                <div className="bg-surface-700 rounded-lg p-2 text-center">
                  <p className="text-sm font-bold text-accent">
                    {Math.round(djSet.tracks.reduce((s, t) => s + t.analysis.bpm, 0) / djSet.tracks.length)}
                  </p>
                  <p className="text-[10px] text-gray-500">Avg BPM</p>
                </div>
                <div className="bg-surface-700 rounded-lg p-2 text-center">
                  <p className="text-sm font-bold text-accent">
                    {Math.round(djSet.energyArc.reduce((s, e) => s + e, 0) / djSet.energyArc.length * 100)}%
                  </p>
                  <p className="text-[10px] text-gray-500">Avg Energy</p>
                </div>
                <div className="bg-surface-700 rounded-lg p-2 text-center">
                  <p className="text-sm font-bold text-accent">{djSet.transitions.length}</p>
                  <p className="text-[10px] text-gray-500">Transitions</p>
                </div>
              </div>
            </div>

            {/* Play button */}
            {phase === 'ready' && (
              <button
                onClick={playSet}
                className="w-full bg-accent hover:bg-accent-dark text-white rounded-xl py-3 text-sm font-medium transition-colors flex items-center justify-center gap-2 mb-4"
              >
                <Play size={18} fill="white" />
                Play Set
              </button>
            )}

            {phase === 'playing' && (
              <button
                onClick={togglePlay}
                className="w-full bg-surface-700 hover:bg-surface-600 text-white rounded-xl py-3 text-sm font-medium transition-colors flex items-center justify-center gap-2 mb-4"
              >
                {isPlaying ? <Pause size={18} /> : <Play size={18} fill="white" />}
                {isPlaying ? 'Pause' : 'Resume'}
              </button>
            )}

            {/* Track List with Transitions */}
            <div className="space-y-1">
              {djSet.tracks.map((djTrack, i) => {
                const transition = djSet.transitions[i]
                const isActive = phase === 'playing' && currentDJIndex === i
                const isExpanded = expandedTrack === i

                return (
                  <div key={djTrack.track.id}>
                    {/* Track card */}
                    <button
                      onClick={() => setExpandedTrack(isExpanded ? null : i)}
                      className={`w-full text-left rounded-xl p-3 transition-colors ${
                        isActive ? 'bg-accent/10 border border-accent/20' : 'bg-surface-800 hover:bg-surface-700'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        {/* Index */}
                        <span className="text-xs text-gray-500 w-5 text-center">{i + 1}</span>

                        {/* Artwork */}
                        <div className="w-10 h-10 rounded bg-surface-600 overflow-hidden flex-shrink-0">
                          {djTrack.track.artworkUrl ? (
                            <img src={djTrack.track.artworkUrl} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-gray-600">♪</div>
                          )}
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium truncate ${isActive ? 'text-accent' : ''}`}>
                            {djTrack.track.title}
                          </p>
                          <p className="text-xs text-gray-500 truncate">{djTrack.track.artist}</p>
                        </div>

                        {/* Key + BPM badges */}
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <span
                            className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                            style={{
                              backgroundColor: getCamelotColor(djTrack.camelotKey) + '20',
                              color: getCamelotColor(djTrack.camelotKey),
                            }}
                          >
                            {formatCamelot(djTrack.camelotKey)}
                          </span>
                          <span className="text-[10px] font-mono text-gray-500 bg-surface-600 px-1.5 py-0.5 rounded">
                            {Math.round(djTrack.analysis.bpm)}
                          </span>
                          <Zap
                            size={12}
                            className="text-accent"
                            style={{ opacity: djTrack.analysis.energy }}
                          />
                        </div>

                        {/* Expand arrow */}
                        {isExpanded ? <ChevronUp size={14} className="text-gray-500" /> : <ChevronDown size={14} className="text-gray-500" />}
                      </div>

                      {/* Expanded: Waveform + details */}
                      {isExpanded && (
                        <div className="mt-3 pt-3 border-t border-white/5" onClick={e => e.stopPropagation()}>
                          <Waveform
                            data={djTrack.analysis.waveformData}
                            progress={isActive ? 0.3 : 0} // TODO: real progress
                            height={50}
                            mixOutPoint={transition ? transition.mixOutTime / djTrack.track.duration : undefined}
                            beats={djTrack.analysis.beatGrid?.beats}
                            downbeats={djTrack.analysis.beatGrid?.downbeats}
                            duration={djTrack.track.duration}
                          />
                          <div className="flex justify-between mt-2 text-[10px] text-gray-500">
                            <span>BPM: {djTrack.analysis.bpm.toFixed(1)}</span>
                            <span>Key: {formatCamelot(djTrack.camelotKey)}</span>
                            <span>Energy: {(djTrack.analysis.energy * 100).toFixed(0)}%</span>
                            {djTrack.analysis.beatGrid && (
                              <span>Beats: {djTrack.analysis.beatGrid.beats.length} ({djTrack.analysis.beatGrid.beatsPerBar}/4)</span>
                            )}
                            <span>{formatTime(djTrack.track.duration)}</span>
                          </div>
                          {/* Sections */}
                          <div className="flex gap-0.5 mt-2 h-3 rounded overflow-hidden">
                            {djTrack.analysis.sections.map((section, si) => {
                              const width = ((section.endTime - section.startTime) / djTrack.track.duration) * 100
                              const sectionColors: Record<string, string> = {
                                intro: '#3b82f6',
                                verse: '#6366f1',
                                chorus: '#e8853d',
                                breakdown: '#8b5cf6',
                                drop: '#ef4444',
                                outro: '#3b82f6',
                                unknown: '#33334a',
                              }
                              return (
                                <div
                                  key={si}
                                  className="h-full rounded-sm relative group"
                                  style={{
                                    width: `${width}%`,
                                    backgroundColor: sectionColors[section.type] || '#33334a',
                                    opacity: 0.5 + section.energy * 0.5,
                                  }}
                                  title={`${section.type} (${formatTime(section.startTime)} - ${formatTime(section.endTime)})`}
                                />
                              )
                            })}
                          </div>
                          <div className="flex gap-3 mt-1.5 flex-wrap">
                            {djTrack.analysis.sections.map((s, si) => (
                              <span key={si} className="text-[9px] text-gray-600">{s.type}</span>
                            ))}
                          </div>
                        </div>
                      )}
                    </button>

                    {/* Transition indicator */}
                    {transition && (
                      <div className="flex items-center gap-2 px-6 py-1.5">
                        <div className="flex-1 border-t border-dashed border-surface-500" />
                        <span className="text-[10px] text-gray-500 flex items-center gap-1">
                          <Music2 size={10} />
                          {transition.technique.replace('-', ' ')} · {transition.transitionBars} bars
                          {transition.bpmAdjustment !== 0 && (
                            <span className="text-yellow-400/60">
                              {transition.bpmAdjustment > 0 ? '+' : ''}{transition.bpmAdjustment}%
                            </span>
                          )}
                        </span>
                        <div className="flex-1 border-t border-dashed border-surface-500" />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
