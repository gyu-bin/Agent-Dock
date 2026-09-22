import type { Agent, DivisionId } from '../types'
import type {
  AgentCapability,
  AgentCapabilityProfile,
  CapabilitySource,
  ToolId,
} from './capabilityTypes'

type AgentLike = Pick<Agent, 'id' | 'name' | 'division' | 'description'>

function uniq(caps: AgentCapability[]): AgentCapability[] {
  return [...new Set(caps)].sort()
}

/** Explicit high-value agent id overrides (deterministic). */
const ID_PROFILES: Record<
  string,
  { caps: AgentCapability[]; tools: ToolId[]; reason: string }
> = {
  'frontend-developer': {
    caps: ['code.inspect', 'code.write', 'code.test', 'design.ui'],
    tools: ['codex'],
    reason: 'id:frontend-developer',
  },
  'backend-architect': {
    caps: ['code.inspect', 'code.write', 'code.test', 'project.plan'],
    tools: ['codex'],
    reason: 'id:backend-architect',
  },
  'mobile-app-builder': {
    caps: ['code.inspect', 'code.write', 'code.test', 'design.ui'],
    tools: ['codex'],
    reason: 'id:mobile-app-builder',
  },
  'ai-engineer': {
    caps: ['code.inspect', 'code.write', 'code.test', 'research.analyze'],
    tools: ['codex', 'openai'],
    reason: 'id:ai-engineer',
  },
  'devops-automator': {
    caps: ['code.inspect', 'code.write', 'code.test', 'qa.verify'],
    tools: ['codex'],
    reason: 'id:devops-automator',
  },
  'rapid-prototyper': {
    caps: ['code.inspect', 'code.write', 'design.ui'],
    tools: ['codex'],
    reason: 'id:rapid-prototyper',
  },
  'code-reviewer': {
    caps: ['code.inspect', 'code.review'],
    tools: ['codex'],
    reason: 'id:code-reviewer',
  },
  'api-tester': {
    caps: ['code.test', 'qa.test', 'qa.verify'],
    tools: ['codex'],
    reason: 'id:api-tester',
  },
  'reality-checker': {
    caps: ['qa.test', 'qa.verify', 'research.analyze', 'document.write'],
    tools: ['openai', 'codex'],
    reason: 'id:reality-checker',
  },
  'trend-researcher': {
    caps: [
      'research.web',
      'research.analyze',
      'research.synthesize',
      'document.write',
    ],
    tools: ['web-search', 'openai'],
    reason: 'id:trend-researcher',
  },
  'research-synthesist': {
    caps: [
      'research.web',
      'research.analyze',
      'research.synthesize',
      'document.write',
    ],
    tools: ['web-search', 'openai'],
    reason: 'id:research-synthesist',
  },
  'ui-designer': {
    caps: ['design.analyze', 'design.ui', 'document.write'],
    tools: ['openai'],
    reason: 'id:ui-designer',
  },
  'ux-researcher': {
    caps: ['design.analyze', 'research.analyze', 'document.write'],
    tools: ['openai', 'web-search'],
    reason: 'id:ux-researcher',
  },
  'brand-guardian': {
    caps: ['design.analyze', 'content.write', 'document.write'],
    tools: ['openai'],
    reason: 'id:brand-guardian',
  },
  'product-manager': {
    caps: ['project.plan', 'research.analyze', 'document.write'],
    tools: ['openai'],
    reason: 'id:product-manager',
  },
  'feedback-synthesizer': {
    caps: ['research.analyze', 'research.synthesize', 'document.write'],
    tools: ['openai'],
    reason: 'id:feedback-synthesizer',
  },
  'sprint-prioritizer': {
    caps: ['project.plan', 'document.write'],
    tools: ['openai'],
    reason: 'id:sprint-prioritizer',
  },
  'studio-producer': {
    caps: ['project.plan', 'document.write'],
    tools: ['openai'],
    reason: 'id:studio-producer',
  },
  'agents-orchestrator': {
    caps: ['project.plan', 'document.write', 'research.analyze'],
    tools: ['openai'],
    reason: 'id:agents-orchestrator',
  },
  'content-creator': {
    caps: ['content.write', 'marketing.content', 'document.write'],
    tools: ['openai'],
    reason: 'id:content-creator',
  },
  'growth-hacker': {
    caps: [
      'marketing.research',
      'marketing.plan',
      'marketing.content',
      'content.write',
    ],
    tools: ['openai', 'web-search'],
    reason: 'id:growth-hacker',
  },
  'app-store-optimizer': {
    caps: ['marketing.research', 'marketing.plan', 'marketing.content'],
    tools: ['openai', 'web-search'],
    reason: 'id:app-store-optimizer',
  },
  'game-designer': {
    caps: ['design.analyze', 'project.plan', 'document.write'],
    tools: ['openai'],
    reason: 'id:game-designer',
  },
  'level-designer': {
    caps: ['design.ui', 'design.analyze', 'document.write'],
    tools: ['openai'],
    reason: 'id:level-designer',
  },
  'technical-artist': {
    caps: ['design.asset', 'design.ui', 'code.inspect'],
    tools: ['openai', 'codex'],
    reason: 'id:technical-artist',
  },
  'narrative-designer': {
    caps: ['content.write', 'document.write', 'design.analyze'],
    tools: ['openai'],
    reason: 'id:narrative-designer',
  },
  'application-security-engineer': {
    caps: ['code.inspect', 'code.review', 'qa.verify'],
    tools: ['codex'],
    reason: 'id:application-security-engineer',
  },
  'account-strategist': {
    caps: ['marketing.plan', 'content.write', 'document.write'],
    tools: ['openai'],
    reason: 'id:account-strategist',
  },
}

