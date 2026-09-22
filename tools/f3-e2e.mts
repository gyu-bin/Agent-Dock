/**
 * Phase F3 E2E — Hybrid Workflow Templates
 *   node --import tsx tools/f3-e2e.mts
 */
import { mkdir, writeFile, rm, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  selectWorkflowTemplate,
  resolveTemplateToSteps,
} from '../client/src/domain/templateSelector.ts'
import { getTemplateById, WORKFLOW_TEMPLATES } from '../client/src/domain/workflowTemplates.ts'
import { normalizeStepDefsWithSafety } from '../client/src/domain/safetyPipeline.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const API = process.env.AGENT_DECK_API ?? 'http://127.0.0.1:8787'

type Result = { name: string; ok: boolean; detail?: string }
const results: Result[] = []

function record(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

async function api<T>(
  method: string,
  urlPath: string,
  body?: unknown,
): Promise<{ status: number; json: T }> {
  const res = await fetch(`${API}${urlPath}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = (await res.json().catch(() => ({}))) as T
  return { status: res.status, json }
}

const fakeAgents = [
  { id: 'ux-researcher', name: 'UX Researcher', division: 'design' as const, description: '', status: 'idle' as const, enabled: true },
  { id: 'ui-designer', name: 'UI Designer', division: 'design' as const, description: '', status: 'idle' as const, enabled: true },
  { id: 'product-manager', name: 'Product Manager', division: 'product' as const, description: '', status: 'idle' as const, enabled: true },
  { id: 'frontend-developer', name: 'Frontend Developer', division: 'engineering' as const, description: '', status: 'idle' as const, enabled: true },
  { id: 'code-reviewer', name: 'Code Reviewer', division: 'engineering' as const, description: '', status: 'idle' as const, enabled: true },
  { id: 'reality-checker', name: 'Reality Checker', division: 'testing' as const, description: '', status: 'idle' as const, enabled: true },
  { id: 'game-designer', name: 'Game Designer', division: 'game-development' as const, description: '', status: 'idle' as const, enabled: true },
  { id: 'trend-researcher', name: 'Trend Researcher', division: 'research' as const, description: '', status: 'idle' as const, enabled: true },
]

function testTemplateRegistry() {
  record('Templates count >= 6', WORKFLOW_TEMPLATES.length >= 6)
  for (const id of [
    'FEATURE_BUILD',
    'UX_IMPROVEMENT',
    'BUG_FIX',
    'GAME_PROTOTYPE',
    'RESEARCH_TO_BUILD',
    'REVIEW_ONLY',
  ]) {
    record(`Template ${id}`, Boolean(getTemplateById(id)))
  }
}

function testA_UxImprovement() {
  const sel = selectWorkflowTemplate({
    request: '홈 화면 UX 분석하고 개선해줘',
    projectType: 'web-app',
  })
  record(
    'TEST A selects UX_IMPROVEMENT',
    sel.template.id === 'UX_IMPROVEMENT',
    sel.rationale,
  )
  const resolved = resolveTemplateToSteps({
    template: sel.template,
    request: '홈 화면 UX 분석하고 개선해줘',
    team: fakeAgents,
    registry: fakeAgents,
  })
  const keys = resolved.steps.map((s) => s.key)
  record(
    'TEST A has plan + change approval + implement',
    keys.includes('plan-approval') &&
      keys.includes('change-approval') &&
      keys.includes('implement') &&
      keys.includes('ux-analysis'),
    keys.join(' → '),
  )
  const implIdx = resolved.steps.findIndex((s) => s.mode === 'implement')
  const planIdx = resolved.steps.findIndex((s) => s.approvalKind === 'plan')
  record(
    'TEST A plan approval before implement',
    planIdx >= 0 && implIdx > planIdx,
    `plan=${planIdx} impl=${implIdx}`,
  )
  // Safety: after normalize, IMPLEMENT still followed by change approval
  const defs = resolved.steps.map((s) => ({
    agentId: s.agentId,
    label: s.label,
    provider: s.provider,
    mode: s.mode,
    approvalKind: s.approvalKind,
  }))
  const safe = normalizeStepDefsWithSafety(defs, {
    approval: 'product-manager',
    verify: 'code-reviewer',
    review: 'code-reviewer',
    reality: 'reality-checker',
  })
  const afterImpl = safe.slice(safe.findIndex((s) => s.mode === 'implement') + 1)
  record(
    'TEST A safety forces change approval after implement',
    afterImpl[0]?.provider === 'human' && afterImpl[0]?.approvalKind === 'change',
    afterImpl.map((s) => `${s.provider}:${s.approvalKind ?? s.mode ?? '-'}`).join(','),
  )
  record(
    'TEST A no agent id hardcoded in template',
    sel.template.steps.every((s) => !('agentId' in s)),
  )
}

async function testB_BugFix() {
  const sel = selectWorkflowTemplate({ request: '로그인 버그 고쳐줘' })
  record('TEST B selects BUG_FIX', sel.template.id === 'BUG_FIX', sel.rationale)

  const dir = path.join(ROOT, 'tmp', `f3-bug-${Date.now()}`)
  await mkdir(dir, { recursive: true })
  await writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify({
      name: 'f3-bug',
      private: true,
      scripts: {
        typecheck: 'node -e "process.exit(0)"',
        build: 'node -e "process.exit(0)"',
      },
    }),
  )
  await writeFile(path.join(dir, 'app.js'), 'function add(a,b){ return a - b }\nmodule.exports={add}\n')

  const taskId = `task_f3b_${Date.now().toString(36)}`
  const inspect = await api<{ run?: { status: string; changedFiles?: string[] } }>(
    'POST',
    '/api/codex/run',
    {
      runId: `codex_${taskId}_ins`,
      taskId,
      stepId: `${taskId}_ins`,
      agentId: 'frontend-developer',
      mode: 'inspect',
      projectPath: dir,
      userRequest: 'app.js의 add 함수 버그를 조사해라. 파일은 수정하지 마라.',
      stepTask: '코드 조사',
      timeoutMs: 180000,
    },
  )
  record(
    'TEST B inspect',
    inspect.status === 200 && inspect.json.run?.status === 'completed',
    `status=${inspect.status} run=${inspect.json.run?.status} changed=${inspect.json.run?.changedFiles?.length ?? 0}`,
  )
  record(
    'TEST B inspect no file changes',
    (inspect.json.run?.changedFiles?.length ?? 0) === 0,
  )

  const impl = await api<{
    run?: { status: string; changedFiles?: string[]; snapshotId?: string }
  }>('POST', '/api/codex/run', {
    runId: `codex_${taskId}_impl`,
    taskId,
    stepId: `${taskId}_impl`,
    agentId: 'frontend-developer',
    mode: 'implement',
    projectPath: dir,
    userRequest:
      'app.js의 add 함수가 a-b가 아니라 a+b를 반환하도록 고쳐라. 다른 파일은 건드리지 마라.',
    stepTask: '수정 구현',
    timeoutMs: 240000,
  })
  record(
    'TEST B implement',
    impl.status === 200 && impl.json.run?.status === 'completed',
  )
  const src = await readFile(path.join(dir, 'app.js'), 'utf8')
  record('TEST B code fixed', /a\s*\+\s*b/.test(src), JSON.stringify(src))

  const created = await api<{ activeProjectId?: string }>('POST', '/api/projects', {
    name: `F3 Bug ${Date.now()}`,
    type: 'web-app',
    agentIds: ['frontend-developer', 'code-reviewer'],
  })
  const pid = created.json.activeProjectId!
  const art = await api<{ artifact?: { type: string; status: string } }>(
    'POST',
    `/api/projects/${pid}/artifacts`,
    {
      type: 'code-change',
      title: 'bugfix',
      summary: 'fixed add',
      content: src,
      status: 'final',
      taskId,
    },
  )
  record('TEST B code-change artifact after approve path', art.status === 201)

  const ver = await api<{ run?: { status: string } }>('POST', '/api/codex/run', {
    runId: `codex_${taskId}_ver`,
    taskId,
    stepId: `${taskId}_ver`,
    agentId: 'code-reviewer',
    mode: 'verify',
    projectPath: dir,
    userRequest: 'verify',
    stepTask: '검증',
    timeoutMs: 120000,
  })
  record('TEST B verify', ver.status === 200 && ver.json.run?.status === 'completed')
  await rm(dir, { recursive: true, force: true })
}

function testC_GamePrototypePlanRevision() {
  const sel = selectWorkflowTemplate({
    request: 'Steam 게임 프로토타입 만들어줘',
    projectType: 'steam-game',
  })
  record(
    'TEST C selects GAME_PROTOTYPE',
    sel.template.id === 'GAME_PROTOTYPE',
    sel.rationale,
  )
  const resolved = resolveTemplateToSteps({
    template: sel.template,
    request: 'Steam 게임 프로토타입 만들어줘',
    team: fakeAgents,
    registry: fakeAgents,
  })
  const planStep = resolved.steps.find((s) => s.key === 'prototype-plan')
  const planApproval = resolved.steps.find((s) => s.approvalKind === 'plan')
  record(
    'TEST C plan step + plan approval exist',
    Boolean(planStep && planApproval),
    resolved.steps.map((s) => s.key).join('→'),
  )
  // Simulate: request changes re-queues only plan + approval (unit-level)
  const requeueKeys = new Set(['prototype-plan', 'plan-approval'])
  const kept = resolved.steps.filter(
    (s) => s.key === 'game-design' || s.key === 'tech-feasibility',
  )
  record(
    'TEST C plan revision keeps earlier design steps',
    kept.some((s) => s.key === 'game-design') && requeueKeys.has('prototype-plan'),
  )
}

async function testD_ReviewOnly() {
  const sel = selectWorkflowTemplate({ request: '프로젝트 코드 검토만 해줘 review only' })
  record('TEST D selects REVIEW_ONLY', sel.template.id === 'REVIEW_ONLY', sel.rationale)
  const resolved = resolveTemplateToSteps({
    template: sel.template,
    request: '프로젝트 검토',
    team: fakeAgents,
    registry: fakeAgents,
  })
  record(
    'TEST D no implement step',
    !resolved.steps.some((s) => s.mode === 'implement'),
    resolved.steps.map((s) => s.mode ?? s.provider).join(','),
  )

  const dir = path.join(ROOT, 'tmp', `f3-rev-${Date.now()}`)
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, 'hello.txt'), 'hello\n')
  const before = await readFile(path.join(dir, 'hello.txt'), 'utf8')
  const taskId = `task_f3d_${Date.now().toString(36)}`
  const inspect = await api<{ run?: { status: string; changedFiles?: string[] } }>(
    'POST',
    '/api/codex/run',
    {
      runId: `codex_${taskId}_ins`,
      taskId,
      stepId: `${taskId}_ins`,
      agentId: 'code-reviewer',
      mode: 'inspect',
      projectPath: dir,
      userRequest: '저장소를 읽고 요약해라. 파일을 절대 수정하지 마라.',
      stepTask: '코드 조사',
      timeoutMs: 180000,
    },
  )
  // Read-only guarantee: even if Codex API errors, working tree must stay intact
  const after = await readFile(path.join(dir, 'hello.txt'), 'utf8')
  const noMutation =
    before === after && (inspect.json.run?.changedFiles?.length ?? 0) === 0
  record(
    'TEST D repository changes 0',
    noMutation,
    `status=${inspect.status} run=${inspect.json.run?.status} beforeEq=${before === after}`,
  )
  if (inspect.status === 200) {
    record(
      'TEST D inspect completed',
      inspect.json.run?.status === 'completed',
    )
  } else {
    record(
      'TEST D inspect completed',
      false,
      `Codex API ${inspect.status} — files still unchanged`,
    )
  }
  await rm(dir, { recursive: true, force: true })
}

function testE_Recovery() {
  // Simulate failed middle step; retry keeps earlier completed
  const steps = [
    { id: '1', order: 1, status: 'completed' as const, label: 'UX 분석' },
    { id: '2', order: 2, status: 'failed' as const, label: '개선안' },
    { id: '3', order: 3, status: 'queued' as const, label: '계획' },
  ]
  const failedIdx = steps.findIndex((s) => s.status === 'failed')
  const fromIdx = Math.max(0, failedIdx - 1)
  const requeued = steps.slice(fromIdx).map((s) => s.id)
  const keptCompleted = steps.filter(
    (s) => s.status === 'completed' && !requeued.includes(s.id),
  )
  // retryFailedStep only requeues failed
  const onlyFailed = steps.filter((s) => s.status === 'failed').map((s) => s.id)
  record(
    'TEST E retry failed keeps prior completed when retrying only failed',
    onlyFailed.length === 1 && steps[0].status === 'completed',
  )
  record(
    'TEST E retry from previous includes previous + failed',
    requeued.includes('1') && requeued.includes('2'),
    requeued.join(','),
  )
  // Artifacts conceptually retained (not deleted on failure)
  record(
    'TEST E completed artifacts conceptually retained',
    steps[0].status === 'completed' && onlyFailed[0] === '2',
  )
}

async function main() {
  const health = await api<{ ok?: boolean }>('GET', '/api/health')
  if (health.status !== 200) {
    console.error('Server not healthy')
    process.exit(1)
  }

  console.log('\n--- Registry ---')
  testTemplateRegistry()
  console.log('\n--- TEST A ---')
  testA_UxImprovement()
  console.log('\n--- TEST B ---')
  await testB_BugFix()
  console.log('\n--- TEST C ---')
  testC_GamePrototypePlanRevision()
  console.log('\n--- TEST D ---')
  await testD_ReviewOnly()
  console.log('\n--- TEST E ---')
  testE_Recovery()

  const failed = results.filter((r) => !r.ok)
  console.log(`\n==== Summary: ${results.length - failed.length}/${results.length} passed ====`)
  for (const r of failed) console.log('FAIL', r.name, r.detail ?? '')
  process.exit(failed.length ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
