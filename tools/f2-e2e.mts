/**
 * Phase F2 E2E — Artifacts, Handoff, Versioning, Persistence, Context budget.
 *
 * Usage (server on :8787):
 *   node --import tsx tools/f2-e2e.mts
 *
 * Env:
 *   F2_SKIP_LIVE_AI=1  — skip TEST A live OpenAI (still runs B/C/D/E API tests)
 */
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildAgentContext,
  CONTEXT_BUDGET,
  selectRelevantArtifacts,
} from '../server/src/ai/contextBuilder.ts'
import {
  buildHandoffFromOutput,
  shouldCreateArtifact,
} from '../server/src/ai/artifactHeuristics.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const API = process.env.AGENT_DECK_API ?? 'http://127.0.0.1:8787'
const SKIP_LIVE = process.env.F2_SKIP_LIVE_AI === '1'

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

async function testA_GameIdea() {
  if (SKIP_LIVE) {
    record('TEST A GAME_IDEA live', false, 'SKIPPED — F2_SKIP_LIVE_AI=1')
    return
  }

  // Use a disposable project id namespace in artifact store (no full UI task)
  const projectId = `proj_f2a_${Date.now().toString(36)}`
  await api('PATCH', `/api/projects/${projectId}/context`, {
    description: 'Steam indie game studio',
    goals: 'Ship a fun niche Steam game',
  }).catch(() => undefined)

  // Ensure project exists via create
  const created = await api<{
    projects?: Array<{ id: string }>
    activeProjectId?: string
  }>('POST', '/api/projects', {
      name: `F2 Test A ${Date.now()}`,
      type: 'steam-game',
      agentIds: [
        'trend-researcher',
        'game-designer',
        'product-manager',
        'reality-checker',
      ],
    },
  )
  const pid = created.json.activeProjectId
  if (!pid) {
    record('TEST A project create', false, JSON.stringify(created.json))
    return
  }
  record('TEST A project create', true, pid)

  const taskId = `task_f2a_${Date.now().toString(36)}`
  const req = '새로운 Steam 게임 아이디어 하나 분석해줘. 짧게.'

  const research = await api<{
    output?: string
    error?: string
    contextMeta?: { includedArtifactIds: string[]; estimatedChars: number }
  }>('POST', '/api/ai/run-step', {
    agentId: 'trend-researcher',
    stepTask: 'Steam 시장 리서치',
    userRequest: req,
    projectId: pid,
    taskId,
    projectType: 'steam-game',
    projectName: 'F2 Test A',
  })
  record(
    'TEST A research step',
    research.status === 200 && Boolean(research.json.output),
    research.json.error,
  )

  const art1 = await api<{ artifact?: { id: string; type: string } }>(
    'POST',
    `/api/projects/${pid}/artifacts`,
    {
      type: 'research',
      title: 'steam-market-research',
      summary: (research.json.output ?? '').slice(0, 200),
      content: research.json.output ?? 'research placeholder long enough ' + 'x'.repeat(100),
      taskId,
      agentId: 'trend-researcher',
      status: 'final',
    },
  )
  record('TEST A Research Artifact', art1.status === 201 && art1.json.artifact?.type === 'research')

  const handoff = await api<{ handoff?: { id: string; artifactIds: string[] } }>(
    'POST',
    `/api/projects/${pid}/handoffs/derive`,
    {
      taskId,
      fromAgentId: 'trend-researcher',
      toAgentId: 'game-designer',
      output: research.json.output ?? 'Decision: niche co-op. Risk: overcrowded. Question: scope?',
      artifactIds: art1.json.artifact ? [art1.json.artifact.id] : [],
    },
  )
  record('TEST A Handoff', handoff.status === 201 && Boolean(handoff.json.handoff?.id))

  const design = await api<{
    output?: string
    contextMeta?: { includedArtifactIds: string[]; estimatedChars: number }
    error?: string
  }>('POST', '/api/ai/run-step', {
    agentId: 'game-designer',
    stepTask: '게임 컨셉 작성',
    userRequest: req,
    projectId: pid,
    taskId,
    projectType: 'steam-game',
    projectName: 'F2 Test A',
    handoffId: handoff.json.handoff?.id,
    previousResult: 'SHOULD_NOT_DOMINATE ' + 'Y'.repeat(5000),
  })
  record(
    'TEST A design step with handoff context',
    design.status === 200 && Boolean(design.json.output),
    design.json.error,
  )
  const included = design.json.contextMeta?.includedArtifactIds ?? []
  record(
    'TEST A next agent received artifact ids in context',
    included.includes(art1.json.artifact!.id) || included.length > 0,
    `included=${included.join(',')}`,
  )

  const art2 = await api<{ artifact?: { id: string } }>(
    'POST',
    `/api/projects/${pid}/artifacts`,
    {
      type: 'design',
      title: 'game-concept',
      summary: (design.json.output ?? '').slice(0, 200),
      content: design.json.output ?? 'design ' + 'x'.repeat(120),
      taskId,
      agentId: 'game-designer',
    },
  )
  record('TEST A Game Design Artifact', art2.status === 201)

  const reality = await api<{ output?: string }>('POST', '/api/ai/run-step', {
    agentId: 'reality-checker',
    stepTask: '현실성 검토',
    userRequest: req,
    projectId: pid,
    taskId,
  })
  const report = await api<{ artifact?: { type: string } }>(
    'POST',
    `/api/projects/${pid}/artifacts`,
    {
      type: 'report',
      title: 'final-report',
      summary: (reality.json.output ?? '').slice(0, 200),
      content: reality.json.output ?? 'report ' + 'x'.repeat(120),
      taskId,
      agentId: 'reality-checker',
    },
  )
  record(
    'TEST A Reality + Final Report Artifact',
    reality.status === 200 && report.status === 201 && report.json.artifact?.type === 'report',
  )

  void projectId
}