type HintRule = {
  pattern: RegExp
  caps: AgentCapability[]
  tools: ToolId[]
  reason: string
}

/** Order matters — first match wins after ID override. */
const HINT_RULES: HintRule[] = [
  {
    pattern: /security|threat|auditor|penetration|vulnerability/,
    caps: ['code.inspect', 'code.review', 'qa.verify'],
    tools: ['codex'],
    reason: 'hint:security',
  },
  {
    pattern: /code-review|reviewer/,
    caps: ['code.inspect', 'code.review'],
    tools: ['codex'],
    reason: 'hint:reviewer',
  },
  {
    pattern: /qa|tester|test-autom|accessibility-auditor|reality/,
    caps: ['code.test', 'qa.test', 'qa.verify'],
    tools: ['codex'],
    reason: 'hint:qa',
  },
  {
    pattern: /frontend|fullstack|developer|engineer|architect|builder|sre|devops/,
    caps: ['code.inspect', 'code.write', 'code.test'],
    tools: ['codex'],
    reason: 'hint:engineer',
  },
  {
    pattern: /ui-design|visual-design|brand|designer/,
    caps: ['design.analyze', 'design.ui', 'document.write'],
    tools: ['openai'],
    reason: 'hint:design',
  },
  {
    pattern: /ux|user-research/,
    caps: ['design.analyze', 'research.analyze', 'document.write'],
    tools: ['openai', 'web-search'],
    reason: 'hint:ux',
  },
  {
    pattern: /trend|research|synthes|market-intel|anthropolog/,
    caps: [
      'research.web',
      'research.analyze',
      'research.synthesize',
      'document.write',
    ],
    tools: ['web-search', 'openai'],
    reason: 'hint:research',
  },
  {
    pattern: /marketing|growth|seo|aso|content|copy|campaign|carousel|citation/,
    caps: [
      'marketing.research',
      'marketing.plan',
      'marketing.content',
      'content.write',
    ],
    tools: ['openai', 'web-search'],
    reason: 'hint:marketing',
  },
  {
    pattern: /product|manager|producer|prioritiz|orchestrat|strategist|shepherd/,
    caps: ['project.plan', 'research.analyze', 'document.write'],
    tools: ['openai'],
    reason: 'hint:product',
  },
  {
    pattern: /analytics|reporter/,
    caps: ['document.write', 'research.analyze'],
    tools: ['openai'],
    reason: 'hint:analytics-safe',
  },
  {
    pattern: /sales|account/,
    caps: ['marketing.plan', 'content.write', 'document.write'],
    tools: ['openai'],
    reason: 'hint:sales',
  },
]

const DIVISION_DEFAULTS: Record<
  DivisionId,
  { caps: AgentCapability[]; tools: ToolId[]; reason: string }
