import type { AiProvider } from '../providers/aiProvider.js'
import type { SearchPlan } from './types.js'

const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    reason: { type: 'string' },
    queries: {
      type: 'array',
      minItems: 2,
      maxItems: 5,
      items: { type: 'string' },
    },
  },
  required: ['reason', 'queries'],
} as const

/**
 * Plan 2–5 search queries before long-form generation.
 * Falls back to heuristic queries if LLM planning fails.
 */
export async function planSearchQueries(
  provider: AiProvider,
  input: {
    userRequest: string
    stepTask: string
    currentDate: string
  },
): Promise<SearchPlan> {
  const plannedAt = new Date().toISOString()
  if (!provider.isConfigured()) {
    return {
      queries: heuristicQueries(input.userRequest, input.currentDate),
      reason: 'provider unavailable — heuristic plan',
      plannedAt,
    }
  }

  try {
    const result = await provider.chat({
      messages: [
        {
          role: 'system',
          content: `You plan web search queries for Agent Deck research.
Return 2–5 focused queries. Do not answer the user request.
Prefer English queries for global markets (Steam, tech) plus one local-language query when the user wrote Korean.
Include the year ${input.currentDate.slice(0, 4)} when recency matters.
Never invent source URLs.`,
        },
        {
          role: 'user',
          content: `Current date: ${input.currentDate}\nUser request: ${input.userRequest}\nStep: ${input.stepTask}`,
        },
      ],
      jsonSchema: {
        name: 'search_plan',
        schema: PLAN_SCHEMA as unknown as Record<string, unknown>,
      },
      temperature: 0.2,
    })
    const parsed = JSON.parse(result.content) as {
      reason?: string
      queries?: string[]
    }
    const queries = (parsed.queries ?? [])
      .map((q) => q.trim())
      .filter(Boolean)
      .slice(0, 5)
    if (queries.length < 2) {
      return {
        queries: heuristicQueries(input.userRequest, input.currentDate),
        reason: parsed.reason ?? 'insufficient plan — heuristic',
        plannedAt,
      }
    }
    return {
      queries,
      reason: parsed.reason ?? 'planned',
      plannedAt,
    }
  } catch {
    return {
      queries: heuristicQueries(input.userRequest, input.currentDate),
      reason: 'plan failed — heuristic',
      plannedAt,
    }
  }
}

function heuristicQueries(userRequest: string, currentDate: string): string[] {
  const year = currentDate.slice(0, 4)
  const base = userRequest.replace(/\s+/g, ' ').trim().slice(0, 120)
  const queries = [
    `${base} ${year}`,
    `${base} trends ${year}`,
  ]
  if (/steam|게임|game/i.test(userRequest)) {
    queries.push(`Steam indie games trends ${year}`)
    queries.push(`viral co-op Steam games ${year}`)
  }
  if (/시장|market|경쟁|competitor/i.test(userRequest)) {
    queries.push(`${base} market analysis ${year}`)
  }
  return [...new Set(queries)].slice(0, 5)
}
