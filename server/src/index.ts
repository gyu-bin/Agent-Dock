import express from 'express'
import cors from 'cors'
import { loadDotEnv } from './loadEnv.js'

loadDotEnv()

import { loadAgentRegistry } from './registry/loadAgents.js'
import { createAiProvider } from './providers/aiProvider.js'
import { projectRepository } from './persistence/jsonStore.js'
import { ProjectService } from './persistence/projectService.js'
import { artifactRepository } from './persistence/artifactRepository.js'
import { ArtifactService } from './persistence/artifactService.js'
import type { ProjectType, ProjectStatus } from './persistence/types.js'
import type {
  ArtifactType,
  ArtifactStatus,
  ProjectContext,
  AgentHandoff,
  Artifact,
} from './persistence/artifactTypes.js'
import {
  runOrchestrator,
  runAgentStep,
  synthesizeFinalResult,
} from './ai/orchestrator.js'
import {
  buildHandoffFromOutput,
  defaultArtifactTitle,
  inferArtifactType,
  shouldCreateArtifact,
} from './ai/artifactHeuristics.js'
import { buildAgentContext, CONTEXT_BUDGET } from './ai/contextBuilder.js'
import { getCodexProviderState } from './codex/codexProvider.js'
import {
  cancelCodexRun,
  cancelCodexRunsForTask,
  executeCodexRun,
  preflightCodex,
} from './codex/codexExecutionService.js'
import {
  getSnapshotDiff,
  restoreContentSnapshot,
} from './codex/contentSnapshot.js'
import type { CodexMode } from './codex/types.js'
import { createWebSearchProvider } from './search/webSearchProvider.js'
import { runWebSearchPipeline } from './search/searchService.js'
import { resolveRequiresWebSearch } from './search/requiresWebSearch.js'
import {
  appendSearchSession,
  listSearchSessions,
  loadSearchSessionsFromTasks,
} from './search/searchHistoryStore.js'
import { knowledgeRepository } from './persistence/knowledgeRepository.js'
import { KnowledgeService } from './persistence/knowledgeService.js'
import type {
  KnowledgeCategory,
  KnowledgeStatus,
} from './persistence/knowledgeTypes.js'
import { KNOWLEDGE_CATEGORIES } from './persistence/knowledgeTypes.js'
import { usageRepository } from './persistence/usageRepository.js'
import { UsageService } from './persistence/usageService.js'
import type {
  ExecutionProvider,
  ExecutionStatus,
} from './persistence/usageTypes.js'
import { settingsRepository } from './persistence/settingsRepository.js'
import {
  SettingsService,
  assertNoSecretsInPayload,
} from './persistence/settingsService.js'
import {
  initLocalSession,
  requireLocalSession,
  issueSessionCookie,
  isAllowedOrigin,
  sessionFilePath,
} from './runtime/localSession.js'
import {
  tryAcquireExecutionLock,
  releaseExecutionLock,
  getExecutionLock,
} from './runtime/executionLock.js'
import { hardenError } from './runtime/hardenErrors.js'

const PORT = Number(process.env.PORT ?? 8787)
const HOST = process.env.AGENT_DECK_HOST ?? '127.0.0.1'
const app = express()
const aiProvider = createAiProvider()
const webSearchProvider = createWebSearchProvider()
const projects = new ProjectService(projectRepository)
const artifacts = new ArtifactService(artifactRepository)
const knowledge = new KnowledgeService(knowledgeRepository)
const usage = new UsageService(usageRepository)
const settings = new SettingsService(
  settingsRepository,
  aiProvider,
  webSearchProvider,
)

async function syncUsageFromSnapshot(snap: {
  projects: Array<{ id: string }>
  tasks: Array<{ id: string; projectId: string; webSearchSessions?: unknown[] }>
  agentRuns: Array<{ taskId: string }>
  codexRuns?: Array<{ taskId: string }>
}) {
  for (const p of snap.projects) {
    await usage.syncFromSources(p.id, {
      agentRuns: snap.agentRuns as never,
      codexRuns: (snap.codexRuns ?? []) as never,
      tasks: snap.tasks.filter((t) => t.projectId === p.id) as never,
    })
  }
}

app.use(
  cors({
    origin(origin, cb) {
      if (!origin || isAllowedOrigin(origin)) {
        cb(null, origin || true)
        return
      }
      cb(hardenError('ORIGIN_FORBIDDEN', `Origin not allowed: ${origin}`))
    },
    credentials: true,
  }),
)
app.use(express.json({ limit: '4mb' }))

app.use((req, res, next) => {
  const origin = req.headers.origin
  if (origin && !isAllowedOrigin(origin)) {
    sendError(
      res,
      hardenError('ORIGIN_FORBIDDEN', `Origin not allowed: ${origin}`),
    )
    return
  }
  next()
})

app.use((req, res, next) => {
  const p = req.path
  if (
    p === '/api/health' ||
    p === '/api/session/bootstrap' ||
    (req.method === 'GET' && p === '/api/session/status')
  ) {
    next()
    return
  }
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    requireLocalSession(req, res, next)
    return
  }
  if (p.startsWith('/api/codex/snapshot/')) {
    requireLocalSession(req, res, next)
    return
  }
  next()
})

function hydrateSearchFromSnapshot(snap: {
  tasks: Array<{ id: string; webSearchSessions?: unknown[] }>
}) {
  loadSearchSessionsFromTasks(snap.tasks as never)
}

function sendError(res: express.Response, err: unknown) {
  const status =
    err && typeof err === 'object' && 'status' in err
      ? Number((err as { status: number }).status)
      : 500
  const message = err instanceof Error ? err.message : String(err)
  const payload: Record<string, unknown> = { error: message }
  if (err && typeof err === 'object') {
    const e = err as {
      code?: string
      run?: unknown
      output?: string
      userMessageKo?: string
      diagnostics?: unknown
    }
    if (e.code) payload.code = e.code
    if (e.run) payload.run = e.run
    if (e.output) payload.output = e.output
    if (e.userMessageKo) payload.userMessageKo = e.userMessageKo
    if (e.diagnostics) payload.diagnostics = e.diagnostics
  }
  res.status(status || 500).json(payload)
}

