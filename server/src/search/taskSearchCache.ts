/** Task-scoped search cache — same query within a task is not re-fetched. */

import type { WebSearchResult } from './types.js'

function cacheKey(taskId: string, query: string): string {
  return `${taskId}::${query.trim().toLowerCase().replace(/\s+/g, ' ')}`
}

const store = new Map<string, WebSearchResult>()

export function getCachedSearch(
  taskId: string | undefined,
  query: string,
): WebSearchResult | null {
  if (!taskId) return null
  return store.get(cacheKey(taskId, query)) ?? null
}

export function setCachedSearch(
  taskId: string | undefined,
  result: WebSearchResult,
): void {
  if (!taskId) return
  store.set(cacheKey(taskId, result.query), result)
}

export function clearTaskSearchCache(taskId: string): void {
  const prefix = `${taskId}::`
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key)
  }
}
