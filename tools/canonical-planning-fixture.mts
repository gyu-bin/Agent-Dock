/**
 * Canonical Task Planning unification fixtures A–F.
 * Manual vs Routine must produce identical plans (source metadata excluded).
 * Run: node --import tsx tools/canonical-planning-fixture.mts
 */
import type { Agent, ProjectType } from '../client/src/domain/types.ts'
import {
  planFingerprint,
  planTask,
} from '../client/src/domain/taskPlanning/index.ts'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg)
}

function eq<T>(a: T, b: T, msg: string) {
  assert(a === b, `${msg}: expected ${String(b)}, got ${String(a)}`)
}

const registry: Agent[] = [
  {
    id: 'product-manager',
    name: 'Product Manager',
    division: 'product',
    description: 'product planning',
    status: 'idle',
    enabled: true,
  },
  {
    id: 'frontend-developer',
    name: 'Frontend Developer',
    division: 'engineering',
    description: 'frontend engineer',
    status: 'idle',
    enabled: true,
  },
  {
    id: 'code-reviewer',
    name: 'Code Reviewer',
    division: 'engineering',
    description: 'code review',
    status: 'idle',
    enabled: true,
  },
  {
    id: 'reality-checker',
    name: 'Reality Checker',
    division: 'testing',
    description: 'reality check',
    status: 'idle',
    enabled: true,
  },
  {
    id: 'devops-automator',
    name: 'DevOps',
    division: 'engineering',
    description: 'verify',
    status: 'idle',
    enabled: true,
  },
  {
    id: 'trend-researcher',
    name: 'Trend Researcher',
    division: 'research',
    description: 'market research',
    status: 'idle',
    enabled: true,
  },
  {
    id: 'growth-hacker',
    name: 'Growth Hacker',
    division: 'marketing',
    description: 'marketing growth',
    status: 'idle',
    enabled: true,
  },
  {
    id: 'content-creator',
    name: 'Content Creator',
    division: 'marketing',
    description: 'content writing',
    status: 'idle',
    enabled: true,
  },
  {
    id: 'game-designer',
    name: 'Game Designer',
    division: 'game-development',
    description: 'game design',
    status: 'idle',
    enabled: true,
  },
]

function baseProject(type: ProjectType = 'mobile-app') {
  return { id: 'proj_plan', type, name: "Don't Move" }
}

function planBoth(input: {
  request: string
  preferredTemplateId?: string
  requiredCapabilities?: import('../client/src/domain/capabilities').AgentCapability[]
  team: Agent[]
  projectType?: ProjectType
}) {
  const project = baseProject(input.projectType)
  const common = {
    project,
    request: input.request,
    preferredTemplateId: input.preferredTemplateId,
    requiredCapabilities: input.requiredCapabilities,
    team: input.team,
    registry,
    executionMode: 'MOCK' as const,
  }
  const manual = planTask({
    ...common,
    source: { type: 'user' },
  })
  const routine = planTask({
    ...common,
    source: {
      type: 'routine',
      routineId: 'rtn_fixture',
      routineRunId: 'run_fixture',
    },
  })
  return { manual, routine }
}

// ——— A: BUILD ———
{
  const team = registry.filter((a) =>
    ['product-manager', 'frontend-developer', 'code-reviewer'].includes(a.id),
  )
  const { manual, routine } = planBoth({
    request: '로그인 화면 구현해줘',
    preferredTemplateId: 'FEATURE_BUILD',
    team,
  })
  eq(planFingerprint(manual), planFingerprint(routine), 'A fingerprint')
  eq(manual.workflowTemplateId, 'FEATURE_BUILD', 'A template')
  assert(manual.safety.applied, 'A safety')
  assert(
    manual.steps.some((s) => s.provider === 'codex' && s.mode === 'implement'),
    'A implement',
  )
  assert(
    manual.steps.some((s) => s.provider === 'human' && s.approvalKind === 'change'),
    'A approval',
  )
  assert(manual.source.type === 'user', 'A manual source')
  assert(routine.source.type === 'routine', 'A routine source')
  console.log('TEST A PASS')
}