app.get('/api/health', async (_req, res) => {
  const registry = await loadAgentRegistry()
  const snap = await projects.getSnapshot()
  res.json({
    ok: true,
    service: 'agent-deck-server',
    host: HOST,
    provider: aiProvider.getState(),
    registry: {
      source: registry.source,
      total: registry.total,
      agentsDir: registry.agentsDir,
      divisionMapSource: registry.divisionMapSource,
      divisionMapCount: registry.divisionMapCount,
      warning: registry.warning ?? null,
    },
    projects: {
      count: snap.projects.length,
      activeProjectId: snap.activeProjectId,
      revision: snap.revision ?? 0,
    },
  })
})

/** Bootstrap local session cookie — never returns the token value. */
app.get('/api/session/bootstrap', (req, res) => {
  issueSessionCookie(res)
  res.json({
    ok: true,
    authenticated: true,
    note: 'Local session cookie issued. Token is not returned in the body.',
  })
})

app.get('/api/session/status', (req, res) => {
  // Does not reveal token — only whether credential was accepted
  const hasHeader = Boolean(req.header('x-agent-deck-session'))
  const hasCookie = Boolean(req.headers.cookie?.includes('agent_deck_session='))
  res.json({
    ok: true,
    hasCredential: hasHeader || hasCookie,
  })
})

app.post('/api/execution/lock', (req, res) => {
  try {
    const projectId = String(req.body?.projectId ?? '').trim()
    const taskId = String(req.body?.taskId ?? '').trim()
    const clientId = String(req.body?.clientId ?? '').trim()
    if (!projectId || !taskId || !clientId) {
      res.status(400).json({ error: 'projectId, taskId, clientId required' })
      return
    }
    const holder = tryAcquireExecutionLock({ projectId, taskId, clientId })
    res.json({ ok: true, lock: holder })
  } catch (err) {
    sendError(res, err)
  }
})

app.delete('/api/execution/lock', (req, res) => {
  const projectId = String(req.body?.projectId ?? req.query.projectId ?? '').trim()
  const clientId = String(req.body?.clientId ?? req.query.clientId ?? '').trim()
  if (!projectId) {
    res.status(400).json({ error: 'projectId required' })
    return
  }
  const ok = releaseExecutionLock({
    projectId,
    clientId: clientId || undefined,
  })
  res.json({ ok, lock: getExecutionLock(projectId) })
})

app.get('/api/agents', async (_req, res) => {
  const registry = await loadAgentRegistry()
  res.json({
    agents: registry.agents,
    source: registry.source,
    total: registry.total,
    agentsDir: registry.agentsDir,
    divisionMapSource: registry.divisionMapSource,
    divisionMapCount: registry.divisionMapCount,
    warning: registry.warning ?? null,
    provider: aiProvider.getState(),
  })
})

app.get('/api/provider', async (_req, res) => {
  const ai = aiProvider.getState()
  const codex = await getCodexProviderState()
  res.json({ ...ai, codex })
})

/* ─── Phase S1 Settings Control Center ─── */

app.get('/api/settings', async (_req, res) => {
  try {
    const board = await settings.buildBoard()
    assertNoSecretsInPayload(board)
    res.json(board)
  } catch (err) {
    sendError(res, err)
  }
})

app.patch('/api/settings', async (req, res) => {
  try {
    const result = await settings.update(req.body ?? {})
    assertNoSecretsInPayload(result.settings)
    const board = await settings.buildBoard()
    assertNoSecretsInPayload(board)
    res.json({
      ...board,
      rejectedSafety: result.rejectedSafety,
    })
  } catch (err) {
    sendError(res, err)
  }
})

app.get('/api/settings/diagnostics', async (_req, res) => {
  try {
    const board = await settings.buildBoard()
    assertNoSecretsInPayload(board.diagnostics)
    res.json({ diagnostics: board.diagnostics, status: board.status })
  } catch (err) {
    sendError(res, err)
  }
})

app.post('/api/settings/openai/test', (_req, res) => {
  // S1: structure only — never call OpenAI
  const result = settings.connectionTestOpenAI()
  assertNoSecretsInPayload(result)
  res.json(result)
})

app.get('/api/codex/status', async (_req, res) => {
  res.json(await getCodexProviderState())
})

app.post('/api/codex/preflight', async (req, res) => {
  try {
    const body = req.body ?? {}
    const mode = String(body.mode ?? 'inspect') as CodexMode
    if (!['inspect', 'implement', 'review', 'verify'].includes(mode)) {
      res.status(400).json({ error: 'Invalid Codex mode' })
      return
    }
    const result = await preflightCodex({
      projectPath: body.projectPath ? String(body.projectPath) : undefined,
      mode,
      agentId: String(body.agentId ?? ''),
      stepTask: String(body.stepTask ?? ''),
    })
    res.status(result.ok ? 200 : 400).json(result)
  } catch (err) {
    sendError(res, err)
  }
})

