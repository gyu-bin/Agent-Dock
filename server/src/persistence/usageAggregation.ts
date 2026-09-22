import type {
  ExecutionRecord,
  UsageAggregation,
  UsageListFilter,
} from './usageTypes.js'

export function emptyAggregation(): UsageAggregation {
  return {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    estimatedCost: 0,
    hasUnknownCost: false,
    averageDurationMs: 0,
    failures: 0,
    retries: 0,
    openaiCalls: 0,
    codexRuns: 0,
    webSearches: 0,
    mockCalls: 0,
    humanCalls: 0,
  }
}

export function aggregateExecutions(
  records: ExecutionRecord[],
): UsageAggregation {
  const agg = emptyAggregation()
  let durationSum = 0
  let durationCount = 0
  let knownCostSum = 0

  for (const r of records) {
    agg.calls += 1
    agg.inputTokens += r.inputTokens ?? 0
    agg.outputTokens += r.outputTokens ?? 0
    agg.retries += r.retryCount ?? 0
    if (r.status === 'failed') agg.failures += 1
    if (r.durationMs != null) {
      durationSum += r.durationMs
      durationCount += 1
    }
    if (r.costUnknown) agg.hasUnknownCost = true
    else if (typeof r.estimatedCost === 'number') knownCostSum += r.estimatedCost

    if (r.provider === 'openai' || r.provider === 'openai-image')
      agg.openaiCalls += 1
    else if (r.provider === 'codex') agg.codexRuns += 1
    else if (r.provider === 'web-search') agg.webSearches += 1
    else if (r.provider === 'mock') agg.mockCalls += 1
    else if (r.provider === 'human') agg.humanCalls += 1
  }

  agg.totalTokens = agg.inputTokens + agg.outputTokens
  agg.averageDurationMs =
    durationCount > 0 ? Math.round(durationSum / durationCount) : 0
  // If any cost is unknown, do not present a guessed total — report null.
  agg.estimatedCost = agg.hasUnknownCost ? null : knownCostSum
  return agg
}

function dayKey(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10)
  return d.toISOString().slice(0, 10)
}

function inDateRange(
  startedAt: string,
  dateFrom?: string,
  dateTo?: string,
): boolean {
  if (!dateFrom && !dateTo) return true
  const t = Date.parse(startedAt)
  if (Number.isNaN(t)) return false
  if (dateFrom) {
    const from = Date.parse(
      dateFrom.length <= 10 ? `${dateFrom}T00:00:00.000Z` : dateFrom,
    )
    if (!Number.isNaN(from) && t < from) return false
  }
  if (dateTo) {
    const to = Date.parse(
      dateTo.length <= 10 ? `${dateTo}T23:59:59.999Z` : dateTo,
    )
    if (!Number.isNaN(to) && t > to) return false
  }
  return true
}

export function filterExecutions(
  records: ExecutionRecord[],
  filter: UsageListFilter,
): ExecutionRecord[] {
  const q = filter.q?.trim().toLowerCase()
  return records.filter((r) => {
    if (filter.projectId && r.projectId !== filter.projectId) return false
    if (filter.taskId && r.taskId !== filter.taskId) return false
    if (filter.agentId && r.agentId !== filter.agentId) return false
    if (filter.provider && r.provider !== filter.provider) return false
    if (filter.status && r.status !== filter.status) return false
    if (!inDateRange(r.startedAt, filter.dateFrom, filter.dateTo)) return false
    if (q) {
      const hay = [
        r.operation,
        r.model,
        r.agentId,
        r.provider,
        r.userMessage,
        r.id,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

export function groupByDimensions(
  records: ExecutionRecord[],
): {
  byProject: Record<string, UsageAggregation>
  byTask: Record<string, UsageAggregation>
  byAgent: Record<string, UsageAggregation>
  byProvider: Record<string, UsageAggregation>
  byModel: Record<string, UsageAggregation>
  byDate: Record<string, UsageAggregation>
} {
  const byProject: Record<string, ExecutionRecord[]> = {}
  const byTask: Record<string, ExecutionRecord[]> = {}
  const byAgent: Record<string, ExecutionRecord[]> = {}
  const byProvider: Record<string, ExecutionRecord[]> = {}
  const byModel: Record<string, ExecutionRecord[]> = {}
  const byDate: Record<string, ExecutionRecord[]> = {}

  const push = (
    map: Record<string, ExecutionRecord[]>,
    key: string,
    r: ExecutionRecord,
  ) => {
    ;(map[key] ??= []).push(r)
  }

  for (const r of records) {
    push(byProject, r.projectId, r)
    push(byTask, r.taskId, r)
    if (r.agentId) push(byAgent, r.agentId, r)
    push(byProvider, r.provider, r)
    push(byModel, r.model ?? '(none)', r)
    push(byDate, dayKey(r.startedAt), r)
  }

  const mapAgg = (src: Record<string, ExecutionRecord[]>) => {
    const out: Record<string, UsageAggregation> = {}
    for (const [k, list] of Object.entries(src)) {
      out[k] = aggregateExecutions(list)
    }
    return out
  }

  return {
    byProject: mapAgg(byProject),
    byTask: mapAgg(byTask),
    byAgent: mapAgg(byAgent),
    byProvider: mapAgg(byProvider),
    byModel: mapAgg(byModel),
    byDate: mapAgg(byDate),
  }
}

export function todayUtcRange(): { dateFrom: string; dateTo: string } {
  const day = new Date().toISOString().slice(0, 10)
  return { dateFrom: day, dateTo: day }
}
