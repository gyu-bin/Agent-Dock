/**
 * Web Search domain types — Phase W1.
 * Citations may only reference provider-returned sources (never model-invented URLs).
 */

export type SourceQualityTier =
  | 'official'
  | 'reputable'
  | 'specialist'
  | 'community'
  | 'unknown'

export interface WebSource {
  id: string
  title: string
  url: string
  domain: string
  publishedAt?: string
  snippet?: string
  quality?: SourceQualityTier
}

export interface WebSearchResult {
  query: string
  sources: WebSource[]
  searchedAt: string
  /** Provider-side notes (no secrets) */
  providerNote?: string
}

export interface WebSearchRequest {
  query: string
  /** ISO date for freshness context, e.g. 2026-09-22 */
  currentDate?: string
  /** Task id for cache scoping */
  taskId?: string
  maxSources?: number
}

export interface WebSearchProvider {
  readonly id: string
  readonly label: string
  isAvailable(): boolean
  search(request: WebSearchRequest): Promise<WebSearchResult>
}

export interface SearchPlan {
  queries: string[]
  reason: string
  plannedAt: string
}

export interface TaskWebSearchSession {
  id: string
  taskId: string
  stepId?: string
  agentId?: string
  queries: string[]
  results: WebSearchResult[]
  sources: WebSource[]
  searchedAt: string
  status: 'ok' | 'failed'
  error?: string
}

export interface WebSearchContextBlock {
  currentDate: string
  sessions: TaskWebSearchSession[]
  sources: WebSource[]
  /** Formatted DATA-only block for the model */
  dataBlock: string
}