> = {
  engineering: {
    caps: ['code.inspect', 'code.write', 'code.test'],
    tools: ['codex'],
    reason: 'division:engineering',
  },
  'game-development': {
    caps: ['code.inspect', 'design.ui', 'document.write'],
    tools: ['codex', 'openai'],
    reason: 'division:game-development',
  },
  'spatial-computing': {
    caps: ['code.inspect', 'code.write', 'design.ui'],
    tools: ['codex', 'openai'],
    reason: 'division:spatial-computing',
  },
  design: {
    caps: ['design.analyze', 'design.ui', 'document.write'],
    tools: ['openai'],
    reason: 'division:design',
  },
  testing: {
    caps: ['code.test', 'qa.test', 'qa.verify'],
    tools: ['codex'],
    reason: 'division:testing',
  },
  security: {
    caps: ['code.inspect', 'code.review', 'qa.verify'],
    tools: ['codex'],
    reason: 'division:security',
  },
  research: {
    caps: [
      'research.web',
      'research.analyze',
      'research.synthesize',
      'document.write',
    ],
    tools: ['web-search', 'openai'],
    reason: 'division:research',
  },
  academic: {
    caps: [
      'research.web',
      'research.analyze',
      'research.synthesize',
      'document.write',
    ],
    tools: ['web-search', 'openai'],
    reason: 'division:academic',
  },
  marketing: {
    caps: [
      'marketing.research',
      'marketing.plan',
      'marketing.content',
      'content.write',
    ],
    tools: ['openai', 'web-search'],
    reason: 'division:marketing',
  },
  'paid-media': {
    caps: ['marketing.research', 'marketing.plan', 'marketing.content'],
    tools: ['openai', 'web-search'],
    reason: 'division:paid-media',
  },
  sales: {
    caps: ['marketing.plan', 'content.write', 'document.write'],
    tools: ['openai'],
    reason: 'division:sales',
  },
  product: {
    caps: ['project.plan', 'research.analyze', 'document.write'],
    tools: ['openai'],
    reason: 'division:product',
  },
  'project-management': {
    caps: ['project.plan', 'document.write'],
    tools: ['openai'],
    reason: 'division:project-management',
  },
  strategy: {
    caps: ['project.plan', 'research.analyze', 'document.write'],
    tools: ['openai'],
    reason: 'division:strategy',
  },
  finance: {
    caps: ['document.write', 'project.plan'],
    tools: ['openai'],
    reason: 'division:finance',
  },
  support: {
    caps: ['document.write', 'content.write'],
    tools: ['openai'],
    reason: 'division:support',
  },
  gis: {
    caps: ['code.inspect', 'research.analyze', 'document.write'],
    tools: ['openai', 'codex'],
    reason: 'division:gis',
  },
  healthcare: {
    caps: ['research.analyze', 'document.write'],
    tools: ['openai'],
    reason: 'division:healthcare',
  },
  specialized: {
    caps: ['document.write', 'research.analyze'],
    tools: ['openai'],
    reason: 'division:specialized',
  },
}

/** Safe minimum — never "all capabilities". */
const SAFE_FALLBACK: {
  caps: AgentCapability[]
  tools: ToolId[]
  reason: string
  source: CapabilitySource
} = {
  caps: ['document.write'],
  tools: ['openai'],
  reason: 'fallback:document.write',
  source: 'fallback-safe',
}

/**
 * Deterministic Agent → Capability Profile.
 * Same agent identity → same profile forever (no LLM).
 */
export function deriveAgentCapabilities(
  agent: AgentLike,
): AgentCapabilityProfile {
  const id = agent.id.toLowerCase()
  const hay = `${agent.id} ${agent.name} ${agent.description ?? ''}`.toLowerCase()

  const byId = ID_PROFILES[id]
  if (byId) {
    return {
      agentId: agent.id,
      capabilities: uniq(byId.caps),
      preferredTools: byId.tools,
      source: 'agent-id',
      reason: byId.reason,
    }
  }

  for (const rule of HINT_RULES) {
    if (rule.pattern.test(hay)) {
      return {
        agentId: agent.id,
        capabilities: uniq(rule.caps),
        preferredTools: rule.tools,
        source: 'name-hint',
        reason: rule.reason,
      }
    }
  }

  const byDiv = DIVISION_DEFAULTS[agent.division]
  if (byDiv) {
    return {
      agentId: agent.id,
      capabilities: uniq(byDiv.caps),
      preferredTools: byDiv.tools,
      source: 'division',
      reason: byDiv.reason,
    }
  }

  return {
    agentId: agent.id,
    capabilities: uniq(SAFE_FALLBACK.caps),
    preferredTools: SAFE_FALLBACK.tools,
    source: SAFE_FALLBACK.source,
    reason: SAFE_FALLBACK.reason,
  }
}

export function profileAllAgents(
  agents: AgentLike[],
): AgentCapabilityProfile[] {
  return agents
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(deriveAgentCapabilities)
}

export function auditCapabilityProfiles(profiles: AgentCapabilityProfile[]): {
  total: number
  withCapabilities: number
  withoutCapabilities: string[]
  capabilityDistribution: Record<string, number>
  preferredToolDistribution: Record<string, number>
  sourceDistribution: Record<string, number>
} {
  const capabilityDistribution: Record<string, number> = {}
  const preferredToolDistribution: Record<string, number> = {}
  const sourceDistribution: Record<string, number> = {}
  const withoutCapabilities: string[] = []

  for (const p of profiles) {
    sourceDistribution[p.source] = (sourceDistribution[p.source] ?? 0) + 1
    if (p.capabilities.length === 0) withoutCapabilities.push(p.agentId)
    for (const c of p.capabilities) {
      capabilityDistribution[c] = (capabilityDistribution[c] ?? 0) + 1
    }
    for (const t of p.preferredTools) {
      preferredToolDistribution[t] = (preferredToolDistribution[t] ?? 0) + 1
    }
  }

  return {
    total: profiles.length,
    withCapabilities: profiles.length - withoutCapabilities.length,
    withoutCapabilities,
    capabilityDistribution,
    preferredToolDistribution,
    sourceDistribution,
  }
}
