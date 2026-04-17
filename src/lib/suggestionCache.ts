import { db, type SuggestionCacheEntry, type SuggestionKind } from '../db'

export interface CachedSuggestion<T> {
  id: string
  kind: SuggestionKind
  sourceKey: string
  createdAt: number
  expiresAt: number
  data: T
}

function cacheId(kind: SuggestionKind, sourceKey: string) {
  return `${kind}::${sourceKey}`
}

export async function getCachedSuggestion<T>(
  kind: SuggestionKind,
  sourceKey: string,
): Promise<CachedSuggestion<T> | null> {
  const entry = await db.suggestions.get(cacheId(kind, sourceKey))
  if (!entry) return null
  if (entry.expiresAt <= Date.now()) {
    await db.suggestions.delete(entry.id).catch(() => undefined)
    return null
  }
  try {
    const data = JSON.parse(entry.payload) as T
    return { ...entry, data }
  } catch {
    return null
  }
}

export async function putCachedSuggestion<T>(
  kind: SuggestionKind,
  sourceKey: string,
  data: T,
  ttlMs: number,
): Promise<void> {
  const entry: SuggestionCacheEntry = {
    id: cacheId(kind, sourceKey),
    kind,
    sourceKey,
    createdAt: Date.now(),
    expiresAt: Date.now() + ttlMs,
    payload: JSON.stringify(data),
  }
  await db.suggestions.put(entry)
}

export async function invalidateSuggestion(kind: SuggestionKind, sourceKey: string): Promise<void> {
  await db.suggestions.delete(cacheId(kind, sourceKey)).catch(() => undefined)
}

export async function clearSuggestionCache(kind?: SuggestionKind): Promise<void> {
  if (!kind) {
    await db.suggestions.clear()
    return
  }
  const entries = await db.suggestions.where('kind').equals(kind).toArray()
  await db.suggestions.bulkDelete(entries.map((entry) => entry.id))
}
