/**
 * Capability Foundation fixtures A–H.
 * Run: npx tsx client/src/domain/capabilities/capabilityFoundation.verify.ts
 * No real provider calls.
 */
import divisionMap from '../../data/agencyDivisionMap.json'
import type { Agent, DivisionId } from '../types'
import { MOCK_REGISTRY } from '../../data/mockRegistry'
import {
  WORKFLOW_TEMPLATES,
  getTemplateById,
} from '../workflowTemplates'
import {
  selectWorkflowTemplate,
  resolveTemplateToSteps,
  matchAgentForRole,
} from '../templateSelector'
import {
  deriveAgentCapabilities,
  profileAllAgents,
  auditCapabilityProfiles,
  resolveToolForCapability,
  matchAgentForCapabilities,
  detectCapabilityConflicts,
  permissionForCapability,
  listAvailableTools,
} from './index'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg)
}

function eq<T>(a: T, b: T, msg: string) {
  assert(a === b, `${msg}: expected ${String(b)}, got ${String(a)}`)
}

function agent(
  id: string,
  division: DivisionId,
  name = id,
  description = '',
): Agent {
  return {
    id,
    name,
    division,
    description,
    status: 'idle',
    enabled: true,
  }
}

function fullRegistryFromMap(): Agent[] {
  const slug = (
    divisionMap as { slugToDivision: Record<string, string> }
  ).slugToDivision
  return Object.entries(slug).map(([id, division]) =>
    agent(id, division as DivisionId),
  )
}

// ——— TEST A: Developer → Codex ———
{
  const team = [agent('frontend-developer', 'engineering')]
  const registry = fullRegistryFromMap()
  const hit = matchAgentForRole({
    role: 'frontend',
    team,
    registry,
    usedIds: new Set(),
    requiredCapabilities: ['code.inspect', 'code.write', 'code.test'],
  })
  eq(hit?.id, 'frontend-developer', 'A agent')
  const profile = deriveAgentCapabilities(hit!)
  const tool = resolveToolForCapability({
    capability: 'code.write',
    agent: profile,
  })
  eq(tool.status, 'ok', 'A tool status')
  eq(tool.toolId, 'codex', 'A tool codex')
  console.log('TEST A PASS')
}

// ——— TEST B: Research → Web Search + OpenAI ———
{
  const team = [agent('trend-researcher', 'research')]
  const registry = fullRegistryFromMap()
  const hit = matchAgentForRole({
    role: 'researcher',
    team,
    registry,
    usedIds: new Set(),
    requiredCapabilities: ['research.web', 'research.analyze'],
  })
  eq(hit?.id, 'trend-researcher', 'B agent')
  const profile = deriveAgentCapabilities(hit!)
  const web = resolveToolForCapability({
    capability: 'research.web',
    agent: profile,
  })
  const openai = resolveToolForCapability({
    capability: 'research.analyze',
    agent: profile,
  })
  eq(web.toolId, 'web-search', 'B web-search')
  eq(openai.toolId, 'openai', 'B openai')
  console.log('TEST B PASS')
}

// ——— TEST C: QA → Codex ———
{
  const team = [agent('api-tester', 'testing')]
  const hit = matchAgentForRole({
    role: 'reality',
    team,
    registry: fullRegistryFromMap(),
    usedIds: new Set(),
    requiredCapabilities: ['code.test', 'qa.verify'],
  })
  assert(hit, 'C agent')
  const profile = deriveAgentCapabilities(hit)
  assert(profile.capabilities.includes('code.test'), 'C has code.test')
  const tool = resolveToolForCapability({
    capability: 'code.test',
    agent: profile,
  })
  eq(tool.toolId, 'codex', 'C codex')
  console.log('TEST C PASS')
}

// ——— TEST D: Marketing → OpenAI ———
{
  const team = [agent('growth-hacker', 'marketing')]
  const hit = matchAgentForRole({
    role: 'marketing',
    team,
    registry: fullRegistryFromMap(),
    usedIds: new Set(),
    requiredCapabilities: ['marketing.plan', 'marketing.content'],
  })
  eq(hit?.id, 'growth-hacker', 'D agent')
  const profile = deriveAgentCapabilities(hit!)
  const tool = resolveToolForCapability({
    capability: 'marketing.plan',
    agent: profile,
  })
  eq(tool.toolId, 'openai', 'D openai')
  console.log('TEST D PASS')
}

