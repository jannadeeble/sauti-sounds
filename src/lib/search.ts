export function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length

  const prev = new Array(b.length + 1)
  const curr = new Array(b.length + 1)
  for (let j = 0; j <= b.length; j++) prev[j] = j

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j]
  }
  return prev[b.length]
}

export function levenshteinRatio(a: string, b: string): number {
  if (!a && !b) return 1
  const max = Math.max(a.length, b.length)
  if (!max) return 1
  return 1 - levenshtein(a, b) / max
}

/**
 * Token-set similarity: 2 * |A ∩ B| / (|A| + |B|).
 * Order-insensitive — useful for artist names where featuring credits or
 * collective members may appear in any order.
 */
export function tokenSetSimilarity(a: string, b: string): number {
  const setA = new Set(tokenize(a))
  const setB = new Set(tokenize(b))
  if (!setA.size && !setB.size) return 1
  let inter = 0
  for (const t of setA) if (setB.has(t)) inter++
  return (2 * inter) / (setA.size + setB.size)
}

const QUALIFIERS_RE = /\b(live|karaoke|cover|remix|edit|version|remaster(?:ed)?|acoustic|instrumental)\b/i

export function hasLiveRemixCoverQualifier(value: string): boolean {
  return QUALIFIERS_RE.test(value)
}