// ——— B: GAME_PROTOTYPE ———
{
  const team = registry.filter((a) =>
    [
      'product-manager',
      'game-designer',
      'frontend-developer',
      'code-reviewer',
      'reality-checker',
    ].includes(a.id),
  )
  const { manual, routine } = planBoth({
    request: '캐주얼 게임 프로토타입 만들어',
    preferredTemplateId: 'GAME_PROTOTYPE',
    team,
    projectType: 'mobile-game',
  })
  eq(planFingerprint(manual), planFingerprint(routine), 'B fingerprint')
  eq(manual.workflowTemplateId, 'GAME_PROTOTYPE', 'B template')
  console.log('TEST B PASS')
}

// ——— C: Marketing ———
{
  const team = registry.filter((a) =>
    ['product-manager', 'growth-hacker', 'content-creator', 'trend-researcher'].includes(
      a.id,
    ),
  )
  const { manual, routine } = planBoth({
    request: '이 앱 마케팅 전략 만들어',
    preferredTemplateId: 'MARKETING_CAMPAIGN',
    team,
  })
  eq(planFingerprint(manual), planFingerprint(routine), 'C fingerprint')
  eq(manual.workflowTemplateId, 'MARKETING_CAMPAIGN', 'C template')
  assert(
    manual.requiredCapabilities.includes('marketing.plan'),
    'C marketing.plan',
  )
  console.log('TEST C PASS')
}

// ——— D: Specialist ———
{
  // Core team: only product-manager — no marketing agents
  const team = registry.filter((a) => a.id === 'product-manager')
  const { manual, routine } = planBoth({
    request: '이 앱 마케팅 전략 만들어',
    preferredTemplateId: 'MARKETING_CAMPAIGN',
    team,
  })
  eq(planFingerprint(manual), planFingerprint(routine), 'D fingerprint')
  const specialists = manual.agentAssignments.filter(
    (a) => a.source === 'specialist',
  )
  assert(specialists.length > 0, 'D specialist chosen')
  eq(
    JSON.stringify(manual.agentAssignments),
    JSON.stringify(routine.agentAssignments),
    'D same assignments',
  )
  console.log('TEST D PASS', {
    specialists: specialists.map((s) => s.agentId),
  })
}

// ——— E: Missing Tool ———
{
  const team = registry.filter((a) => a.id === 'product-manager')
  const { manual, routine } = planBoth({
    request: '프로모션 이미지 생성',
    preferredTemplateId: 'MARKETING_CAMPAIGN',
    requiredCapabilities: ['image.generate'],
    team,
  })
  eq(planFingerprint(manual), planFingerprint(routine), 'E fingerprint')
  assert(
    manual.capabilityConflicts.some((c) => c.capability === 'image.generate'),
    'E conflict image.generate',
  )
  assert(
    routine.capabilityConflicts.some((c) => c.capability === 'image.generate'),
    'E routine conflict',
  )
  eq(
    JSON.stringify(manual.capabilityConflicts),
    JSON.stringify(routine.capabilityConflicts),
    'E same conflicts',
  )
  console.log('TEST E PASS')
}

// ——— F: Safety ———
{
  const team = registry.filter((a) =>
    [
      'product-manager',
      'frontend-developer',
      'code-reviewer',
      'devops-automator',
      'reality-checker',
    ].includes(a.id),
  )
  const { manual, routine } = planBoth({
    request: '코드 수정 기능 구현',
    preferredTemplateId: 'FEATURE_BUILD',
    requiredCapabilities: ['code.write'],
    team,
  })
  eq(planFingerprint(manual), planFingerprint(routine), 'F fingerprint')
  assert(manual.safety.applied, 'F safety applied')
  eq(
    JSON.stringify(manual.safety),
    JSON.stringify(routine.safety),
    'F same safety',
  )
  const labels = manual.steps.map((s) => s.label)
  assert(
    labels.some((l) => /승인|확인/.test(l)),
    'F approval step',
  )
  assert(
    manual.steps.some((s) => s.mode === 'verify'),
    'F verify',
  )
  console.log('TEST F PASS', { preview: manual.preview })
}

console.log('canonicalPlanning fixtures: ALL PASS')
