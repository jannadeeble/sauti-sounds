// Camelot Wheel — harmonic mixing key system
// Maps musical keys to Camelot notation (e.g., C major = 8B, A minor = 8A)

export interface CamelotKey {
  number: number  // 1-12
  letter: 'A' | 'B'  // A = minor, B = major
}

// Musical key → Camelot mapping
const KEY_TO_CAMELOT: Record<string, string> = {
  // Minor keys (A = inner wheel)
  'Ab minor': '1A', 'G# minor': '1A',
  'Eb minor': '2A', 'D# minor': '2A',
  'Bb minor': '3A', 'A# minor': '3A',
  'F minor':  '4A',
  'C minor':  '5A',
  'G minor':  '6A',
  'D minor':  '7A',
  'A minor':  '8A',
  'E minor':  '9A',
  'B minor':  '10A',
  'F# minor': '11A', 'Gb minor': '11A',
  'Db minor': '12A', 'C# minor': '12A',

  // Major keys (B = outer wheel)
  'B major':  '1B',  'Cb major': '1B',
  'F# major': '2B',  'Gb major': '2B',
  'Db major': '3B',  'C# major': '3B',
  'Ab major': '4B',  'G# major': '4B',
  'Eb major': '5B',  'D# major': '5B',
  'Bb major': '6B',  'A# major': '6B',
  'F major':  '7B',
  'C major':  '8B',
  'G major':  '9B',
  'D major':  '10B',
  'A major':  '11B',
  'E major':  '12B',
}

const CAMELOT_TO_KEY: Record<string, string> = {}
for (const [key, camelot] of Object.entries(KEY_TO_CAMELOT)) {
  if (!CAMELOT_TO_KEY[camelot]) CAMELOT_TO_KEY[camelot] = key
}

export function parseCamelot(camelotStr: string): CamelotKey | null {
  const match = camelotStr.match(/^(\d{1,2})([AB])$/)
  if (!match) return null
  const num = parseInt(match[1])
  if (num < 1 || num > 12) return null
  return { number: num, letter: match[2] as 'A' | 'B' }
}

export function keyToCamelot(musicalKey: string): string | null {
  return KEY_TO_CAMELOT[musicalKey] || null
}

export function camelotToKey(camelot: string): string | null {
  return CAMELOT_TO_KEY[camelot] || null
}

export function formatCamelot(key: CamelotKey): string {
  return `${key.number}${key.letter}`
}

/**
 * Check if two Camelot keys are harmonically compatible.
 * Compatible transitions:
 * 1. Same key (e.g., 8A → 8A)
 * 2. +1 on the wheel (e.g., 8A → 9A)
 * 3. -1 on the wheel (e.g., 8A → 7A)
 * 4. Inner/outer switch (e.g., 8A → 8B, same number different letter)
 */
export function isCompatible(a: CamelotKey, b: CamelotKey): boolean {
  // Same key
  if (a.number === b.number && a.letter === b.letter) return true

  // Inner/outer wheel switch (same number)
  if (a.number === b.number) return true

  // Same wheel, adjacent numbers (wraps 12→1)
  if (a.letter === b.letter) {
    const diff = Math.abs(a.number - b.number)
    return diff === 1 || diff === 11 // 11 = wrapping (e.g., 12→1)
  }

  return false
}

/**
 * Get compatibility score between two keys (higher = more compatible)
 * 3 = same key, 2 = adjacent on same wheel, 1 = inner/outer switch, 0 = incompatible
 */
export function compatibilityScore(a: CamelotKey, b: CamelotKey): number {
  if (a.number === b.number && a.letter === b.letter) return 3
  if (a.letter === b.letter) {
    const diff = Math.abs(a.number - b.number)
    if (diff === 1 || diff === 11) return 2
  }
  if (a.number === b.number) return 1
  return 0
}

/**
 * Get all compatible Camelot keys for a given key
 */
export function getCompatibleKeys(key: CamelotKey): CamelotKey[] {
  const results: CamelotKey[] = []

  // Same key
  results.push({ ...key })

  // Inner/outer switch
  results.push({ number: key.number, letter: key.letter === 'A' ? 'B' : 'A' })

  // +1 and -1 on same wheel
  const prev = key.number === 1 ? 12 : key.number - 1
  const next = key.number === 12 ? 1 : key.number + 1
  results.push({ number: prev, letter: key.letter })
  results.push({ number: next, letter: key.letter })

  return results
}

// Color coding for Camelot keys (for UI visualization)
const CAMELOT_COLORS: Record<number, string> = {
  1:  '#FF6B6B', // Red
  2:  '#FF8E53', // Orange-red
  3:  '#FFA726', // Orange
  4:  '#FFCA28', // Yellow
  5:  '#C6E548', // Yellow-green
  6:  '#66BB6A', // Green
  7:  '#26A69A', // Teal
  8:  '#42A5F5', // Blue
  9:  '#5C6BC0', // Indigo
  10: '#AB47BC', // Purple
  11: '#EC407A', // Pink
  12: '#EF5350', // Red-pink
}

export function getCamelotColor(key: CamelotKey): string {
  return CAMELOT_COLORS[key.number] || '#888'
}
