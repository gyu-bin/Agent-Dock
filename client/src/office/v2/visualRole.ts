import type { Agent, DivisionId } from '../../domain/types'
import type { OfficeV2VisualRole } from './manifestTypes'

/**
 * Deterministic Agent → Office V2 Visual Role mapper.
 * 279 registry agents share 8 role bases — never 1:1 sprites.
 *
 * Not wired into OfficeScene yet.
 */

const DIVISION_ROLE: Partial<Record<DivisionId, OfficeV2VisualRole>> = {
  product: 'pm',
  'project-management': 'pm',
  strategy: 'pm',
  engineering: 'developer',
  specialized: 'developer',
  'spatial-computing': 'developer',
  'game-development': 'game-developer',
  design: 'designer',
  research: 'researcher',
  academic: 'researcher',
  gis: 'researcher',
  healthcare: 'researcher',
  marketing: 'marketer',
  sales: 'marketer',
  'paid-media': 'marketer',
  testing: 'qa',
  security: 'qa',
  finance: 'pm',
  support: 'qa',
}

type HintRule = { role: OfficeV2VisualRole; patterns: RegExp[] }

/** Order matters — first match wins. */
const HINT_RULES: HintRule[] = [
  {
    role: 'pm',
    patterns: [
      /product[-_ ]?manager/,
      /\bpm\b/,
      /producer/,
      /orchestrator/,
      /sprint[-_ ]?prioritizer/,
      /project[-_ ]?manager/,
    ],
  },
  {
    role: 'reviewer',
    patterns: [
      /code[-_ ]?review/,
      /reviewer/,
      /reality[-_ ]?check/,
      /reality[-_ ]?검증/,
    ],
  },
  {
    role: 'qa',
    patterns: [/qa\b/, /test(er|ing)?/, /검증/, /quality/],
  },
  {
    role: 'game-developer',
    patterns: [
      /game[-_ ]?dev/,
      /game[-_ ]?engineer/,
      /unity/,
      /unreal/,
      /technical[-_ ]?artist/,
      /level[-_ ]?designer/,
      /game[-_ ]?designer/,
    ],
  },
  {
    role: 'designer',
    patterns: [
      /ui[-_ ]?designer/,
      /ux/,
      /visual[-_ ]?design/,
      /brand[-_ ]?design/,
      /graphic/,
      /일러스트/,
    ],
  },
  {
    role: 'researcher',
    patterns: [/research/, /trend/, /analyst/, /synthesist/, /조사/],
  },
  {
    role: 'marketer',
    patterns: [
      /market/,
      /content/,
      /growth/,
      /copywriter/,
      /app[-_ ]?store/,
      /paid[-_ ]?media/,
      /seo/,
    ],
  },
  {
    role: 'developer',
    patterns: [
      /frontend/,
      /backend/,
      /fullstack/,
      /mobile/,
      /engineer/,
      /developer/,
      /devops/,
      /ai[-_ ]?engineer/,
      /builder/,
      /개발/,
    ],
  },
]

const FALLBACK: OfficeV2VisualRole = 'developer'

function haystack(agent: Agent): string {
  return `${agent.id} ${agent.name} ${agent.description ?? ''}`.toLowerCase()
}

/**
 * Map any Agent to one of 8 Office V2 visual roles.
 * Deterministic: same agent → same role forever.
 */
export function resolveOfficeV2VisualRole(agent: Agent): OfficeV2VisualRole {
  const text = haystack(agent)
  for (const rule of HINT_RULES) {
    if (rule.patterns.some((p) => p.test(text))) return rule.role
  }
  return DIVISION_ROLE[agent.division] ?? FALLBACK
}

/** Stable variation seed for future hair/outfit/skin/accessory kits. */
export function visualVariationSeed(agentId: string): number {
  let h = 2166136261
  for (let i = 0; i < agentId.length; i++) {
    h ^= agentId.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function pickVariationIndex(agentId: string, channel: number, modulo: number): number {
  if (modulo <= 0) return 0
  const seed = visualVariationSeed(agentId)
  return (seed >>> (channel * 3)) % modulo
}