app.post('/api/codex/run', async (req, res) => {
  try {
    const body = req.body ?? {}
    const mode = String(body.mode ?? '') as CodexMode
    if (!['inspect', 'implement', 'review', 'verify'].includes(mode)) {
      res.status(400).json({ error: 'mode must be inspect|implement|review|verify' })
      return
    }
    const runId =
      String(body.runId ?? '').trim() ||
      `codex_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
    const result = await executeCodexRun({
      runId,
      taskId: String(body.taskId ?? ''),
      stepId: String(body.stepId ?? ''),
      agentId: String(body.agentId ?? '').trim(),
      mode,
      projectId: String(body.projectId ?? '').trim(),
      projectPath: String(body.projectPath ?? ''),
      userRequest: String(body.userRequest ?? '').trim(),
      stepTask: String(body.stepTask ?? '').trim(),
      previousResult: body.previousResult
        ? String(body.previousResult)
        : undefined,
      timeoutMs: body.timeoutMs ? Number(body.timeoutMs) : undefined,
    })
    res.json(result)
  } catch (err) {
    sendError(res, err)
  }
})

app.post('/api/codex/cancel', async (req, res) => {
  try {
    const body = req.body ?? {}
    const runId = body.runId ? String(body.runId) : ''
    const taskId = body.taskId ? String(body.taskId) : ''
    let cancelled = false
    let count = 0
    if (runId) cancelled = cancelCodexRun(runId)
    if (taskId) count = cancelCodexRunsForTask(taskId)
    res.json({ ok: cancelled || count > 0, cancelled, count })
  } catch (err) {
    sendError(res, err)
  }
})

app.get('/api/codex/snapshot/:snapshotId', async (req, res) => {
  try {
    const projectId = req.query.projectId ? String(req.query.projectId) : ''
    const snap = await getSnapshotDiff(String(req.params.snapshotId))
    if (!snap) {
      res.status(404).json({ error: 'Snapshot not found' })
      return
    }
    if (projectId && snap.projectId && snap.projectId !== projectId) {
      sendError(
        res,
        hardenError(
          'SNAPSHOT_OWNERSHIP',
          `snapshot belongs to ${snap.projectId}, not ${projectId}`,
        ),
      )
      return
    }
    res.json({
      id: snap.id,
      projectId: snap.projectId,
      runId: snap.runId,
      taskId: snap.taskId,
      projectPath: snap.projectPath,
      changedFiles: snap.changedFiles,
      added: snap.added,
      modified: snap.modified,
      deleted: snap.deleted,
      unifiedDiff: snap.unifiedDiff,
      diffByFile: snap.diffByFile,
      createdAt: snap.createdAt,
    })
  } catch (err) {
    sendError(res, err)
  }
})

app.post('/api/codex/rollback', async (req, res) => {
  try {
    const snapshotId = String(req.body?.snapshotId ?? '').trim()
    const projectId = String(req.body?.projectId ?? '').trim()
    const projectPath = String(req.body?.projectPath ?? '').trim()
    if (!snapshotId || !projectId || !projectPath) {
      res.status(400).json({
        error: 'snapshotId, projectId, projectPath required',
        code: 'BAD_REQUEST',
        userMessageKo: '복원에 프로젝트 정보가 필요합니다.',
      })
      return
    }
    const result = await restoreContentSnapshot(snapshotId, {
      projectId,
      projectPath,
    })
    res.status(result.ok ? 200 : 400).json(result)
  } catch (err) {
    sendError(res, err)
  }
})

app.post('/api/ai/orchestrate', async (req, res) => {
  try {
    // Harden-0: Orchestrator is recommendation-only.
    // Canonical pipeline SoT = WorkflowTemplate (client).
    const body = req.body ?? {}
    const userRequest = String(body.userRequest ?? '').trim()
    if (!userRequest) {
      res.status(400).json({ error: 'userRequest required' })
      return
    }
    const result = await runOrchestrator(aiProvider, {
      userRequest,
      projectType: body.projectType ? String(body.projectType) : undefined,
      projectName: body.projectName ? String(body.projectName) : undefined,
      teamAgentIds: Array.isArray(body.teamAgentIds)
        ? body.teamAgentIds.map(String)
        : [],
      preferredAgentId: body.preferredAgentId
        ? String(body.preferredAgentId)
        : undefined,
    })
    res.json({
      ...result,
      planningCanonical: 'WorkflowTemplate',
      deprecatedAsPipelineSource: true,
      note:
        'Orchestrator output is advisory. Agent Deck MVP builds pipelines from WorkflowTemplate + SafetyPipeline only.',
    })
  } catch (err) {
    sendError(res, err)
  }
})

app.post('/api/ai/run-step', async (req, res) => {
  try {
    const body = req.body ?? {}
    const agentId = String(body.agentId ?? '').trim()
    const stepTask = String(body.stepTask ?? '').trim()
    const userRequest = String(body.userRequest ?? '').trim()
    if (!agentId || !stepTask || !userRequest) {
      res.status(400).json({ error: 'agentId, stepTask, userRequest required' })
      return
    }

    const projectId = body.projectId ? String(body.projectId) : undefined
    const taskId = body.taskId ? String(body.taskId) : undefined
    let projectContext: ProjectContext | null = null
    let taskArtifacts: Artifact[] = []
    let allProjectArtifacts: Artifact[] = []
    let handoff: AgentHandoff | null = null
    let knowledgeItems: Awaited<
      ReturnType<typeof knowledge.list>
    > = []

    if (projectId) {
      const snap = await projects.getSnapshot()
      const project = snap.projects.find((p) => p.id === projectId)
      projectContext = project?.context ?? null
      const store = await artifacts.getStore(projectId)
      allProjectArtifacts = store.artifacts.filter((a) => a.status !== 'rejected')
      taskArtifacts = taskId
        ? allProjectArtifacts.filter((a) => a.taskId === taskId)
        : []
      knowledgeItems = await knowledge.list({
        projectId,
        status: 'confirmed',
        allVersions: false,
      })
      if (body.handoffId) {
        handoff =
          store.handoffs.find((h) => h.id === String(body.handoffId)) ?? null
      } else if (body.handoff && typeof body.handoff === 'object') {
        handoff = body.handoff as AgentHandoff
      } else if (taskId) {
        const forTask = store.handoffs.filter((h) => h.taskId === taskId)
        handoff = forTask.at(-1) ?? null
      }
    }

    const priorResearch = taskArtifacts.some((a) => a.type === 'research')
    const skipBecausePriorResearch =
      body.skipWebSearch === true ||
      (body.skipBecausePriorResearch === true && priorResearch) ||
      (Boolean(body.role) &&
        /game-designer|product|engineer|reality/i.test(String(body.role)) &&
        priorResearch)

    let webSearchBlock: string | undefined
    let webSearchSources: Array<{
      id: string
      title: string
      url: string
      domain: string
      publishedAt?: string
      snippet?: string
      quality?: string
    }> | undefined
    let webSearchSession: ReturnType<typeof listSearchSessions>[number] | undefined
    let searchSkipped = true

    const wantsSearch = resolveRequiresWebSearch({
      requiresWebSearch:
        body.requiresWebSearch === true
          ? true
          : body.requiresWebSearch === false
            ? false
            : undefined,
      agentId,
      role: body.role ? String(body.role) : undefined,
      stepLabel: stepTask,
      userRequest,
      skipBecausePriorResearch,
    })

    if (wantsSearch && taskId) {
      const pipeline = await runWebSearchPipeline(aiProvider, webSearchProvider, {
        taskId,
        stepId: body.stepId ? String(body.stepId) : undefined,
        agentId,
        role: body.role ? String(body.role) : undefined,
        stepLabel: stepTask,
        userRequest,
        requiresWebSearch: true,
        skipBecausePriorResearch: false,
      })
      searchSkipped = pipeline.skipped
      if (!pipeline.skipped && pipeline.session && pipeline.dataBlock) {
        appendSearchSession(pipeline.session)
        webSearchBlock = pipeline.dataBlock
        webSearchSources = pipeline.sources
        webSearchSession = pipeline.session
      }
    }

    const deckSettings = await settings.get()
    const { resolveModelFromSettings } = await import(
      './ai/modelProfileRouting.js'
    )
    const resolvedModel = resolveModelFromSettings(deckSettings.modelProfiles, {
      agentId,
      role: body.role ? String(body.role) : undefined,
      stepLabel: stepTask,
      purpose: body.purpose ? String(body.purpose) : undefined,
    })

    const result = await runAgentStep(aiProvider, {
      agentId,
      stepTask,
      userRequest,
      projectType: body.projectType ? String(body.projectType) : undefined,
      projectName: body.projectName ? String(body.projectName) : undefined,
      projectContext,
      previousResult: body.previousResult
        ? String(body.previousResult)
        : undefined,
      handoff,
      taskArtifacts,
      linkedArtifactIds: Array.isArray(body.linkedArtifactIds)
        ? body.linkedArtifactIds.map(String)
        : undefined,
      allProjectArtifacts,
      webSearchBlock,
      webSearchSources,
      knowledgeItems,
      model: resolvedModel.model,
      modelProfileId: resolvedModel.profileId,
    })
    res.json({
      ...result,
      modelProfileId: resolvedModel.profileId,
      webSearch: {
        skipped: searchSkipped,
        session: webSearchSession,
        sources: webSearchSources ?? [],
      },
    })
  } catch (err) {
    sendError(res, err)
  }
})

app.get('/api/search/status', (_req, res) => {
  res.json({
    available: webSearchProvider.isAvailable(),
    providerId: webSearchProvider.id,
    label: webSearchProvider.label,
  })
})

app.post('/api/search/execute', async (req, res) => {
  try {
    const body = req.body ?? {}
    const taskId = String(body.taskId ?? '').trim() || `adhoc_${Date.now().toString(36)}`
    const userRequest = String(body.userRequest ?? body.query ?? '').trim()
    const stepTask = String(body.stepTask ?? 'Research').trim()
    const agentId = String(body.agentId ?? 'trend-researcher').trim()
    if (!userRequest) {
      res.status(400).json({ error: 'userRequest required' })
      return
    }
    const provider =
      body.forceFail === true
        ? new (await import('./search/webSearchProvider.js')).FailingWebSearchProvider()
        : webSearchProvider
    const pipeline = await runWebSearchPipeline(aiProvider, provider, {
      taskId,
      agentId,
      stepLabel: stepTask,
      userRequest,
      requiresWebSearch: true,
    })
    if (pipeline.session) appendSearchSession(pipeline.session)
    res.json(pipeline)
  } catch (err) {
    sendError(res, err)
  }
})

app.get('/api/search/history/:taskId', async (req, res) => {
  const taskId = String(req.params.taskId)
  let sessions = listSearchSessions(taskId)
  if (sessions.length === 0) {
    const snap = await projects.getSnapshot()
    const task = snap.tasks.find((t) => t.id === taskId)
    if (task?.webSearchSessions?.length) {
      loadSearchSessionsFromTasks([task] as never)
      sessions = listSearchSessions(taskId)
    }
  }
  const sources = sessions.flatMap((s) => s.sources)
  res.json({
    taskId,
    queryCount: sessions.reduce((n, s) => n + s.queries.length, 0),
    sourceCount: sources.length,
    sessions,
  })
})

app.post('/api/search/requires', (req, res) => {
  const body = req.body ?? {}
  const result = resolveRequiresWebSearch({
    requiresWebSearch:
      body.requiresWebSearch === true
        ? true
        : body.requiresWebSearch === false
          ? false
          : undefined,
    agentId: String(body.agentId ?? ''),
    role: body.role ? String(body.role) : undefined,
    stepLabel: body.stepLabel ? String(body.stepLabel) : undefined,
    userRequest: String(body.userRequest ?? ''),
    skipBecausePriorResearch: body.skipBecausePriorResearch === true,
  })
  res.json({ requiresWebSearch: result })
})

app.post('/api/ai/synthesize', async (req, res) => {
  try {
    const body = req.body ?? {}
    const userRequest = String(body.userRequest ?? '').trim()
    const workflow = String(body.workflow ?? '').trim()
    const stepOutputs = Array.isArray(body.stepOutputs) ? body.stepOutputs : []
    if (!userRequest || !workflow || stepOutputs.length === 0) {
      res.status(400).json({ error: 'userRequest, workflow, stepOutputs required' })
      return
    }
    const result = await synthesizeFinalResult(aiProvider, {
      userRequest,
      workflow,
      stepOutputs: stepOutputs.map(
        (s: {
          agentId?: string
          agentName?: string
          task?: string
          output?: string
        }) => ({
          agentId: String(s.agentId ?? ''),
          agentName: String(s.agentName ?? s.agentId ?? ''),
          task: String(s.task ?? ''),
          output: String(s.output ?? ''),
        }),
      ),
    })
    res.json(result)
  } catch (err) {
    sendError(res, err)
  }
})

app.get('/api/projects', async (_req, res) => {
  try {
    const snap = await projects.getSnapshot()
    res.json(snap)
  } catch (err) {
    sendError(res, err)
  }
})

app.post('/api/projects', async (req, res) => {
  try {
    const { name, type, path: projectPath, agentIds, status } = req.body ?? {}
    if (!name || !type) {
      res.status(400).json({ error: 'name and type are required' })
      return
    }
    const snap = await projects.create({
      name: String(name),
      type: type as ProjectType,
      path: projectPath ? String(projectPath) : undefined,
      agentIds: Array.isArray(agentIds) ? agentIds.map(String) : [],
      status: status as ProjectStatus | undefined,
    })
    res.status(201).json(snap)
  } catch (err) {
    sendError(res, err)
  }
})

app.patch('/api/projects/:id', async (req, res) => {
  try {
    const snap = await projects.update(req.params.id, req.body ?? {})
    res.json(snap)
  } catch (err) {
    sendError(res, err)
  }
})

app.put('/api/projects/:id/team', async (req, res) => {
  try {
    const agentIds = req.body?.agentIds
    if (!Array.isArray(agentIds)) {
      res.status(400).json({ error: 'agentIds array required' })
      return
    }
    const snap = await projects.update(req.params.id, {
      agentIds: agentIds.map(String),
    })
    res.json(snap)
  } catch (err) {
    sendError(res, err)
  }
})

app.post('/api/projects/active', async (req, res) => {
  try {
    const id = req.body?.projectId ?? null
    const snap = await projects.setActive(id ? String(id) : null)
    res.json(snap)
  } catch (err) {
    sendError(res, err)
  }
})

app.delete('/api/projects/:id', async (req, res) => {
  try {
    const snap = await projects.remove(req.params.id)
    await artifacts.deleteProject(req.params.id).catch(() => undefined)
    await knowledgeRepository.deleteProject(req.params.id).catch(() => undefined)
    await usageRepository.deleteProject(req.params.id).catch(() => undefined)
    res.json(snap)
  } catch (err) {
    sendError(res, err)
  }
})

app.put('/api/work-state', async (req, res) => {
  try {
    const {
      tasks,
      pipelineSteps,
      agentRuns,
      codexRuns,
      recover,
      expectedRevision,
    } = req.body ?? {}
    if (!Array.isArray(tasks) || !Array.isArray(pipelineSteps)) {
      res.status(400).json({ error: 'tasks and pipelineSteps arrays required' })
      return
    }
    const payload = {
      tasks,
      pipelineSteps,
      agentRuns: Array.isArray(agentRuns) ? agentRuns : undefined,
      codexRuns: Array.isArray(codexRuns) ? codexRuns : undefined,
      expectedRevision:
        typeof expectedRevision === 'number' ? expectedRevision : undefined,
    }
    const snap =
      recover === true
        ? await projects.replaceWorkState(payload)
        : await projects.saveWorkState(payload)
    hydrateSearchFromSnapshot(snap)
    // On recover: cancel any in-memory Codex processes
    if (recover === true) {
      for (const t of snap.tasks) {
        if (t.status === 'interrupted' || t.status === 'paused') {
          cancelCodexRunsForTask(t.id)
        }
      }
    }
    void syncUsageFromSnapshot(snap).catch((err) =>
      console.warn('[agent-deck] usage sync failed', err),
    )
    res.json(snap)
  } catch (err) {
    sendError(res, err)
  }
})

// ─── Artifacts / Handoffs (F2) ───────────────────────────────────────────────

app.get('/api/projects/:projectId/artifacts', async (req, res) => {
  try {
    const list = await artifacts.listArtifacts(req.params.projectId, {
      taskId: req.query.taskId ? String(req.query.taskId) : undefined,
      type: req.query.type ? (String(req.query.type) as ArtifactType) : undefined,
      latestOnly: req.query.all !== '1',
    })
    res.json({ artifacts: list })
  } catch (err) {
    sendError(res, err)
  }
})

app.get('/api/projects/:projectId/artifacts/:artifactId', async (req, res) => {
  try {
    const art = await artifacts.getArtifact(
      req.params.projectId,
      req.params.artifactId,
    )
    if (!art) {
      res.status(404).json({ error: 'Artifact not found' })
      return
    }
    const versions = await artifacts.getVersions(req.params.projectId, art.familyId)
    res.json({ artifact: art, versions })
  } catch (err) {
    sendError(res, err)
  }
})

app.post('/api/projects/:projectId/artifacts', async (req, res) => {
  try {
    const body = req.body ?? {}
    if (!body.type || !body.title || body.content == null) {
      res.status(400).json({ error: 'type, title, content required' })
      return
    }
    const art = await artifacts.createArtifact({
      projectId: req.params.projectId,
      taskId: body.taskId ? String(body.taskId) : undefined,
      stepId: body.stepId ? String(body.stepId) : undefined,
      agentId: body.agentId ? String(body.agentId) : undefined,
      type: body.type as ArtifactType,
      title: String(body.title),
      summary: String(body.summary ?? '').slice(0, 500) || String(body.content).slice(0, 200),
      contentType: body.contentType,
      content: String(body.content),
      status: (body.status as ArtifactStatus) ?? 'final',
      familyId: body.familyId ? String(body.familyId) : undefined,
      metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : undefined,
      sources: Array.isArray(body.sources) ? body.sources : undefined,
      searchedAt: body.searchedAt ? String(body.searchedAt) : undefined,
    })
    res.status(201).json({ artifact: art })
  } catch (err) {
    sendError(res, err)
  }
})

app.post('/api/projects/:projectId/artifacts/:familyId/versions', async (req, res) => {
  try {
    const body = req.body ?? {}
    if (body.content == null) {
      res.status(400).json({ error: 'content required' })
      return
    }
    const art = await artifacts.createVersion(
      req.params.projectId,
      req.params.familyId,
      {
        title: body.title ? String(body.title) : undefined,
        summary: body.summary ? String(body.summary) : undefined,
        content: String(body.content),
        contentType: body.contentType,
        agentId: body.agentId ? String(body.agentId) : undefined,
        taskId: body.taskId ? String(body.taskId) : undefined,
        stepId: body.stepId ? String(body.stepId) : undefined,
        status: body.status as ArtifactStatus | undefined,
        metadata: body.metadata,
      },
    )
    res.status(201).json({ artifact: art })
  } catch (err) {
    sendError(res, err)
  }
})

app.patch(
  '/api/projects/:projectId/artifacts/:artifactId/status',
  async (req, res) => {
    try {
      const status = String(req.body?.status ?? '') as ArtifactStatus
      if (!['draft', 'final', 'rejected'].includes(status)) {
        res.status(400).json({ error: 'status must be draft|final|rejected' })
        return
      }
      const art = await artifacts.updateStatus(
        req.params.projectId,
        req.params.artifactId,
        status,
      )
      res.json({ artifact: art })
    } catch (err) {
      sendError(res, err)
    }
  },
)

// ——— Project Knowledge (K1) ———

app.get('/api/projects/:projectId/knowledge', async (req, res) => {
  try {
    const category = req.query.category
      ? (String(req.query.category) as KnowledgeCategory)
      : undefined
    const status = req.query.status
      ? (String(req.query.status) as KnowledgeStatus)
      : undefined
    if (category && !KNOWLEDGE_CATEGORIES.includes(category)) {
      res.status(400).json({ error: 'Invalid category' })
      return
    }
    const items = await knowledge.list({
      projectId: req.params.projectId,
      category,
      status,
      q: req.query.q ? String(req.query.q) : undefined,
      allVersions: req.query.all === '1',
    })
    res.json({ items })
  } catch (err) {
    sendError(res, err)
  }
})

app.get('/api/projects/:projectId/knowledge/:knowledgeId', async (req, res) => {
  try {
    const item = await knowledge.get(req.params.projectId, req.params.knowledgeId)
    if (!item) {
      res.status(404).json({ error: 'Knowledge not found' })
      return
    }
    const versions = await knowledge.getVersions(
      req.params.projectId,
      item.familyId,
    )
    res.json({ item, versions })
  } catch (err) {
    sendError(res, err)
  }
})

app.post('/api/projects/:projectId/knowledge', async (req, res) => {
  try {
    const body = req.body ?? {}
    if (!body.category || !body.title || body.content == null) {
      res.status(400).json({ error: 'category, title, content required' })
      return
    }
    const result = await knowledge.createProposed({
      projectId: req.params.projectId,
      category: body.category as KnowledgeCategory,
      title: String(body.title),
      content: String(body.content),
      createdBy: String(body.createdBy ?? 'user'),
      sourceArtifactIds: Array.isArray(body.sourceArtifactIds)
        ? body.sourceArtifactIds.map(String)
        : undefined,
      sourceTaskIds: Array.isArray(body.sourceTaskIds)
        ? body.sourceTaskIds.map(String)
        : undefined,
      sourceIds: Array.isArray(body.sourceIds)
        ? body.sourceIds.map(String)
        : undefined,
      familyId: body.familyId ? String(body.familyId) : undefined,
    })
    res.status(201).json(result)
  } catch (err) {
    sendError(res, err)
  }
})

app.post('/api/projects/:projectId/knowledge/preview-conflicts', async (req, res) => {
  try {
    const body = req.body ?? {}
    if (!body.category || !body.title || body.content == null) {
      res.status(400).json({ error: 'category, title, content required' })
      return
    }
    const conflicts = await knowledge.previewConflicts({
      projectId: req.params.projectId,
      category: body.category as KnowledgeCategory,
      title: String(body.title),
      content: String(body.content),
      excludeFamilyId: body.excludeFamilyId
        ? String(body.excludeFamilyId)
        : undefined,
    })
    res.json({ conflicts })
  } catch (err) {
    sendError(res, err)
  }
})

app.post(
  '/api/projects/:projectId/knowledge/:knowledgeId/confirm',
  async (req, res) => {
    try {
      const body = req.body ?? {}
      if (body.title != null || body.content != null || body.resolveConflicts) {
        const result = await knowledge.confirmWithEdit({
          projectId: req.params.projectId,
          id: req.params.knowledgeId,
          title: body.title ? String(body.title) : undefined,
          content: body.content != null ? String(body.content) : undefined,
          category: body.category
            ? (body.category as KnowledgeCategory)
            : undefined,
          createdBy: String(body.createdBy ?? 'user'),
          resolveConflicts: body.resolveConflicts as
            | 'keep-existing'
            | 'use-new'
            | 'keep-both'
            | undefined,
        })
        if (result.conflicts.length > 0 && !body.resolveConflicts) {
          res.status(409).json({
            error: '충돌 가능성',
            conflicts: result.conflicts,
            item: result.item,
          })
          return
        }
        res.json(result)
        return
      }
      const item = await knowledge.get(
        req.params.projectId,
        req.params.knowledgeId,
      )
      if (!item) {
        res.status(404).json({ error: 'Knowledge not found' })
        return
      }
      const conflicts = await knowledge.previewConflicts({
        projectId: req.params.projectId,
        category: item.category,
        title: item.title,
        content: item.content,
        excludeFamilyId: item.familyId,
      })
      if (conflicts.length > 0 && !body.resolveConflicts) {
        res.status(409).json({
          error: '충돌 가능성',
          conflicts,
          item,
        })
        return
      }
      if (body.resolveConflicts === 'keep-existing') {
        const rejected = await knowledge.reject(
          req.params.projectId,
          req.params.knowledgeId,
          { note: '충돌 해결: 기존 유지' },
        )
        res.json({ item: rejected, conflicts: [] })
        return
      }
      if (body.resolveConflicts === 'use-new') {
        for (const c of conflicts) {
          if (c.existing.status === 'confirmed') {
            await knowledge.reject(req.params.projectId, c.existing.id, {
              note: '충돌 해결: 새 내용으로 변경',
            })
          }
        }
      }
      const confirmed = await knowledge.confirm(
        req.params.projectId,
        req.params.knowledgeId,
        { note: body.note ? String(body.note) : undefined },
      )
      res.json({ item: confirmed, conflicts: [] })
    } catch (err) {
      sendError(res, err)
    }
  },
)

app.post(
  '/api/projects/:projectId/knowledge/:knowledgeId/reject',
  async (req, res) => {
    try {
      const body = req.body ?? {}
      const item = await knowledge.reject(
        req.params.projectId,
        req.params.knowledgeId,
        { note: body.note ? String(body.note) : undefined },
      )
      res.json({ item })
    } catch (err) {
      sendError(res, err)
    }
  },
)

app.post(
  '/api/projects/:projectId/knowledge/:familyId/versions',
  async (req, res) => {
    try {
      const body = req.body ?? {}
      if (body.content == null) {
        res.status(400).json({ error: 'content required' })
        return
      }
      const result = await knowledge.createVersion({
        projectId: req.params.projectId,
        familyId: req.params.familyId,
        title: body.title ? String(body.title) : undefined,
        content: String(body.content),
        category: body.category
          ? (body.category as KnowledgeCategory)
          : undefined,
        createdBy: String(body.createdBy ?? 'user'),
        sourceArtifactIds: Array.isArray(body.sourceArtifactIds)
          ? body.sourceArtifactIds.map(String)
          : undefined,
        sourceTaskIds: Array.isArray(body.sourceTaskIds)
          ? body.sourceTaskIds.map(String)
          : undefined,
        sourceIds: Array.isArray(body.sourceIds)
          ? body.sourceIds.map(String)
          : undefined,
      })
      res.status(201).json(result)
    } catch (err) {
      sendError(res, err)
    }
  },
)

app.get('/api/projects/:projectId/handoffs', async (req, res) => {
  try {
    const list = await artifacts.listHandoffs(req.params.projectId, {
      taskId: req.query.taskId ? String(req.query.taskId) : undefined,
    })
    res.json({ handoffs: list })
  } catch (err) {
    sendError(res, err)
  }
})

app.post('/api/projects/:projectId/handoffs', async (req, res) => {
  try {
    const body = req.body ?? {}
    if (!body.taskId || !body.fromAgentId || !body.toAgentId || !body.summary) {
      res
        .status(400)
        .json({ error: 'taskId, fromAgentId, toAgentId, summary required' })
      return
    }
    const handoff = await artifacts.createHandoff({
      projectId: req.params.projectId,
      taskId: String(body.taskId),
      fromAgentId: String(body.fromAgentId),
      toAgentId: String(body.toAgentId),
      fromStepId: body.fromStepId ? String(body.fromStepId) : undefined,
      toStepId: body.toStepId ? String(body.toStepId) : undefined,
      summary: String(body.summary),
      decisions: Array.isArray(body.decisions) ? body.decisions.map(String) : [],
      openQuestions: Array.isArray(body.openQuestions)
        ? body.openQuestions.map(String)
        : [],
      risks: Array.isArray(body.risks) ? body.risks.map(String) : [],
      artifactIds: Array.isArray(body.artifactIds)
        ? body.artifactIds.map(String)
        : [],
    })
    res.status(201).json({ handoff })
  } catch (err) {
    sendError(res, err)
  }
})

/** Helper: derive handoff locally (no LLM) — used by clients & tests */
app.post('/api/projects/:projectId/handoffs/derive', async (req, res) => {
  try {
    const body = req.body ?? {}
    const derived = buildHandoffFromOutput({
      projectId: req.params.projectId,
      taskId: String(body.taskId ?? ''),
      fromAgentId: String(body.fromAgentId ?? ''),
      toAgentId: String(body.toAgentId ?? ''),
      fromStepId: body.fromStepId ? String(body.fromStepId) : undefined,
      toStepId: body.toStepId ? String(body.toStepId) : undefined,
      output: String(body.output ?? ''),
      artifactIds: Array.isArray(body.artifactIds)
        ? body.artifactIds.map(String)
        : [],
    })
    if (Array.isArray(body.relevantArtifactIds)) {
      derived.relevantArtifactIds = body.relevantArtifactIds.map(String)
    }
    if (Array.isArray(body.relevantSourceIds)) {
      derived.relevantSourceIds = body.relevantSourceIds.map(String)
    }
    const handoff = await artifacts.createHandoff(derived)
    res.status(201).json({ handoff })
  } catch (err) {
    sendError(res, err)
  }
})

app.patch('/api/projects/:id/context', async (req, res) => {
  try {
    const body = req.body ?? {}
    const context: ProjectContext = {}
    if (body.description != null) context.description = String(body.description)
    if (body.goals != null) context.goals = String(body.goals)
    if (body.constraints != null) context.constraints = String(body.constraints)
    if (body.techStack != null) context.techStack = String(body.techStack)
    const snap = await projects.update(req.params.id, { context })
    res.json(snap)
  } catch (err) {
    sendError(res, err)
  }
})

/** Debug / E2E: inspect context budget without calling LLM */
app.post('/api/ai/build-context', async (req, res) => {
  try {
    const body = req.body ?? {}
    const projectId = body.projectId ? String(body.projectId) : undefined
    let projectContext: ProjectContext | null = null
    let taskArtifacts: Artifact[] = []
    let all: Artifact[] = []
    let handoff: AgentHandoff | null = null
    let knowledgeItems: Awaited<ReturnType<typeof knowledge.list>> = []
    if (projectId) {
      const snap = await projects.getSnapshot()
      projectContext =
        snap.projects.find((p) => p.id === projectId)?.context ?? null
      const store = await artifacts.getStore(projectId)
      all = store.artifacts.filter((a) => a.status !== 'rejected')
      const taskId = body.taskId ? String(body.taskId) : undefined
      taskArtifacts = taskId ? all.filter((a) => a.taskId === taskId) : []
      handoff = body.handoffId
        ? (store.handoffs.find((h) => h.id === String(body.handoffId)) ?? null)
        : (taskId
            ? (store.handoffs.filter((h) => h.taskId === taskId).at(-1) ?? null)
            : null)
      knowledgeItems = await knowledge.list({
        projectId,
        status: 'confirmed',
        allVersions: false,
      })
    }
    const built = buildAgentContext({
      projectName: body.projectName ? String(body.projectName) : undefined,
      projectType: body.projectType ? String(body.projectType) : undefined,
      projectContext,
      userRequest: String(body.userRequest ?? ''),
      stepTask: String(body.stepTask ?? ''),
      handoff,
      taskArtifacts,
      linkedArtifactIds: Array.isArray(body.linkedArtifactIds)
        ? body.linkedArtifactIds.map(String)
        : undefined,
      allProjectArtifacts: all,
      previousResult: body.previousResult
        ? String(body.previousResult)
        : undefined,
      knowledgeItems,
      agentId: body.agentId ? String(body.agentId) : undefined,
    })
    res.json({
      context: built,
      budget: CONTEXT_BUDGET,
      heuristics: {
        inferType: inferArtifactType({
          agentId: String(body.agentId ?? 'unknown'),
          stepLabel: body.stepTask ? String(body.stepTask) : undefined,
        }),
        shouldCreate: shouldCreateArtifact({
          output: String(body.sampleOutput ?? 'x'.repeat(200)),
          agentId: String(body.agentId ?? 'unknown'),
        }),
        defaultTitle: defaultArtifactTitle({
          type: 'document',
          agentId: String(body.agentId ?? 'unknown'),
          stepLabel: body.stepTask ? String(body.stepTask) : undefined,
        }),
      },
    })
  } catch (err) {
    sendError(res, err)
  }
})

/* ─── Phase O1 Usage / Execution Observability ─── */

app.get('/api/usage/summary', async (req, res) => {
  try {
    const scopeRaw = String(req.query.scope ?? 'project')
    const scope =
      scopeRaw === 'today' || scopeRaw === 'all' || scopeRaw === 'project'
        ? scopeRaw
        : 'project'
    const projectId = req.query.projectId
      ? String(req.query.projectId)
      : undefined
    if (scope === 'project' && !projectId) {
      res.status(400).json({ error: 'projectId required for project scope' })
      return
    }
    // Best-effort sync from live project store before summarizing
    if (projectId) {
      const snap = await projects.getSnapshot()
      await usage.syncFromSources(projectId, {
        agentRuns: snap.agentRuns,
        codexRuns: snap.codexRuns ?? [],
        tasks: snap.tasks.filter((t) => t.projectId === projectId),
      })
    } else if (scope === 'all' || scope === 'today') {
      const snap = await projects.getSnapshot()
      await syncUsageFromSnapshot(snap)
    }
    const result = await usage.summary({ scope, projectId })
    res.json(result)
  } catch (err) {
    sendError(res, err)
  }
})

app.get('/api/usage/executions', async (req, res) => {
  try {
    const list = await usage.list({
      projectId: req.query.projectId
        ? String(req.query.projectId)
        : undefined,
      taskId: req.query.taskId ? String(req.query.taskId) : undefined,
      agentId: req.query.agentId ? String(req.query.agentId) : undefined,
      provider: req.query.provider
        ? (String(req.query.provider) as ExecutionProvider)
        : undefined,
      status: req.query.status
        ? (String(req.query.status) as ExecutionStatus)
        : undefined,
      dateFrom: req.query.dateFrom ? String(req.query.dateFrom) : undefined,
      dateTo: req.query.dateTo ? String(req.query.dateTo) : undefined,
      q: req.query.q ? String(req.query.q) : undefined,
    })
    res.json({ executions: list })
  } catch (err) {
    sendError(res, err)
  }
})

app.get('/api/usage/executions/:id', async (req, res) => {
  try {
    const projectId = req.query.projectId
      ? String(req.query.projectId)
      : undefined
    if (projectId) {
      const item = await usage.get(projectId, req.params.id)
      if (!item) {
        res.status(404).json({ error: 'Execution not found' })
        return
      }
      res.json({ execution: item })
      return
    }
    const ids = await usageRepository.listProjectIds()
    for (const pid of ids) {
      const item = await usage.get(pid, req.params.id)
      if (item) {
        res.json({ execution: item })
        return
      }
    }
    res.status(404).json({ error: 'Execution not found' })
  } catch (err) {
    sendError(res, err)
  }
})

app.get('/api/projects/:projectId/usage', async (req, res) => {
  try {
    const snap = await projects.getSnapshot()
    await usage.syncFromSources(req.params.projectId, {
      agentRuns: snap.agentRuns,
      codexRuns: snap.codexRuns ?? [],
      tasks: snap.tasks.filter((t) => t.projectId === req.params.projectId),
    })
    const aggregation = await usage.projectSummary(req.params.projectId)
    const budget = await usage.getBudget(req.params.projectId)
    const check = await usage.checkBudget(req.params.projectId)
    const taskCount = snap.tasks.filter(
      (t) => t.projectId === req.params.projectId,
    ).length
    res.json({
      projectId: req.params.projectId,
      totalTasks: taskCount,
      aggregation,
      budget,
      budgetCheck: {
        overCost: check.overCost,
        overTokens: check.overTokens,
        warning: check.warning,
      },
    })
  } catch (err) {
    sendError(res, err)
  }
})

app.get('/api/projects/:projectId/tasks/:taskId/usage', async (req, res) => {
  try {
    const snap = await projects.getSnapshot()
    await usage.syncFromSources(req.params.projectId, {
      agentRuns: snap.agentRuns,
      codexRuns: snap.codexRuns ?? [],
      tasks: snap.tasks.filter((t) => t.projectId === req.params.projectId),
    })
    const aggregation = await usage.taskSummary(
      req.params.projectId,
      req.params.taskId,
    )
    res.json({
      projectId: req.params.projectId,
      taskId: req.params.taskId,
      aggregation,
    })
  } catch (err) {
    sendError(res, err)
  }
})

app.get('/api/projects/:projectId/budget', async (req, res) => {
  try {
    const budget = await usage.getBudget(req.params.projectId)
    res.json({ budget })
  } catch (err) {
    sendError(res, err)
  }
})

app.put('/api/projects/:projectId/budget', async (req, res) => {
  try {
    const budget = await usage.setBudget(req.params.projectId, {
      maxCost: req.body?.maxCost,
      maxTokens: req.body?.maxTokens,
      warningThreshold: req.body?.warningThreshold,
    })
    res.json({ budget })
  } catch (err) {
    sendError(res, err)
  }
})

app.listen(PORT, HOST, async () => {
  await initLocalSession()
  const state = aiProvider.getState()
  const codex = await getCodexProviderState()
  console.log(`[agent-deck] local server on http://${HOST}:${PORT}`)
  console.log(`[agent-deck] session file: ${sessionFilePath()}`)
  console.log(`[agent-deck] AI provider: ${state.label}`)
  console.log(`[agent-deck] Codex: ${codex.label}`)
  console.log(
    `[agent-deck] Web Search: ${webSearchProvider.label} (available=${webSearchProvider.isAvailable()})`,
  )
  void loadAgentRegistry().then((r) => {
    console.log(
      `[agent-deck] registry: ${r.source} (${r.total} agents)` +
        (r.agentsDir ? ` from ${r.agentsDir}` : ''),
    )
  })
  void projects.getSnapshot().then(async (s) => {
    console.log(
      `[agent-deck] projects: ${s.projects.length} (active=${s.activeProjectId ?? 'none'} revision=${s.revision ?? 0})`,
    )
    hydrateSearchFromSnapshot(s)
    console.log('[agent-deck] search history: hydrated from tasks')
    // Never treat leftover running as success — mark interrupted on boot
    const hasRunning = s.tasks.some(
      (t) => t.status === 'running' || t.status === 'verifying',
    )
    if (hasRunning) {
      const recovered = await projects.replaceWorkState({
        tasks: s.tasks,
        pipelineSteps: s.pipelineSteps,
        agentRuns: s.agentRuns,
        codexRuns: s.codexRuns,
        expectedRevision: s.revision,
      })
      for (const t of recovered.tasks) {
        cancelCodexRunsForTask(t.id)
      }
      console.log('[agent-deck] boot recover: interrupted leftover running tasks')
    }
    try {
      await syncUsageFromSnapshot(s)
      console.log('[agent-deck] usage: synced from existing runs')
    } catch (err) {
      console.warn('[agent-deck] usage sync on boot failed', err)
    }
  })
})