// ——— TEST E: Missing image.generate tool ———
{
  const conflicts = detectCapabilityConflicts({
    required: ['image.generate'],
    agent: deriveAgentCapabilities(agent('ui-designer', 'design')),
  })
  assert(
    conflicts.some(
      (c) =>
        c.capability === 'image.generate' &&
        (c.code === 'tool_unavailable' || c.code === 'agent_capability_missing'),
    ),
    'E missing/unavailable',
  )
  const tool = resolveToolForCapability({ capability: 'image.generate' })
  eq(tool.status, 'unavailable', 'E unavailable status')
  assert(tool.message && /연결되지|없/.test(tool.message), 'E message')
  console.log('TEST E PASS')
}

// ——— TEST F: Specialist security ———
{
  const team = [
    agent('product-manager', 'product'),
    agent('frontend-developer', 'engineering'),
  ]
  const assignment = matchAgentForCapabilities({
    requiredCapabilities: ['code.inspect', 'code.review', 'qa.verify'],
    team,
    registry: fullRegistryFromMap(),
  })
  assert(assignment, 'F assignment')
  eq(assignment.source, 'specialist', 'F specialist')
  assert(
    /security|reviewer|auditor|application-security/i.test(assignment.agentId),
    `F security-ish id got ${assignment.agentId}`,
  )
  console.log('TEST F PASS')
}

// ——— TEST G: Determinism 279 ———
{
  const agents = fullRegistryFromMap()
  eq(agents.length, 279, 'G registry size')
  const a = profileAllAgents(agents)
  const b = profileAllAgents(agents)
  eq(JSON.stringify(a), JSON.stringify(b), 'G deterministic profiles')
  const audit = auditCapabilityProfiles(a)
  eq(audit.withoutCapabilities.length, 0, 'G no empty profiles')
  eq(audit.total, 279, 'G total')
  console.log('TEST G PASS', {
    sources: audit.sourceDistribution,
    tools: audit.preferredToolDistribution,
  })
}

// ——— TEST H: Regression workflow templates ———
{
  assert(WORKFLOW_TEMPLATES.length >= 7, 'H template count')
  const fb = getTemplateById('FEATURE_BUILD')
  assert(fb, 'H FEATURE_BUILD')
  const impl = fb.steps.find((s) => s.key === 'implement')
  assert(impl?.requiredCapabilities?.includes('code.write'), 'H implement caps')

  const sel = selectWorkflowTemplate({ request: '로그인 화면 구현해줘' })
  const resolved = resolveTemplateToSteps({
    template: sel.template,
    request: '로그인 화면 구현해줘',
    team: MOCK_REGISTRY,
    registry: MOCK_REGISTRY,
  })
  assert(resolved.steps.length > 0, 'H steps')
  assert(
    resolved.steps.every((s) => s.agentId && s.provider),
    'H agent+provider',
  )
  // Safety: human approval still present for change when in template
  const hasHuman = resolved.steps.some((s) => s.provider === 'human')
  assert(hasHuman || sel.template.id !== 'FEATURE_BUILD', 'H human or other')

  const marketing = selectWorkflowTemplate({
    request: '마케팅 캠페인 홍보 전략 조사',
  })
  assert(
    marketing.template.id === 'MARKETING_CAMPAIGN' ||
      marketing.template.workflowKind === 'MARKETING',
    `H marketing template got ${marketing.template.id}`,
  )

  eq(permissionForCapability('social.publish'), 'human-approval-required', 'H social')
  eq(permissionForCapability('code.write'), 'safety-pipeline', 'H write')
  eq(permissionForCapability('research.web'), 'auto-allow', 'H read')

  assert(listAvailableTools().some((t) => t.id === 'codex'), 'H tools')
  console.log('TEST H PASS')
}

console.log('capabilityFoundation fixtures: ALL PASS')
