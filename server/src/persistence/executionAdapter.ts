import { applyCostToRecord } from './costModel.js'
import {
  classifyFromMessage,
  normalizeErrorCategory,
} from './errorCategories.js'
import type {
  StoredAgentRun,
  StoredCodexRun,
  StoredWebSearchSession,
} from './types.js'
import type {
  ExecutionRecord,
  ExecutionStatus,
} from './usageTypes.js'

/** Stable id so adapter upserts do not duplicate existing runs. */
export function executionIdFor(
  sourceKind: 'agent-run' | 'codex-run' | 'web-search' | 'manual',
  sourceId: string,
): string {
  return `exec_${sourceKind}_${sourceId}`
}

function msBetween(start: string, end?: string): number | undefined {
  if (!end) return undefined
  const a = Date.parse(start)
  const b = Date.parse(end)
  if (Number.isNaN(a) || Number.isNaN(b)) return undefined
  return Math.max(0, b - a)
}

function mapAgentStatus(
  s: StoredAgentRun['status'],
): ExecutionStatus {
  if (s === 'running') return 'running'
  if (s === 'failed') return 'failed'
  return 'completed'
}

function mapCodexStatus(
  s: StoredCodexRun['status'],
): ExecutionStatus {
  if (s === 'queued') return 'queued'
  if (s === 'running') return 'running'
  if (s === 'failed') return 'failed'
  if (s === 'cancelled') return 'cancelled'
  return 'completed'
}

/**
 * Adapt existing AgentRun → ExecutionRecord (observability layer).
 * Does not mutate the original AgentRun store.
 */
export function fromAgentRun(
  projectId: string,
  run: StoredAgentRun,
  opts?: { provider?: 'openai' | 'mock'; operation?: string },
): ExecutionRecord {
  const provider = opts?.provider ?? (run.model === 'mock' ? 'mock' : 'openai')
  const cost = applyCostToRecord({
    provider,
    model: run.model,
    inputTokens: run.inputTokens,
    outputTokens: run.outputTokens,
  })
  return {
    id: executionIdFor('agent-run', run.id),
    projectId,
    taskId: run.taskId,
    stepId: run.stepId,
    agentId: run.agentId,
    provider,
    model: run.model,
    operation: opts?.operation ?? 'agent.step',
    status: mapAgentStatus(run.status),
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    durationMs: msBetween(run.startedAt, run.completedAt),
    inputTokens: run.inputTokens,
    outputTokens: run.outputTokens,
    ...cost,
    errorCategory: run.error
      ? classifyFromMessage(run.error)
      : undefined,
    userMessage: run.error,
    technicalSummary: run.error,
    retryCount: 0,
    metadata: {
      sourceKind: 'agent-run',
      sourceId: run.id,
      extra: {
        inputSummaryLen: run.inputSummary?.length ?? 0,
        outputLen: run.output?.length ?? 0,
      },
    },
  }
}

/**
 * Adapt CodexRun → ExecutionRecord.
 */
export function fromCodexRun(
  projectId: string,
  run: StoredCodexRun,
): ExecutionRecord {
  return {
    id: executionIdFor('codex-run', run.id),
    projectId,
    taskId: run.taskId,
    stepId: run.stepId,
    agentId: run.agentId,
    provider: 'codex',
    model: undefined,
    operation: `codex.${run.mode}`,
    status: mapCodexStatus(run.status),
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    durationMs: run.durationMs ?? msBetween(run.startedAt, run.completedAt),
    ...applyCostToRecord({ provider: 'codex' }),
    errorCategory: normalizeErrorCategory(run.errorCategory),
    userMessage: run.userMessageKo ?? run.error,
    technicalSummary: run.stderrSummary ?? run.error,
    retryCount: run.retries ?? Math.max(0, (run.attempt ?? 1) - 1),
    metadata: {
      sourceKind: 'codex-run',
      sourceId: run.id,
      extra: {
        mode: run.mode,
        exitCode: run.exitCode ?? null,
        timedOut: run.timedOut ?? false,
        cancelled: run.cancelled ?? false,
        attempt: run.attempt ?? 1,
      },
    },
  }
}

/**
 * Adapt WebSearchSession → ExecutionRecord.
 */
export function fromWebSearchSession(
  projectId: string,
  session: StoredWebSearchSession,
): ExecutionRecord {
  const failed = session.status === 'failed'
  return {
    id: executionIdFor('web-search', session.id),
    projectId,
    taskId: session.taskId,
    stepId: session.stepId,
    agentId: session.agentId,
    provider: 'web-search',
    model: undefined,
    operation: 'web.search',
    status: failed ? 'failed' : 'completed',
    startedAt: session.searchedAt,
    completedAt: session.searchedAt,
    durationMs: undefined,
    ...applyCostToRecord({ provider: 'web-search' }),
    errorCategory: failed
      ? classifyFromMessage(session.error)
      : undefined,
    userMessage: session.error,
    technicalSummary: session.error,
    retryCount: 0,
    metadata: {
      sourceKind: 'web-search',
      sourceId: session.id,
      extra: {
        queryCount: session.queries?.length ?? 0,
        sourceCount: session.sources?.length ?? 0,
      },
    },
  }
}

export function adaptProjectSources(input: {
  projectId: string
  agentRuns: StoredAgentRun[]
  codexRuns: StoredCodexRun[]
  searchSessions: StoredWebSearchSession[]
}): ExecutionRecord[] {
  const out: ExecutionRecord[] = []
  for (const r of input.agentRuns) {
    out.push(fromAgentRun(input.projectId, r))
  }
  for (const r of input.codexRuns) {
    out.push(fromCodexRun(input.projectId, r))
  }
  for (const s of input.searchSessions) {
    out.push(fromWebSearchSession(input.projectId, s))
  }
  return out
}
