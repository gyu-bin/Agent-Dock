import type { AiProvider } from '../providers/aiProvider.js'
import { planSearchQueries } from './searchPlanner.js'
import { resolveRequiresWebSearch } from './requiresWebSearch.js'
import { buildWebSearchDataBlock, dedupeSources } from './sourceUtils.js'
import { getCachedSearch, setCachedSearch } from './taskSearchCache.js'
import type {
  SearchPlan,
  TaskWebSearchSession,
  WebSearchProvider,
  WebSource,
} from './types.js'

export interface RunWebSearchPipelineInput {
  taskId: string
  stepId?: string
  agentId: string
  role?: string
  stepLabel: string
  userRequest: string
  requiresWebSearch?: boolean
  skipBecausePriorResearch?: boolean
  /** Cap total sources across queries */
  maxTotalSources?: number
}

export interface RunWebSearchPipelineResult {
  skipped: boolean
  reason?: string
  plan?: SearchPlan
  session?: TaskWebSearchSession
  sources: WebSource[]
  dataBlock?: string
  currentDate: string
}

/**
 * Search Plan → Web Search (cached) → Sources → DATA block for agent.
 * On provider failure throws WEB_SEARCH_FAILED — caller must NOT invent "fresh" answers.
 */
export async function runWebSearchPipeline(
  ai: AiProvider,
  search: WebSearchProvider,
  input: RunWebSearchPipelineInput,
): Promise<RunWebSearchPipelineResult> {
  const currentDate = new Date().toISOString().slice(0, 10)
  const needs = resolveRequiresWebSearch({
    requiresWebSearch: input.requiresWebSearch,
    agentId: input.agentId,
    role: input.role,
    stepLabel: input.stepLabel,
    userRequest: input.userRequest,
    skipBecausePriorResearch: input.skipBecausePriorResearch,
  })

  if (!needs) {
    return {
      skipped: true,
      reason: 'requiresWebSearch=false',
      sources: [],
      currentDate,
    }
  }

  if (!search.isAvailable()) {
    throw Object.assign(new Error('웹 검색 실패: provider unavailable'), {
      status: 503,
      code: 'WEB_SEARCH_FAILED',
    })
  }

  const plan = await planSearchQueries(ai, {
    userRequest: input.userRequest,
    stepTask: input.stepLabel,
    currentDate,
  })

  const results = []
  const allSources: WebSource[] = []
  const maxTotal = input.maxTotalSources ?? 12

  for (const query of plan.queries) {
    if (allSources.length >= maxTotal) break
    const cached = getCachedSearch(input.taskId, query)
    if (cached) {
      results.push(cached)
      allSources.push(...cached.sources)
      continue
    }
    const result = await search.search({
      query,
      currentDate,
      taskId: input.taskId,
      maxSources: 6,
    })
    setCachedSearch(input.taskId, result)
    results.push(result)
    allSources.push(...result.sources)
  }

  const sources = dedupeSources(allSources).slice(0, maxTotal)
  if (sources.length === 0) {
    throw Object.assign(
      new Error('웹 검색 실패: 유효한 출처가 없습니다.'),
      { status: 502, code: 'WEB_SEARCH_FAILED' },
    )
  }

  // Stable citation ids [1]..[n]
  const numbered = sources.map((s, i) => ({
    ...s,
    id: `cite_${i + 1}`,
  }))

  const searchedAt = new Date().toISOString()
  const session: TaskWebSearchSession = {
    id: `ws_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    taskId: input.taskId,
    stepId: input.stepId,
    agentId: input.agentId,
    queries: plan.queries,
    results,
    sources: numbered,
    searchedAt,
    status: 'ok',
  }

  const dataBlock = buildWebSearchDataBlock({
    currentDate,
    queries: plan.queries,
    sources: numbered,
  })

  return {
    skipped: false,
    plan,
    session,
    sources: numbered,
    dataBlock,
    currentDate,
  }
}
