import { applyCostToRecord } from './costModel.js'
import { adaptProjectSources, executionIdFor } from './executionAdapter.js'
import {
  aggregateExecutions,
  filterExecutions,
  groupByDimensions,
  todayUtcRange,
} from './usageAggregation.js'
import type {
  StoredAgentRun,
  StoredCodexRun,
  StoredTask,
  StoredWebSearchSession,
} from './types.js'
import type {
  ExecutionRecord,
  ExecutionProvider,
  ExecutionStatus,
  ProjectBudget,
  UsageAggregation,
  UsageListFilter,
  UsageRepository,
  UsageSummaryScope,
} from './usageTypes.js'

export interface ProjectUsageSources {
  agentRuns: StoredAgentRun[]
  codexRuns: StoredCodexRun[]
  tasks: StoredTask[]
}

function collectSearchSessions(
  tasks: StoredTask[],
): StoredWebSearchSession[] {
  const out: StoredWebSearchSession[] = []
  for (const t of tasks) {
    if (t.webSearchSessions?.length) out.push(...t.webSearchSessions)
  }
  return out
}

function upsertMany(
  existing: ExecutionRecord[],
  incoming: ExecutionRecord[],
): ExecutionRecord[] {
  const map = new Map(existing.map((e) => [e.id, e]))
  for (const rec of incoming) {
    map.set(rec.id, rec)
  }
  return [...map.values()].sort((a, b) =>
    b.startedAt.localeCompare(a.startedAt),
  )
}

export class UsageService {
  constructor(private readonly repo: UsageRepository) {}

  async get(projectId: string, id: string): Promise<ExecutionRecord | null> {
    const snap = await this.repo.load(projectId)
    return snap.executions.find((e) => e.id === id) ?? null
  }

  async list(filter: UsageListFilter = {}): Promise<ExecutionRecord[]> {
    const projectIds = filter.projectId
      ? [filter.projectId]
      : await this.repo.listProjectIds()
    const all: ExecutionRecord[] = []
    for (const pid of projectIds) {
      const snap = await this.repo.load(pid)
      all.push(...snap.executions)
    }
    return filterExecutions(all, filter).sort((a, b) =>
      b.startedAt.localeCompare(a.startedAt),
    )
  }

  async upsert(record: ExecutionRecord): Promise<ExecutionRecord> {
    const snap = await this.repo.load(record.projectId)
    const next = upsertMany(snap.executions, [record])
    await this.repo.save({ ...snap, executions: next })
    return record
  }

  async upsertMany(
    projectId: string,
    records: ExecutionRecord[],
  ): Promise<number> {
    if (records.length === 0) return 0
    const snap = await this.repo.load(projectId)
    const next = upsertMany(snap.executions, records)
    await this.repo.save({ ...snap, executions: next })
    return records.length
  }

  /**
   * Sync observability layer from existing AgentRun / CodexRun / SearchSession.
   * Idempotent upsert by stable exec_* ids — does not remove original stores.
   */
  async syncFromSources(
    projectId: string,
    sources: ProjectUsageSources,
  ): Promise<{ upserted: number; total: number }> {
    const taskIds = new Set(
      sources.tasks.filter((t) => t.projectId === projectId).map((t) => t.id),
    )
    const agentRuns = sources.agentRuns.filter((r) => taskIds.has(r.taskId))
    const codexRuns = sources.codexRuns.filter((r) => taskIds.has(r.taskId))
    const searchSessions = collectSearchSessions(
      sources.tasks.filter((t) => t.projectId === projectId),
    )
    const adapted = adaptProjectSources({
      projectId,
      agentRuns,
      codexRuns,
      searchSessions,
    })
    await this.upsertMany(projectId, adapted)
    const snap = await this.repo.load(projectId)
    return { upserted: adapted.length, total: snap.executions.length }
  }

