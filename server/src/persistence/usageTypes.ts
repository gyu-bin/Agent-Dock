/**
 * Phase O1 — Usage / Cost / Execution Observability domain types.
 * ExecutionRecord is a cross-provider observability layer; it does not replace
 * AgentRun / CodexRun / WebSearchSession stores.
 */

export type ExecutionProvider =
  | 'openai'
  | 'codex'
  | 'web-search'
  | 'mock'
  | 'human'

export type ExecutionStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'

/** Unified error taxonomy across OpenAI / Codex / Search. */
export type ObservabilityErrorCategory =
  | 'RATE_LIMIT'
  | 'AUTH'
  | 'QUOTA'
  | 'TIMEOUT'
  | 'UPSTREAM'
  | 'INVALID_REQUEST'
  | 'CANCELLED'
  | 'UNKNOWN'

export type ExecutionSourceKind = 'agent-run' | 'codex-run' | 'web-search' | 'manual'

export interface ExecutionRecord {
  id: string
  projectId: string
  taskId: string
  stepId?: string
  agentId?: string
  provider: ExecutionProvider
  model?: string
  operation: string
  status: ExecutionStatus
  startedAt: string
  completedAt?: string
  durationMs?: number
  inputTokens?: number
  outputTokens?: number
  /** USD when price is known; omit when unknown / N/A — never invent. */
  estimatedCost?: number
  /** True when tokens exist but model price is not configured. */
  costUnknown?: boolean
  errorCategory?: ObservabilityErrorCategory
  /** User-facing message (no secrets / CoT). */
  userMessage?: string
  /** Short sanitized technical summary for logs. */
  technicalSummary?: string
  retryCount: number
  metadata: ExecutionMetadata
}

export interface ExecutionMetadata {
  sourceKind: ExecutionSourceKind
  sourceId: string
  artifactIds?: string[]
  /** Opaque extras — never store secrets or chain-of-thought. */
  extra?: Record<string, string | number | boolean | null>
}

export interface ProjectBudget {
  projectId: string
  maxCost?: number
  maxTokens?: number
  /** 0–1 fraction of maxCost/maxTokens at which UI warns (e.g. 0.8). */
  warningThreshold?: number
  updatedAt: string
}

export interface UsageAggregation {
  calls: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  /** Sum of known costs only; null when any relevant cost is unknown. */
  estimatedCost: number | null
  hasUnknownCost: boolean
  averageDurationMs: number
  failures: number
  retries: number
  openaiCalls: number
  codexRuns: number
  webSearches: number
  mockCalls: number
  humanCalls: number
}

export interface UsageStoreSnapshot {
  version: 1
  projectId: string
  executions: ExecutionRecord[]
  budget?: ProjectBudget
}

export interface UsageRepository {
  load(projectId: string): Promise<UsageStoreSnapshot>
  save(snapshot: UsageStoreSnapshot): Promise<void>
  listProjectIds(): Promise<string[]>
  deleteProject(projectId: string): Promise<void>
}

export interface UsageListFilter {
  projectId?: string
  taskId?: string
  agentId?: string
  provider?: ExecutionProvider
  status?: ExecutionStatus
  /** Inclusive YYYY-MM-DD or ISO start */
  dateFrom?: string
  /** Inclusive YYYY-MM-DD or ISO end */
  dateTo?: string
  q?: string
}

export interface UsageSummaryScope {
  /** today = calendar day UTC; project = one project; all = every project */
  scope: 'today' | 'project' | 'all'
  projectId?: string
}
