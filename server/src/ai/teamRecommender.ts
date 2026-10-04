import type { AiProvider } from '../providers/aiProvider.js'

export interface TeamCandidate {
  id: string
  name: string
  division: string
  description?: string
  executable?: boolean
  instructionAvailable?: boolean
}

export interface TeamPick {
  agentId: string
  role: string
  reason: string
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    members: {
      type: 'array',
      minItems: 3,
      maxItems: 12,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          agentId: { type: 'string' },
          role: { type: 'string' },
          reason: { type: 'string' },
        },
        required: ['agentId', 'role', 'reason'],
      },
    },
  },
  required: ['members'],
} as const

/**
 * Picks a project team from the real registry for what the user wants to do.
 * The model may only choose listed ids; anything else is dropped.
 */
export async function recommendTeam(
  ai: AiProvider,
  input: { name: string; type: string; goal: string; candidates: TeamCandidate[]; signal?: AbortSignal },
): Promise<TeamPick[]> {
  const usable = input.candidates.filter((a) => a.executable !== false && a.instructionAvailable !== false)
  const catalog = usable
    .map((a) => `${a.id} | ${a.name} | ${a.division} | ${(a.description ?? '').replace(/\s+/g, ' ').slice(0, 90)}`)
    .join('\n')
  const result = await ai.chat({
    signal: input.signal,
    messages: [
      {
        role: 'system',
        content: [
          'You staff a small AI team for a project. Choose 5–10 members from the catalog that the goal actually needs.',
          'Rules: use only agentId values from the catalog; no duplicates; prefer a lean team over coverage;',
          'include a planner/PM only if coordination is needed; do not add engineering roles for a pure marketing or research goal.',
          'role = short Korean role name (e.g. "SNS 운영", "콘텐츠 제작"); reason = one short Korean sentence tied to the goal.',
        ].join(' '),
      },
      {
        role: 'user',
        content: `Project: ${input.name || '(이름 없음)'}\nType: ${input.type}\nGoal: ${input.goal}\n\nCatalog (agentId | name | division | description):\n${catalog}`,
      },
    ],
    jsonSchema: { name: 'team_recommendation', schema: SCHEMA as unknown as Record<string, unknown> },
    temperature: 0.2,
  })
  const parsed = JSON.parse(result.content) as { members?: TeamPick[] }
  const ids = new Set(usable.map((a) => a.id))
  const seen = new Set<string>()
  return (parsed.members ?? []).filter((m) => {
    if (!ids.has(m.agentId) || seen.has(m.agentId)) return false
    seen.add(m.agentId)
    return true
  })
}