  /** Create a manual / fixture execution (no live provider call). */
  async recordManual(input: {
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
    errorCategory?: ExecutionRecord['errorCategory']
    userMessage?: string
    technicalSummary?: string
    retryCount?: number
    sourceId?: string
  }): Promise<ExecutionRecord> {
    const sourceId =
      input.sourceId ??
      `manual_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    const cost = applyCostToRecord({
      provider: input.provider,
      model: input.model,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
    })
    const record: ExecutionRecord = {
      id: executionIdFor('manual', sourceId),
      projectId: input.projectId,
      taskId: input.taskId,
      stepId: input.stepId,
      agentId: input.agentId,
      provider: input.provider,
      model: input.model,
      operation: input.operation,
      status: input.status,
      startedAt: input.startedAt,
      completedAt: input.completedAt,
      durationMs: input.durationMs,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      ...cost,
      errorCategory: input.errorCategory,
      userMessage: input.userMessage,
      technicalSummary: input.technicalSummary,
      retryCount: input.retryCount ?? 0,
      metadata: {
        sourceKind: 'manual',
        sourceId,
      },
    }
    await this.upsert(record)
    return record
  }

  async aggregate(filter: UsageListFilter = {}): Promise<UsageAggregation> {
    const list = await this.list(filter)
    return aggregateExecutions(list)
  }

  async summary(scope: UsageSummaryScope): Promise<{
    scope: UsageSummaryScope['scope']
    projectId?: string
    aggregation: UsageAggregation
    recent: ExecutionRecord[]
    groups: ReturnType<typeof groupByDimensions>
  }> {
    let filter: UsageListFilter = {}
    if (scope.scope === 'today') {
      const range = todayUtcRange()
      filter = {
        ...range,
        projectId: scope.projectId,
      }
    } else if (scope.scope === 'project') {
      if (!scope.projectId) throw Object.assign(new Error('projectId required'), { status: 400 })
      filter = { projectId: scope.projectId }
    } else {
      filter = {}
    }
    const recent = await this.list(filter)
    const aggregation = aggregateExecutions(recent)
    return {
      scope: scope.scope,
      projectId: scope.projectId,
      aggregation,
      recent: recent.slice(0, 50),
      groups: groupByDimensions(recent),
    }
  }

  async taskSummary(
    projectId: string,
    taskId: string,
  ): Promise<UsageAggregation> {
    return this.aggregate({ projectId, taskId })
  }

  async projectSummary(projectId: string): Promise<UsageAggregation> {
    return this.aggregate({ projectId })
  }

  async getBudget(projectId: string): Promise<ProjectBudget | null> {
    const snap = await this.repo.load(projectId)
    return snap.budget ?? null
  }

  async setBudget(
    projectId: string,
    patch: {
      maxCost?: number | null
      maxTokens?: number | null
      warningThreshold?: number | null
    },
  ): Promise<ProjectBudget> {
    const snap = await this.repo.load(projectId)
    const prev = snap.budget
    const budget: ProjectBudget = {
      projectId,
      maxCost:
        patch.maxCost === null
          ? undefined
          : (patch.maxCost ?? prev?.maxCost),
      maxTokens:
        patch.maxTokens === null
          ? undefined
          : (patch.maxTokens ?? prev?.maxTokens),
      warningThreshold:
        patch.warningThreshold === null
          ? undefined
          : (patch.warningThreshold ?? prev?.warningThreshold ?? 0.8),
      updatedAt: new Date().toISOString(),
    }
    await this.repo.save({ ...snap, budget })
    return budget
  }

  /**
   * Soft budget check — structure only; does not block execution in O1.
   */
  async checkBudget(projectId: string): Promise<{
    budget: ProjectBudget | null
    usage: UsageAggregation
    overCost: boolean
    overTokens: boolean
    warning: boolean
  }> {
    const budget = await this.getBudget(projectId)
    const usage = await this.projectSummary(projectId)
    const cost = usage.estimatedCost ?? 0
    const overCost =
      budget?.maxCost != null &&
      !usage.hasUnknownCost &&
      cost > budget.maxCost
    const overTokens =
      budget?.maxTokens != null && usage.totalTokens > budget.maxTokens
    const warnAt = budget?.warningThreshold ?? 0.8
    const warning =
      Boolean(budget) &&
      !overCost &&
      !overTokens &&
      ((budget?.maxCost != null &&
        !usage.hasUnknownCost &&
        cost >= budget.maxCost * warnAt) ||
        (budget?.maxTokens != null &&
          usage.totalTokens >= budget.maxTokens * warnAt))
    return { budget, usage, overCost, overTokens, warning }
  }
}