async function testB_BuildArtifacts() {
  const created = await api<{
    projects?: Array<{ id: string }>
    activeProjectId?: string
  }>('POST', '/api/projects', {
    name: `F2 Test B ${Date.now()}`,
    type: 'web-app',
    agentIds: ['frontend-developer', 'code-reviewer'],
  })
  const pid = created.json.activeProjectId ?? created.json.projects?.at(-1)?.id
  if (!pid) {
    record('TEST B project', false)
    return
  }

  const taskId = `task_f2b_${Date.now().toString(36)}`
  const dir = path.join(ROOT, 'tmp', `f2-b-${Date.now()}`)
  await mkdir(dir, { recursive: true })
  await writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify({
      name: 'f2-b',
      private: true,
      scripts: { typecheck: 'node -e "process.exit(0)"', build: 'node -e "process.exit(0)"' },
    }),
  )
  await writeFile(path.join(dir, 'NOTE.txt'), 'before\n')

  const impl = await api<{
    run?: {
      status: string
      changedFiles?: string[]
      snapshotId?: string
      unifiedDiff?: string
      summary?: string
      id?: string
    }
    error?: string
  }>('POST', '/api/codex/run', {
    runId: `codex_${taskId}_impl`,
    taskId,
    stepId: `${taskId}_impl`,
    agentId: 'frontend-developer',
    mode: 'implement',
    projectPath: dir,
    userRequest: 'NOTE.txt를 한 줄로: F2 Approved Change\n다른 파일 금지.',
    stepTask: '구현',
    timeoutMs: 240000,
  })
  record(
    'TEST B implement',
    impl.status === 200 && impl.json.run?.status === 'completed',
    impl.json.error,
  )

  // Rejected path: do NOT finalize code-change artifact
  const rejectedDraft = await api<{ artifact?: { id: string; status: string } }>(
    'POST',
    `/api/projects/${pid}/artifacts`,
    {
      type: 'code-change',
      title: 'rejected-draft',
      summary: 'should not stay final',
      content: 'diff placeholder ' + 'x'.repeat(100),
      taskId,
      agentId: 'frontend-developer',
      status: 'rejected',
      metadata: { runId: impl.json.run?.id },
    },
  )
  record('TEST B rejected stored as rejected', rejectedDraft.json.artifact?.status === 'rejected')

  const listRejected = await api<{ artifacts: Array<{ id: string; title: string }> }>(
    'GET',
    `/api/projects/${pid}/artifacts`,
  )
  record(
    'TEST B rejected not in final list',
    !(listRejected.json.artifacts ?? []).some((a) => a.title === 'rejected-draft'),
  )

  // Approved → final code-change
  const approved = await api<{ artifact?: { type: string; status: string } }>(
    'POST',
    `/api/projects/${pid}/artifacts`,
    {
      type: 'code-change',
      title: '코드 변경 — 구현',
      summary: impl.json.run?.summary ?? 'approved',
      content: impl.json.run?.unifiedDiff ?? 'diff ' + 'x'.repeat(100),
      contentType: 'diff',
      taskId,
      agentId: 'frontend-developer',
      status: 'final',
      metadata: {
        changedFiles: impl.json.run?.changedFiles,
        snapshotId: impl.json.run?.snapshotId,
      },
    },
  )
  record(
    'TEST B Code Change Artifact (approved)',
    approved.status === 201 && approved.json.artifact?.status === 'final',
  )

  const ver = await api<{
    run?: { status: string; commands?: Array<{ status: string }>; summary?: string }
  }>('POST', '/api/codex/run', {
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
  const verArt = await api<{ artifact?: { type: string } }>(
    'POST',
    `/api/projects/${pid}/artifacts`,
    {
      type: 'verification',
      title: '검증 결과',
      summary: JSON.stringify(ver.json.run?.commands ?? []),
      content: `# Verification\n${JSON.stringify(ver.json.run?.commands ?? [], null, 2)}`,
      taskId,
      agentId: 'code-reviewer',
    },
  )
  record(
    'TEST B Verify Artifact',
    ver.status === 200 && verArt.status === 201 && verArt.json.artifact?.type === 'verification',
  )

  const rev = await api<{ run?: { status: string; summary?: string } }>('POST', '/api/codex/run', {
    runId: `codex_${taskId}_rev`,
    taskId,
    stepId: `${taskId}_rev`,
    agentId: 'code-reviewer',
    mode: 'review',
    projectPath: dir,
    userRequest: 'review',
    stepTask: '코드 리뷰',
    previousResult: impl.json.run?.unifiedDiff?.slice(0, 4000),
    timeoutMs: 180000,
  })
  const revArt = await api<{ artifact?: { type: string } }>(
    'POST',
    `/api/projects/${pid}/artifacts`,
    {
      type: 'review',
      title: '코드 리뷰',
      summary: (rev.json.run?.summary ?? '').slice(0, 200),
      content: rev.json.run?.summary ?? 'review ' + 'x'.repeat(100),
      taskId,
      agentId: 'code-reviewer',
    },
  )
  const report = await api<{ artifact?: { type: string } }>(
    'POST',
    `/api/projects/${pid}/artifacts`,
    {
      type: 'report',
      title: 'BUILD final report',
      summary: 'done',
      content: 'Final BUILD report ' + 'x'.repeat(100),
      taskId,
    },
  )
  record(
    'TEST B Review + Final Report',
    revArt.status === 201 &&
      report.status === 201 &&
      revArt.json.artifact?.type === 'review' &&
      report.json.artifact?.type === 'report',
  )

  await rm(dir, { recursive: true, force: true })
}

async function testC_Version() {
  const created = await api<{ activeProjectId?: string }>('POST', '/api/projects', {
    name: `F2 Test C ${Date.now()}`,
    type: 'custom',
    agentIds: ['game-designer'],
  })
  const pid = created.json.activeProjectId
  if (!pid) {
    record('TEST C project', false)
    return
  }
  const v1 = await api<{ artifact?: { id: string; familyId: string; version: number } }>(
    'POST',
    `/api/projects/${pid}/artifacts`,
    {
      type: 'design',
      title: 'Game Concept',
      summary: 'v1 concept',
      content: 'Game Concept v1 content ' + 'x'.repeat(80),
      agentId: 'game-designer',
    },
  )
  record('TEST C v1', v1.status === 201 && v1.json.artifact?.version === 1)

  const v2 = await api<{ artifact?: { version: number; familyId: string; id: string } }>(
    'POST',
    `/api/projects/${pid}/artifacts/${v1.json.artifact!.familyId}/versions`,
    {
      content: 'Game Concept v2 after reality feedback ' + 'x'.repeat(80),
      summary: 'v2 concept',
      agentId: 'game-designer',
    },
  )
  record(
    'TEST C v2 created',
    v2.status === 201 &&
      v2.json.artifact?.version === 2 &&
      v2.json.artifact?.familyId === v1.json.artifact?.familyId,
  )

  const detail = await api<{ versions: Array<{ version: number }> }>(
    'GET',
    `/api/projects/${pid}/artifacts/${v1.json.artifact!.id}`,
  )
  record(
    'TEST C v1 retained',
    (detail.json.versions ?? []).some((v) => v.version === 1) &&
      (detail.json.versions ?? []).some((v) => v.version === 2),
    `versions=${(detail.json.versions ?? []).map((v) => v.version).join(',')}`,
  )
}

async function testD_Persistence() {
  const created = await api<{ activeProjectId?: string }>('POST', '/api/projects', {
    name: `F2 Test D ${Date.now()}`,
    type: 'custom',
    agentIds: ['product-manager'],
  })
  const pid = created.json.activeProjectId
  if (!pid) {
    record('TEST D project', false)
    return
  }
  await api('PATCH', `/api/projects/${pid}/context`, {
    description: 'persist me',
    goals: 'survive reload',
  })
  const art = await api<{ artifact?: { id: string } }>('POST', `/api/projects/${pid}/artifacts`, {
    type: 'plan',
    title: 'persist-plan',
    summary: 'persist',
    content: 'plan content ' + 'x'.repeat(100),
  })
  const ho = await api<{ handoff?: { id: string } }>(
    'POST',
    `/api/projects/${pid}/handoffs`,
    {
      taskId: 'task_persist',
      fromAgentId: 'a',
      toAgentId: 'b',
      summary: 'handoff persist',
      decisions: ['d1'],
      openQuestions: [],
      risks: [],
      artifactIds: art.json.artifact ? [art.json.artifact.id] : [],
    },
  )

  // Simulate refresh: re-fetch
  const projects = await api<{
    projects: Array<{ id: string; context?: { description?: string } }>
  }>('GET', '/api/projects')
  const proj = projects.json.projects.find((p) => p.id === pid)
  const arts = await api<{ artifacts: unknown[] }>('GET', `/api/projects/${pid}/artifacts`)
  const hos = await api<{ handoffs: unknown[] }>('GET', `/api/projects/${pid}/handoffs`)

  // Also check file on disk
  const file = path.join(ROOT, 'server/data/artifacts', `${pid}.json`)
  let diskOk = false
  try {
    const raw = await readFile(file, 'utf8')
    diskOk = raw.includes('persist-plan') && raw.includes('handoff persist')
  } catch {
    diskOk = false
  }

  record(
    'TEST D Persistence',
    proj?.context?.description === 'persist me' &&
      (arts.json.artifacts?.length ?? 0) >= 1 &&
      (hos.json.handoffs?.length ?? 0) >= 1 &&
      diskOk &&
      Boolean(ho.json.handoff?.id),
    `disk=${diskOk}`,
  )
}

async function testE_ContextBudget() {
  const arts = Array.from({ length: 8 }, (_, i) => ({
    id: `art_${i}`,
    familyId: `fam_${i}`,
    projectId: 'p',
    type: 'document' as const,
    title: `Doc ${i}`,
    summary: 's',
    contentType: 'markdown' as const,
    content: `CONTENT_${i}_` + 'Z'.repeat(3000),
    version: 1,
    status: 'final' as const,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    taskId: i < 2 ? 'task1' : 'other',
  }))

  const { selected, omitted } = selectRelevantArtifacts({
    taskArtifacts: arts.filter((a) => a.taskId === 'task1'),
    allProjectArtifacts: arts,
    max: CONTEXT_BUDGET.maxArtifacts,
  })
  record(
    'TEST E selectRelevantArtifacts caps',
    selected.length <= CONTEXT_BUDGET.maxArtifacts && omitted >= 0,
    `selected=${selected.length} omitted=${omitted}`,
  )

  const built = buildAgentContext({
    projectName: 'P',
    projectType: 'custom',
    projectContext: {
      description: 'D'.repeat(5000),
      goals: 'G'.repeat(2000),
    },
    userRequest: 'U'.repeat(5000),
    stepTask: 'step',
    taskArtifacts: arts,
    allProjectArtifacts: arts,
    previousResult: 'PREV'.repeat(5000),
    handoff: {
      id: 'ho',
      projectId: 'p',
      taskId: 'task1',
      fromAgentId: 'a',
      toAgentId: 'b',
      summary: 'H'.repeat(3000),
      decisions: [],
      openQuestions: [],
      risks: [],
      artifactIds: arts.slice(0, 2).map((a) => a.id),
      createdAt: new Date().toISOString(),
    },
  })

  record(
    'TEST E not all artifacts included',
    built.includedArtifactIds.length <= CONTEXT_BUDGET.maxArtifacts &&
      built.includedArtifactIds.length < arts.length,
    `included=${built.includedArtifactIds.length}/${arts.length} chars=${built.estimatedChars}`,
  )
  record(
    'TEST E previousResult abbreviated when handoff present',
    built.previousBlock.length < 500,
    `prevLen=${built.previousBlock.length}`,
  )
  record(
    'TEST E heuristics skip tiny output',
    !shouldCreateArtifact({ output: 'ok', agentId: 'x' }) &&
      shouldCreateArtifact({ output: 'x'.repeat(200), agentId: 'trend-researcher' }),
  )

  const derived = buildHandoffFromOutput({
    projectId: 'p',
    taskId: 't',
    fromAgentId: 'a',
    toAgentId: 'b',
    output:
      'We recommend niche co-op.\nDecision: go midcore.\nRisk: discovery.\nOpen question: budget?\n' +
      'x'.repeat(100),
    artifactIds: ['art_0'],
  })
  record(
    'TEST E handoff derive without LLM',
    derived.summary.length > 10 && derived.artifactIds.includes('art_0'),
  )

  // Live API build-context
  const live = await api<{
    context?: { includedArtifactIds: string[]; omittedArtifactCount: number }
  }>('POST', '/api/ai/build-context', {
    userRequest: 'test',
    stepTask: 'step',
    previousResult: 'P'.repeat(8000),
  })
  record('TEST E build-context API', live.status === 200 && Boolean(live.json.context))
}

async function main() {
  const health = await api<{ ok?: boolean }>('GET', '/api/health')
  if (health.status !== 200) {
    console.error('Server not healthy')
    process.exit(1)
  }

  console.log('\n--- TEST A ---')
  await testA_GameIdea()
  console.log('\n--- TEST B ---')
  await testB_BuildArtifacts()
  console.log('\n--- TEST C ---')
  await testC_Version()
  console.log('\n--- TEST D ---')
  await testD_Persistence()
  console.log('\n--- TEST E ---')
  await testE_ContextBudget()

  const failed = results.filter((r) => !r.ok)
  console.log(`\n==== Summary: ${results.length - failed.length}/${results.length} passed ====`)
  for (const r of failed) console.log('FAIL', r.name, r.detail ?? '')
  process.exit(failed.length ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
