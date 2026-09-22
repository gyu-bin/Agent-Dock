/**
 * MVP Cleanup — Full Mock Happy Path E2E (no OpenAI / Web Search / Codex).
 *
 *   node --import tsx tools/mvp-mock-e2e.mts
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MOCK_REGISTRY } from '../client/src/data/mockRegistry.ts'
import { selectWorkflowTemplate } from '../client/src/domain/templateSelector.ts'
import {
  previewLabels,
  resolveTemplateToSteps,
} from '../client/src/domain/templateSelector.ts'
import {
  userFacingErrorMessage,
  userFacingTaskStatus,
  userFacingWorkflowLabel,
} from '../client/src/domain/taskDisplay.ts'
import { isFixtureProjectName } from '../client/src/domain/demoData.ts'
import {
  resolveModelForStep,
  selectModelProfileId,
  DEFAULT_MODEL_PROFILES,
} from '../client/src/domain/modelProfileRouting.ts'
import { MockExecutionEngine } from '../client/src/engine/mockExecutionEngine.ts'
import type {
  AgentRun,
  CodexRun,
  PipelineStep,
  Task,
} from '../client/src/domain/types.ts'
import { JsonKnowledgeRepository } from '../server/src/persistence/knowledgeRepository.ts'
import { KnowledgeService } from '../server/src/persistence/knowledgeService.ts'
import {
  formatKnowledgeExcerpts,
  selectRelevantKnowledge,
} from '../server/src/ai/knowledgeContext.ts'
import { resolveModelFromSettings } from '../server/src/ai/modelProfileRouting.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TMP = path.join(ROOT, '.tmp', `mvp-mock-e2e-${Date.now().toString(36)}`)

type Result = { name: string; ok: boolean; detail?: string }
const results: Result[] = []

function record(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function fileContains(rel: string, needles: string[]): Promise<boolean> {
  const raw = await readFile(path.join(ROOT, rel), 'utf8')
  return needles.every((n) => raw.includes(n))
}

async function fileLacks(rel: string, needles: string[]): Promise<boolean> {
  const raw = await readFile(path.join(ROOT, rel), 'utf8')
  return needles.every((n) => !raw.includes(n))
}

function makeStore() {
  let tasks: Task[] = []
  let steps: PipelineStep[] = []
  let agentRuns: AgentRun[] = []
  let codexRuns: CodexRun[] = []
  const runtime: Record<
    string,
    {
      status: string
      currentTaskId?: string
      currentTaskLabel?: string
      speech?: string
    }
  > = {}
  const snapshots: Array<{
    tasks: Task[]
    steps: PipelineStep[]
    codexRuns: CodexRun[]
  }> = []

  return {
    getTasks: () => tasks,
    getSteps: () => steps,
    getAgentRuntime: () => runtime as never,
    getAgentRuns: () => agentRuns,
    getCodexRuns: () => codexRuns,
    patchTask: (id: string, patch: Partial<Task>) => {
      tasks = tasks.map((t) => (t.id === id ? { ...t, ...patch } : t))
    },
    patchStep: (id: string, patch: Partial<PipelineStep>) => {
      steps = steps.map((s) => (s.id === id ? { ...s, ...patch } : s))
    },
    setAgentRuntime: (agentId: string, patch: (typeof runtime)[string]) => {
      runtime[agentId] = { ...(runtime[agentId] ?? { status: 'idle' }), ...patch }
    },
    upsertAgentRun: (run: AgentRun) => {
      const i = agentRuns.findIndex((r) => r.id === run.id)
      if (i >= 0) agentRuns[i] = run
      else agentRuns.push(run)
    },
    upsertCodexRun: (run: CodexRun) => {
      const i = codexRuns.findIndex((r) => r.id === run.id)
      if (i >= 0) codexRuns[i] = run
      else codexRuns.push(run)
    },
    persistSoon: () => {
      snapshots.push({
        tasks: structuredClone(tasks),
        steps: structuredClone(steps),
        codexRuns: structuredClone(codexRuns),
      })
    },
    seedTask(task: Task, pipeline: PipelineStep[]) {
      tasks = [...tasks, task]
      steps = [...steps, ...pipeline]
    },
    restore(snap: {
      tasks: Task[]
      steps: PipelineStep[]
      codexRuns: CodexRun[]
    }) {
      tasks = structuredClone(snap.tasks)
      steps = structuredClone(snap.steps)
      codexRuns = structuredClone(snap.codexRuns)
    },
    get snapshots() {
      return snapshots
    },
  }
}

async function waitFor(
  pred: () => boolean,
  timeoutMs = 15000,
  interval = 40,
): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (pred()) return true
    await sleep(interval)
  }
  return pred()
}

async function main() {
  await mkdir(TMP, { recursive: true })

  // ── UI cleanup surface checks ──
  {
    const ok =
      (await fileLacks('client/src/panels/AiChatPanel.tsx', [
        'promptBanner',
        '하고 싶은 일을 한 줄로 말해 주세요',
      ])) &&
      (await fileLacks('client/src/layout/TopBar.tsx', [
        'formatClock',
        'pillOffline',
      ])) &&
      (await fileContains('client/src/domain/demoData.ts', [
        'isFixtureProjectName',
      ])) &&
      (await fileContains('client/src/layout/AppShell.tsx', [
        'TasksPage',
        'pagePane',
      ])) &&
      (await fileLacks('client/src/layout/AppShell.tsx', [
        'BottomPanel',
        'TaskDetailPanel',
        'ArtifactDetailPanel',
      ])) &&
      (await fileContains('client/src/layout/Sidebar.tsx', [
        'AI 설정 필요',
        'AI 준비됨',
      ])) &&
      (await fileLacks('client/src/layout/Sidebar.tsx', [
        'MOCK 모드',
        'Mock Mode',
      ]))
    record('UI cleanup surfaces', ok)
  }

  // ── Model profile routing ──
  {
    const fast = selectModelProfileId({ purpose: 'intent' })
    const standard = selectModelProfileId({
      agentId: 'trend-researcher',
      role: 'research',
    })
    const reasoning = selectModelProfileId({
      agentId: 'reality-checker',
      role: 'reality',
    })
    const custom = resolveModelForStep(
      {
        ...DEFAULT_MODEL_PROFILES,
        REASONING: { ...DEFAULT_MODEL_PROFILES.REASONING, model: 'gpt-custom-reason' },
      },
      {
        agentId: 'game-designer',
        role: 'game-designer',
        label: '게임 기획',
        mode: 'plan',
      },
    )
    const serverSide = resolveModelFromSettings(
      { REASONING: { model: 'gpt-server-reason' } },
      { role: 'reality-checker', stepLabel: '현실성 검증' },
    )
    record(
      'Model Profile routing',
      fast === 'FAST' &&
        standard === 'STANDARD' &&
        reasoning === 'REASONING' &&
        custom.model === 'gpt-custom-reason' &&
        serverSide.model === 'gpt-server-reason',
      `fast=${fast} std=${standard} reason=${reasoning} custom=${custom.model}`,
    )
  }

  // ── Full Mock Happy Path ──
  {
    const store = makeStore()
    const engine = new MockExecutionEngine(store)
    engine.setSpeed(8)

    const request = '로그인 기능 만들어줘'
    const selection = selectWorkflowTemplate({
      request,
      projectType: 'web-app',
    })
    const team = MOCK_REGISTRY.filter((a) =>
      [
        'product-manager',
        'frontend-developer',
        'code-reviewer',
        'reality-checker',
        'api-tester',
        'ux-researcher',
      ].includes(a.id),
    )
    const resolved = resolveTemplateToSteps({
      template: selection.template,
      request,
      team,
      registry: MOCK_REGISTRY,
    })
    const preview = previewLabels(resolved.steps)
    const softPreview =
      preview.every((p) => !/[👤💻🧪🔍✅]/.test(p)) &&
      !preview.some((p) => /변경 승인/.test(p)) &&
      preview.some((p) => /변경 확인|기능 기획|구현|검증/.test(p))

    const now = new Date().toISOString()
    const taskId = 'task_mvp_login'
    const pipeline: PipelineStep[] = resolved.steps.map((s, i) => ({
      id: `step_${i + 1}`,
      taskId,
      order: i + 1,
      agentId: s.agentId,
      label: s.label,
      status: 'queued',
      provider: s.provider,
      mode: s.mode,
      approvalKind: s.approvalKind,
      role: s.role,
      outputArtifactType: s.outputArtifactType,
      inputArtifactTypes: s.inputArtifactTypes,
      requiresWebSearch: s.requiresWebSearch,
    }))
    const task: Task = {
      id: taskId,
      projectId: 'proj_mvp',
      title: request,
      description: request,
      status: 'queued',
      workflow: selection.template.workflowKind,
      workflowTemplateId: selection.template.id,
      workflowPreview: preview,
      priority: 'normal',
      assignedAgentIds: [...new Set(pipeline.map((p) => p.agentId))],
      recommendedExtraAgentIds: [],
      progress: 0,
      createdAt: now,
      updatedAt: now,
      executionMode: 'MOCK',
    }
    store.seedTask(task, pipeline)
    engine.execute(taskId)

    const hitChangeApproval = await waitFor(() => {
      const t = store.getTasks().find((x) => x.id === taskId)
      return (
        t?.status === 'awaiting_approval' && t.approval?.kind === 'change'
      )
    })

    const atApproval = store.getTasks().find((t) => t.id === taskId)!
    const runs = store.getCodexRuns().filter((r) => r.taskId === taskId)
    const hasDiff = Boolean(runs.at(-1)?.unifiedDiff?.includes('LoginForm'))
    const inboxLabel = userFacingTaskStatus(atApproval, null)
    const chip = userFacingWorkflowLabel(atApproval)

    // Simulate reload persistence mid-approval
    const snap = {
      tasks: structuredClone(store.getTasks()),
      steps: structuredClone(store.getSteps()),
      codexRuns: structuredClone(store.getCodexRuns()),
    }
    await writeFile(path.join(TMP, 'persist.json'), JSON.stringify(snap))
    const reloaded = JSON.parse(
      await readFile(path.join(TMP, 'persist.json'), 'utf8'),
    ) as typeof snap
    store.restore({ tasks: [], steps: [], codexRuns: [] })
    store.restore(reloaded)
    const afterReload = store.getTasks().find((t) => t.id === taskId)

    // Approve change — keep awaiting_approval until engine.resume accepts approved gate
    const approvalStepId = afterReload?.approval?.stepId
    store.patchTask(taskId, {
      approval: {
        ...(afterReload!.approval!),
        status: 'approved',
        decidedAt: new Date().toISOString(),
      },
    })
    if (approvalStepId) {
      store.patchStep(approvalStepId, {
        status: 'completed',
        completedAt: new Date().toISOString(),
      })
    }
    engine.resume(taskId)

    const completed = await waitFor(() => {
      const t = store.getTasks().find((x) => x.id === taskId)
      return t?.status === 'completed' && Boolean(t.finalResult)
    }, 20000)

    const done = store.getTasks().find((t) => t.id === taskId)
    record(
      'Full Mock Happy Path',
      hitChangeApproval &&
        hasDiff &&
        inboxLabel === '승인 대기' &&
        chip === '기능 개발' &&
        afterReload?.status === 'awaiting_approval' &&
        (afterReload.approval?.kind === 'change') &&
        completed &&
        Boolean(done?.finalResult) &&
        softPreview &&
        preview.length >= 4,
      `approval=${hitChangeApproval} diff=${hasDiff} done=${done?.status} steps=${preview.length}`,
    )
    engine.dispose()
  }

  // ── Knowledge Happy Path ──
  {
    const dir = path.join(TMP, 'knowledge')
    await mkdir(dir, { recursive: true })
    const repo = new JsonKnowledgeRepository(dir)
    const svc = new KnowledgeService(repo)
    const projectId = 'proj_mvp_know'
    const proposed = await svc.createProposed({
      projectId,
      category: 'constraint',
      title: '모바일 우선',
      content: '이 프로젝트는 모바일 우선으로 개발한다',
      createdBy: 'user',
      sourceArtifactIds: ['art_fixture_mobile'],
    })
    const confirmed = await svc.confirm(projectId, proposed.item.id)
    const listed = await svc.list({ projectId, status: 'confirmed' })
    const selected = selectRelevantKnowledge({
      items: listed,
      stepTask: '로그인 기능 구현',
      userRequest: '로그인 기능 만들어줘',
      preferredCategories: ['constraint'],
    })
    const block = formatKnowledgeExcerpts(selected.selected)
    record(
      'Knowledge Happy Path',
      confirmed.status === 'confirmed' &&
        listed.length >= 1 &&
        selected.selected.length >= 1 &&
        block.includes('모바일 우선'),
      `confirmed=${confirmed.status} selected=${selected.selected.length}`,
    )
  }

  // ── Research fixture Happy Path ──
  {
    const researchArtifact = {
      type: 'research',
      title: '최근 시장 조사',
      content: [
        '요약: 모바일 로그인 UX는 생체인증 채택이 늘고 있다.',
        'Sources:',
        '[1] Example Market Report — https://example.com/market',
      ].join('\n'),
      sources: [
        {
          id: 'cite_1',
          title: 'Example Market Report',
          url: 'https://example.com/market',
          domain: 'example.com',
          snippet: 'biometric login adoption',
        },
      ],
    }
    const handoff = {
      from: 'trend-researcher',
      to: 'product-manager',
      summary: researchArtifact.content.slice(0, 120),
      citationIds: researchArtifact.sources.map((s) => s.id),
    }
    record(
      'Research fixture Happy Path',
      researchArtifact.sources.length === 1 &&
        handoff.citationIds.includes('cite_1') &&
        /시장 조사/.test(researchArtifact.title),
      `sources=${researchArtifact.sources.length}`,
    )
  }

  // ── Error / Retry Happy Path ──
  {
    const store = makeStore()
    const engine = new MockExecutionEngine(store)
    engine.setSpeed(8)
    const now = new Date().toISOString()
    const taskId = 'task_mvp_fail'
    const steps: PipelineStep[] = [
      {
        id: 's1',
        taskId,
        order: 1,
        agentId: 'frontend-developer',
        label: '구현',
        status: 'queued',
        provider: 'mock',
        mode: 'implement',
      },
    ]
    store.seedTask(
      {
        id: taskId,
        projectId: 'proj_mvp',
        title: '실패 재시도',
        description: 'fail then retry',
        status: 'queued',
        workflow: 'BUILD',
        priority: 'normal',
        assignedAgentIds: ['frontend-developer'],
        recommendedExtraAgentIds: [],
        progress: 0,
        createdAt: now,
        updatedAt: now,
        executionMode: 'MOCK',
        simulateFailure: true,
      },
      steps,
    )
    engine.execute(taskId)
    const failed = await waitFor(() => {
      const t = store.getTasks().find((x) => x.id === taskId)
      return t?.status === 'blocked'
    })
    const friendly = userFacingErrorMessage('Codex CLI failed with ECONNRESET')
    store.patchTask(taskId, {
      simulateFailure: false,
    })
    store.patchStep('s1', { status: 'queued', completedAt: undefined })
    engine.resume(taskId)
    const ok = await waitFor(() => {
      const t = store.getTasks().find((x) => x.id === taskId)
      return t?.status === 'completed'
    })
    record(
      'Error/Retry Happy Path',
      failed &&
        ok &&
        friendly.includes('Codex') &&
        !friendly.toLowerCase().includes('econnreset'),
      friendly,
    )
    engine.dispose()
  }

  // ── Fixture project naming ──
  {
    record(
      'Demo/Test data filter',
      isFixtureProjectName('F2 Test A 123') &&
        isFixtureProjectName('F3 Bug 999') &&
        !isFixtureProjectName('Steam Arena') &&
        !isFixtureProjectName('Mobile Wallet'),
    )
  }

  // ── projects.json cleaned ──
  {
    const raw = JSON.parse(
      await readFile(path.join(ROOT, 'server/data/projects.json'), 'utf8'),
    ) as { projects: Array<{ name: string }> }
    const dirty = raw.projects.filter((p) => isFixtureProjectName(p.name))
    record(
      'projects.json demo-only',
      dirty.length === 0 &&
        raw.projects.some((p) => /steam arena/i.test(p.name)),
      `projects=${raw.projects.map((p) => p.name).join(', ')}`,
    )
  }

  const failed = results.filter((r) => !r.ok)
  console.log('\n── MVP Mock E2E summary ──')
  console.log(`passed=${results.length - failed.length} failed=${failed.length}`)
  await rm(TMP, { recursive: true, force: true }).catch(() => undefined)
  if (failed.length) {
    for (const f of failed) console.log(`  FAIL ${f.name}: ${f.detail ?? ''}`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
