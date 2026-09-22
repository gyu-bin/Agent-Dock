import express from 'express'
import cors from 'cors'
import { isCloudRuntime, loadDotEnv } from './loadEnv.js'

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
import { operationsRepository } from './persistence/operationsRepository.js'
import { OperationsService } from './persistence/operationsService.js'
import {
  RoutineExecutionService,
  RoutineSchedulerRuntime,
  readSchedulerConfigFromEnv,
} from './operations/index.js'
import {
  MarketingService,
  marketingRepository,
} from './marketing/index.js'
import {
  createImageGenerationService,
  imageStorage,
} from './image/index.js'
import {
  createDefaultSocialRegistry,
  socialRepository,
  SocialPublishService,
  SocialAnalyticsService,
} from './social/index.js'
import {
  createMediaDeliveryService,
  mediaDeliveryRepository,
} from './mediaDelivery/index.js'
import { credentialStore } from './credentials/index.js'
import { assertNoTokenLeak } from './credentials/redact.js'
import {
  setImageGenerateAvailable,
  setSocialPublishAvailable,
  setAnalyticsReadAvailable,
} from './operations/capabilityPreflight.js'
import type {
  ProjectGoalType,
  ProjectStage,
} from './persistence/operationsTypes.js'
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
const operations = new OperationsService(operationsRepository)
const usage = new UsageService(usageRepository)
const imageService = createImageGenerationService({
  artifacts,
  usage,
  storage: imageStorage,
})
setImageGenerateAvailable(imageService.isAvailable())

const socialRegistry = createDefaultSocialRegistry(credentialStore)
const threadsConnector = socialRegistry.getThreadsConnector()
if (threadsConnector) {
  void threadsConnector.refreshConnectionCache().then(() => {
    setSocialPublishAvailable(socialRegistry.hasAnyPublishAvailable())
  })
}
setSocialPublishAvailable(socialRegistry.hasAnyPublishAvailable())
setAnalyticsReadAvailable(socialRegistry.hasAnyAnalyticsAvailable())

const mediaDelivery = createMediaDeliveryService({
  artifacts,
  usage,
  repo: mediaDeliveryRepository,
})

const socialPublish = new SocialPublishService(
  socialRegistry,
  socialRepository,
  marketingRepository,
  artifacts,
  mediaDelivery,
)
const socialAnalytics = new SocialAnalyticsService(
  socialRegistry,
  socialRepository,
  artifacts,
)

const marketing = new MarketingService(
  marketingRepository,
  projects,
  artifacts,
  knowledge,
  operations,
  imageService,
  socialRegistry,
  socialAnalytics,
)
const routineExecution = new RoutineExecutionService(
  operations,
  projects,
  marketing,
)
const schedulerRuntime = new RoutineSchedulerRuntime(
  operations,
  projects,
  readSchedulerConfigFromEnv(),
)
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
      category?: string
      userMessage?: string
      technicalSummary?: string
      run?: unknown
      output?: string
      userMessageKo?: string
      diagnostics?: unknown
    }
    if (e.userMessage) payload.error = e.userMessage
    if (e.category) payload.code = e.category
    if (e.code) payload.code = e.code
    if (e.technicalSummary) payload.technicalSummary = e.technicalSummary
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
    await operations.deleteProject(req.params.id).catch(() => undefined)
    await marketing.deleteProject(req.params.id).catch(() => undefined)
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

// ——— Project Operations (Goals / Routines / Runs) ———

app.get('/api/projects/:projectId/operations', async (req, res) => {
  try {
    const board = await operations.getBoard(req.params.projectId)
    res.json(board)
  } catch (err) {
    sendError(res, err)
  }
})

app.get('/api/projects/:projectId/goals', async (req, res) => {
  try {
    const board = await operations.getBoard(req.params.projectId)
    res.json({ goals: board.goals })
  } catch (err) {
    sendError(res, err)
  }
})

app.post('/api/projects/:projectId/goals', async (req, res) => {
  try {
    const body = req.body ?? {}
    if (!body.title) {
      res.status(400).json({ error: 'title required' })
      return
    }
    const goal = await operations.createGoal(req.params.projectId, {
      type: (body.type as ProjectGoalType) ?? 'custom',
      title: String(body.title),
      description: body.description ? String(body.description) : undefined,
      priority: body.priority,
      successCriteria: Array.isArray(body.successCriteria)
        ? body.successCriteria.map(String)
        : undefined,
    })
    res.status(201).json({ goal })
  } catch (err) {
    sendError(res, err)
  }
})

app.patch('/api/goals/:goalId', async (req, res) => {
  try {
    const body = req.body ?? {}
    const goal = await operations.patchGoal(req.params.goalId, {
      projectId: body.projectId ? String(body.projectId) : undefined,
      title: body.title != null ? String(body.title) : undefined,
      description:
        body.description != null ? String(body.description) : undefined,
      status: body.status,
      priority: body.priority,
      type: body.type,
      successCriteria: Array.isArray(body.successCriteria)
        ? body.successCriteria.map(String)
        : undefined,
    })
    res.json({ goal })
  } catch (err) {
    sendError(res, err)
  }
})

app.get('/api/projects/:projectId/routines', async (req, res) => {
  try {
    const board = await operations.getBoard(req.params.projectId)
    res.json({ routines: board.routines })
  } catch (err) {
    sendError(res, err)
  }
})

app.post('/api/projects/:projectId/routines', async (req, res) => {
  try {
    const body = req.body ?? {}
    const routine = await operations.createRoutine(req.params.projectId, {
      name: body.name ? String(body.name) : undefined,
      description: body.description ? String(body.description) : undefined,
      goalId: body.goalId ? String(body.goalId) : undefined,
      templateId: body.templateId ? String(body.templateId) : undefined,
      trigger: body.trigger,
      schedule: body.schedule,
      requiredCapabilities: Array.isArray(body.requiredCapabilities)
        ? body.requiredCapabilities.map(String)
        : undefined,
      futureCapabilities: Array.isArray(body.futureCapabilities)
        ? body.futureCapabilities.map(String)
        : undefined,
      workflowTemplateId: body.workflowTemplateId
        ? String(body.workflowTemplateId)
        : undefined,
      status: body.status,
    })
    res.status(201).json({ routine })
  } catch (err) {
    sendError(res, err)
  }
})

app.patch('/api/routines/:routineId', async (req, res) => {
  try {
    const body = req.body ?? {}
    const routine = await operations.patchRoutine(req.params.routineId, {
      projectId: body.projectId ? String(body.projectId) : undefined,
      name: body.name != null ? String(body.name) : undefined,
      description:
        body.description != null ? String(body.description) : undefined,
      status: body.status,
      trigger: body.trigger,
      schedule: body.schedule,
      goalId: body.goalId != null ? String(body.goalId) : undefined,
      executionPolicy: body.executionPolicy,
    })
    res.json({ routine })
  } catch (err) {
    sendError(res, err)
  }
})

app.get('/api/projects/:projectId/routine-runs', async (req, res) => {
  try {
    const board = await operations.getBoard(req.params.projectId)
    res.json({ runs: board.runs })
  } catch (err) {
    sendError(res, err)
  }
})

app.post('/api/routines/:routineId/run', async (req, res) => {
  try {
    const body = req.body ?? {}
    const result = await routineExecution.start({
      routineId: req.params.routineId,
      projectId: body.projectId ? String(body.projectId) : undefined,
      triggerSource: 'manual',
      taskId: body.taskId ? String(body.taskId) : undefined,
      teamAgentIds: Array.isArray(body.teamAgentIds)
        ? body.teamAgentIds.map(String)
        : undefined,
      specialistCandidates: Array.isArray(body.specialistCandidates)
        ? body.specialistCandidates.map(String)
        : undefined,
      preferredAgentId: body.preferredAgentId
        ? String(body.preferredAgentId)
        : undefined,
      idempotent: false,
    })
    res.status(201).json({
      run: result.run,
      routine: result.routine,
      taskSeed: result.taskSeed,
      task: result.task,
    })
  } catch (err) {
    sendError(res, err)
  }
})

app.get('/api/scheduler/status', async (_req, res) => {
  try {
    const status = await schedulerRuntime.getStatus()
    res.json(status)
  } catch (err) {
    sendError(res, err)
  }
})

app.patch('/api/projects/:projectId/operations/stage', async (req, res) => {
  try {
    const stage = req.body?.stage as ProjectStage | undefined | null
    const board = await operations.setStage(
      req.params.projectId,
      stage === null ? undefined : stage,
    )
    res.json(board)
  } catch (err) {
    sendError(res, err)
  }
})

// ——— Marketing Operations ———
app.get('/api/projects/:projectId/marketing/campaigns', async (req, res) => {
  try {
    const campaigns = await marketing.listCampaigns(req.params.projectId)
    res.json({ campaigns })
  } catch (err) {
    sendError(res, err)
  }
})

app.get('/api/marketing/campaigns/:id', async (req, res) => {
  try {
    const hit = await marketing.getCampaign(
      req.params.id,
      req.query.projectId ? String(req.query.projectId) : undefined,
    )
    if (!hit) {
      res.status(404).json({ error: 'Campaign not found' })
      return
    }
    res.json(hit)
  } catch (err) {
    sendError(res, err)
  }
})

app.post('/api/projects/:projectId/marketing/campaigns', async (req, res) => {
  try {
    const body = req.body ?? {}
    const result = await marketing.runCampaign({
      projectId: req.params.projectId,
      title: body.title != null ? String(body.title) : undefined,
      objective: body.objective,
      request: body.request != null ? String(body.request) : undefined,
      goalId: body.goalId != null ? String(body.goalId) : undefined,
      routineId: body.routineId != null ? String(body.routineId) : undefined,
      routineRunId:
        body.routineRunId != null ? String(body.routineRunId) : undefined,
      taskId: body.taskId != null ? String(body.taskId) : undefined,
      teamAgentIds: Array.isArray(body.teamAgentIds)
        ? body.teamAgentIds.map(String)
        : undefined,
      specialistAgentIds: Array.isArray(body.specialistAgentIds)
        ? body.specialistAgentIds.map(String)
        : undefined,
      stage: body.stage,
      allowWithoutSearch: body.allowWithoutSearch === true,
      searchAvailable: body.searchAvailable !== false,
      fixtureSources: Array.isArray(body.fixtureSources)
        ? body.fixtureSources
        : undefined,
      autoGenerateImages: body.autoGenerateImages === true,
    })
    res.status(201).json(result)
  } catch (err) {
    sendError(res, err)
  }
})

app.patch('/api/marketing/campaigns/:id', async (req, res) => {
  try {
    const body = req.body ?? {}
    const campaign = await marketing.patchCampaign(req.params.id, {
      projectId: body.projectId ? String(body.projectId) : undefined,
      title: body.title != null ? String(body.title) : undefined,
      status: body.status,
      objective: body.objective,
      targetAudience:
        body.targetAudience != null ? String(body.targetAudience) : undefined,
      positioning:
        body.positioning != null ? String(body.positioning) : undefined,
      keyMessages: Array.isArray(body.keyMessages)
        ? body.keyMessages.map(String)
        : undefined,
      taskId: body.taskId != null ? String(body.taskId) : undefined,
    })
    res.json({ campaign })
  } catch (err) {
    sendError(res, err)
  }
})

app.get('/api/marketing/campaigns/:id/content', async (req, res) => {
  try {
    const contents = await marketing.listContent(req.params.id)
    res.json({ contents })
  } catch (err) {
    sendError(res, err)
  }
})

app.post('/api/marketing/campaigns/:id/approve', async (req, res) => {
  try {
    const body = req.body ?? {}
    const campaign = await marketing.approveCampaign(req.params.id, {
      projectId: body.projectId ? String(body.projectId) : undefined,
      note: body.note != null ? String(body.note) : undefined,
    })
    res.json({ campaign })
  } catch (err) {
    sendError(res, err)
  }
})

app.post('/api/marketing/campaigns/:id/request-changes', async (req, res) => {
  try {
    const body = req.body ?? {}
    const campaign = await marketing.requestChanges(req.params.id, {
      projectId: body.projectId ? String(body.projectId) : undefined,
      feedback: String(body.feedback ?? body.note ?? 'Changes requested'),
    })
    res.json({ campaign })
  } catch (err) {
    sendError(res, err)
  }
})

// ——— Image Generation Tool ———
app.get('/api/tools/image/status', (_req, res) => {
  const state = imageService.getState()
  setImageGenerateAvailable(state.available && state.configured)
  res.json({
    configured: state.configured,
    available: state.available,
    fastModel: state.fastModel,
    qualityModel: state.qualityModel,
    label: state.label,
    providerName: state.providerName,
  })
})

app.post('/api/tools/image/generate', async (req, res) => {
  try {
    const body = req.body ?? {}
    const projectId = String(body.projectId ?? '')
    if (!projectId) {
      res.status(400).json({ error: 'projectId required' })
      return
    }
    setImageGenerateAvailable(imageService.isAvailable())
    const result = await imageService.generate({
      projectId,
      taskId: body.taskId ? String(body.taskId) : undefined,
      campaignId: body.campaignId ? String(body.campaignId) : undefined,
      contentId: body.contentId ? String(body.contentId) : undefined,
      prompt: String(body.prompt ?? ''),
      purpose: body.purpose ?? 'marketing',
      size: body.size ? String(body.size) : undefined,
      quality: body.quality,
      background: body.background,
      modelProfile: body.modelProfile === 'quality' ? 'quality' : 'fast',
      feedback: body.feedback ? String(body.feedback) : undefined,
      previousArtifactId: body.previousArtifactId
        ? String(body.previousArtifactId)
        : undefined,
      agentId: body.agentId ? String(body.agentId) : undefined,
      title: body.title ? String(body.title) : undefined,
      skipBudget: body.skipBudget === true,
    })
    // Never return file bytes / base64 — only paths + artifact refs
    res.status(201).json({
      imageId: result.result.id,
      model: result.result.model,
      mimeType: result.result.mimeType,
      width: result.result.width,
      height: result.result.height,
      publicPath: result.result.publicPath,
      revisedPrompt: result.result.revisedPrompt,
      artifactId: result.artifactId,
      version: result.version,
      familyId: result.familyId,
      executionId: result.executionId,
      createdAt: result.result.createdAt,
    })
  } catch (err) {
    sendError(res, err)
  }
})

app.post('/api/tools/image/regenerate', async (req, res) => {
  try {
    const body = req.body ?? {}
    const projectId = String(body.projectId ?? '')
    const previousArtifactId = String(body.previousArtifactId ?? '')
    if (!projectId || !previousArtifactId) {
      res.status(400).json({ error: 'projectId and previousArtifactId required' })
      return
    }
    const result = await imageService.regenerate({
      projectId,
      previousArtifactId,
      feedback: body.feedback ? String(body.feedback) : undefined,
      taskId: body.taskId ? String(body.taskId) : undefined,
      campaignId: body.campaignId ? String(body.campaignId) : undefined,
      contentId: body.contentId ? String(body.contentId) : undefined,
      agentId: body.agentId ? String(body.agentId) : undefined,
      modelProfile: body.modelProfile === 'quality' ? 'quality' : 'fast',
    })
    res.status(201).json({
      imageId: result.result.id,
      model: result.result.model,
      publicPath: result.result.publicPath,
      artifactId: result.artifactId,
      version: result.version,
      familyId: result.familyId,
      executionId: result.executionId,
    })
  } catch (err) {
    sendError(res, err)
  }
})

app.get('/api/tools/image/files/:projectId/:imageFile', async (req, res) => {
  try {
    const publicPath = `${req.params.projectId}/images/${req.params.imageFile}`
    const abs = imageStorage.resolvePublicPath(publicPath)
    res.setHeader('Content-Type', 'image/png')
    res.sendFile(abs)
  } catch (err) {
    sendError(res, err)
  }
})

app.post(
  '/api/marketing/campaigns/:id/generate-image',
  async (req, res) => {
    try {
      const body = req.body ?? {}
      const contentId = String(body.contentId ?? '')
      const hit = await marketing.getCampaign(req.params.id)
      if (!hit) {
        res.status(404).json({ error: 'Campaign not found' })
        return
      }
      const content = hit.contents.find((c) => c.id === contentId)
      if (!content?.creativeBrief) {
        res.status(400).json({ error: 'content with creativeBrief required' })
        return
      }
      setImageGenerateAvailable(imageService.isAvailable())
      if (!imageService.isAvailable()) {
        res.status(503).json({
          error: '이미지 생성 도구가 연결되지 않았습니다.',
          code: 'IMAGE_NOT_CONFIGURED',
        })
        return
      }
      const gen = await imageService.generateFromBrief({
        brief: content.creativeBrief,
        projectId: hit.campaign.projectId,
        campaignId: hit.campaign.id,
        contentId: content.id,
        taskId: hit.campaign.taskId,
        purpose: 'social',
        modelProfile: body.modelProfile === 'quality' ? 'quality' : 'fast',
        feedback: body.feedback ? String(body.feedback) : undefined,
        title: `Creative — ${content.channel}`,
      })
      const snap = await marketingRepository.load(hit.campaign.projectId)
      const c = snap.contents.find((x) => x.id === contentId)
      if (c) {
        c.creativeArtifactIds = [
          ...(c.creativeArtifactIds ?? []),
          gen.artifactId,
        ]
        c.creativeBrief = {
          ...c.creativeBrief!,
          imageToolStatus: 'available',
        }
        c.updatedAt = new Date().toISOString()
        const camp = snap.campaigns.find((x) => x.id === hit.campaign.id)
        if (camp && !camp.artifactIds.includes(gen.artifactId)) {
          camp.artifactIds.push(gen.artifactId)
        }
        await marketingRepository.save(snap)
      }
      res.status(201).json({
        artifactId: gen.artifactId,
        version: gen.version,
        publicPath: gen.result.publicPath,
        contentId,
      })
    } catch (err) {
      sendError(res, err)
    }
  },
)

// ——— Social Connector Foundation ———
app.get('/api/social/connectors', async (_req, res) => {
  try {
    const states = await socialRegistry.listStatesAsync()
    setSocialPublishAvailable(
      states.some(
        (s) =>
          s.available &&
          (s.capabilities.includes('text.publish') ||
            s.capabilities.includes('image.publish') ||
            s.capabilities.includes('video.publish')),
      ),
    )
    setAnalyticsReadAvailable(
      states.some(
        (s) => s.available && s.capabilities.includes('analytics.read'),
      ),
    )
    const payload = {
      connectors: states.map((s) => ({
        id: s.id,
        channel: s.channel,
        state: s.state,
        label: s.label,
        configured: s.configured,
        available: s.available,
        capabilities: s.capabilities,
        policy: s.policy,
        connection: s.connection,
      })),
      socialPublishAvailable: socialRegistry.hasAnyPublishAvailable(),
      analyticsReadAvailable: socialRegistry.hasAnyAnalyticsAvailable(),
    }
    assertNoTokenLeak(payload)
    res.json(payload)
  } catch (err) {
    sendError(res, err)
  }
})

app.post('/api/social/threads/oauth/start', async (_req, res) => {
  try {
    const tc = socialRegistry.getThreadsConnector()
    if (!tc) {
      res.status(503).json({ error: 'Threads connector unavailable' })
      return
    }
    const { authorizeUrl } = tc.getOAuth().startAuthorize()
    // Never include secrets
    res.json({ authorizeUrl })
  } catch (err) {
    sendError(res, err)
  }
})

app.get('/api/social/threads/oauth/callback', async (req, res) => {
  try {
    const tc = socialRegistry.getThreadsConnector()
    if (!tc) {
      res.status(503).send('Threads connector unavailable')
      return
    }
    const result = await tc.getOAuth().handleCallback({
      code: req.query.code ? String(req.query.code) : undefined,
      state: req.query.state ? String(req.query.state) : undefined,
      error: req.query.error ? String(req.query.error) : undefined,
      errorDescription: req.query.error_description
        ? String(req.query.error_description)
        : undefined,
    })
    await tc.refreshConnectionCache()
    setSocialPublishAvailable(socialRegistry.hasAnyPublishAvailable())
    // Redirect to settings — no token in URL
    const clientOrigin =
      process.env.AGENT_DECK_CLIENT_ORIGIN?.trim() || 'http://127.0.0.1:5173'
    res.redirect(
      `${clientOrigin}/?settings=sns&threads=connected&user=${encodeURIComponent(result.username ?? '')}`,
    )
  } catch (err) {
    const msg =
      err && typeof err === 'object' && 'userMessage' in err
        ? String((err as { userMessage: string }).userMessage)
        : 'Threads OAuth failed'
    const clientOrigin =
      process.env.AGENT_DECK_CLIENT_ORIGIN?.trim() || 'http://127.0.0.1:5173'
    res.redirect(
      `${clientOrigin}/?settings=sns&threads=error&msg=${encodeURIComponent(msg)}`,
    )
  }
})

app.post('/api/social/threads/disconnect', async (_req, res) => {
  try {
    const tc = socialRegistry.getThreadsConnector()
    if (!tc) {
      res.status(503).json({ error: 'Threads connector unavailable' })
      return
    }
    await tc.getOAuth().disconnect()
    await tc.refreshConnectionCache()
    setSocialPublishAvailable(socialRegistry.hasAnyPublishAvailable())
    res.json({ ok: true, connected: false })
  } catch (err) {
    sendError(res, err)
  }
})

// ——— Media Delivery Foundation ———
app.get('/api/media-delivery/status', (_req, res) => {
  const state = mediaDelivery.getState()
  const payload = {
    configured: state.configured,
    available: state.available,
    provider: state.provider,
    label: state.label,
    defaultTtlSeconds: state.defaultTtlSeconds,
    bucket: state.bucket ?? null,
    region: state.region ?? null,
  }
  assertNoTokenLeak(payload)
  res.json(payload)
})

app.post('/api/media-delivery/prepare', async (req, res) => {
  try {
    const body = req.body ?? {}
    const projectId = String(body.projectId ?? '')
    const artifactId = String(body.artifactId ?? '')
    if (!projectId || !artifactId) {
      res.status(400).json({ error: 'projectId and artifactId required' })
      return
    }
    const delivered = await mediaDelivery.prepare({
      projectId,
      artifactId,
      purpose: body.purpose ?? 'social-publish',
      requestedTtlSeconds:
        body.requestedTtlSeconds != null
          ? Number(body.requestedTtlSeconds)
          : undefined,
      publishAttemptId: body.publishAttemptId
        ? String(body.publishAttemptId)
        : undefined,
      maxBytes: body.maxBytes != null ? Number(body.maxBytes) : undefined,
    })
    // Return delivery metadata; URL is transient for this response only
    const payload = {
      id: delivered.id,
      projectId: delivered.projectId,
      artifactId: delivered.artifactId,
      provider: delivered.provider,
      mimeType: delivered.mimeType,
      bytes: delivered.bytes,
      createdAt: delivered.createdAt,
      expiresAt: delivered.expiresAt,
      status: delivered.status,
      // URL included for immediate publish use — not stored in project knowledge
      url: delivered.url,
    }
    assertNoTokenLeak(payload)
    res.status(201).json(payload)
  } catch (err) {
    sendError(res, err)
  }
})

app.post('/api/media-delivery/:id/revoke', async (req, res) => {
  try {
    const projectId = String(req.body?.projectId ?? '')
    if (!projectId) {
      res.status(400).json({ error: 'projectId required' })
      return
    }
    await mediaDelivery.revoke(projectId, req.params.id)
    res.json({ ok: true, id: req.params.id, status: 'revoked' })
  } catch (err) {
    sendError(res, err)
  }
})

app.get('/api/marketing/content/:id/publish-preview', async (req, res) => {
  try {
    const projectId = String(req.query.projectId ?? '')
    if (!projectId) {
      res.status(400).json({ error: 'projectId required' })
      return
    }
    const snap = await marketingRepository.load(projectId)
    const content = snap.contents.find((c) => c.id === req.params.id)
    if (!content) {
      res.status(404).json({ error: 'Content not found' })
      return
    }
    const campaign = snap.campaigns.find((c) => c.id === content.campaignId)
    const tc = socialRegistry.getThreadsConnector()
    const threadsState = tc ? await tc.getStateAsync() : null
    const payload = {
      contentId: content.id,
      campaignId: content.campaignId,
      channel: content.channel,
      title: content.title,
      body: content.body,
      hashtags: content.hashtags,
      mediaArtifactIds: content.creativeArtifactIds ?? [],
      approvalStatus: campaign?.publishPackage?.approvalStatus ?? 'pending',
      account:
        content.channel === 'threads'
          ? {
              username: threadsState?.connection?.username,
              profileId: threadsState?.connection?.profileId,
              connected: threadsState?.available ?? false,
            }
          : null,
    }
    assertNoTokenLeak(payload)
    res.json(payload)
  } catch (err) {
    sendError(res, err)
  }
})

app.get('/api/projects/:projectId/social/posts', async (req, res) => {
  try {
    const posts = await socialPublish.listPosts(req.params.projectId)
    res.json({ posts })
  } catch (err) {
    sendError(res, err)
  }
})

app.post('/api/marketing/content/:id/publish', async (req, res) => {
  try {
    const body = req.body ?? {}
    const projectId = String(body.projectId ?? '')
    if (!projectId) {
      res.status(400).json({ error: 'projectId required' })
      return
    }
    await socialRegistry.getThreadsConnector()?.refreshConnectionCache()
    setSocialPublishAvailable(socialRegistry.hasAnyPublishAvailable())
    const startedAt = new Date().toISOString()
    const t0 = Date.now()
    try {
      const result = await socialPublish.publishContent({
        projectId,
        contentId: req.params.id,
        campaignId: body.campaignId ? String(body.campaignId) : undefined,
      })
      if (result.post?.channel === 'threads') {
        await usage.recordManual({
          projectId,
          taskId: `social_pub_${result.post.contentId}`,
          provider: 'threads',
          operation: 'social.publish',
          status: 'completed',
          startedAt,
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - t0,
          sourceId: result.post.id,
        })
      }
      const payload = {
        post: result.post,
        attempt: {
          id: result.attempt.id,
          status: result.attempt.status,
          idempotencyKey: result.attempt.idempotencyKey,
          errorCode: result.attempt.errorCode,
        },
        duplicate: result.duplicate,
        campaignStatus: result.campaignStatus,
      }
      assertNoTokenLeak(payload)
      res.status(result.duplicate ? 200 : 201).json(payload)
    } catch (err) {
      const category =
        err && typeof err === 'object' && 'category' in err
          ? String((err as { category: string }).category)
          : 'UNKNOWN'
      await usage
        .recordManual({
          projectId,
          taskId: `social_pub_fail_${req.params.id}`,
          provider: 'threads',
          operation: 'social.publish',
          status: 'failed',
          startedAt,
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - t0,
          errorCategory:
            category.includes('RATE')
              ? 'RATE_LIMIT'
              : category.includes('AUTH') || category.includes('NOT_CONFIGURED')
                ? 'AUTH'
                : category.includes('INVALID')
                  ? 'INVALID_REQUEST'
                  : 'UPSTREAM',
          userMessage:
            err && typeof err === 'object' && 'userMessage' in err
              ? String((err as { userMessage: string }).userMessage)
              : undefined,
          technicalSummary:
            err && typeof err === 'object' && 'technicalSummary' in err
              ? String((err as { technicalSummary: string }).technicalSummary)
              : undefined,
          sourceId: `fail_${req.params.id}_${Date.now().toString(36)}`,
        })
        .catch(() => undefined)
      throw err
    }
  } catch (err) {
    sendError(res, err)
  }
})

app.get('/api/social/posts/:id/metrics', async (req, res) => {
  try {
    const projectId = String(req.query.projectId ?? '')
    if (!projectId) {
      res.status(400).json({ error: 'projectId query required' })
      return
    }
    const existing = await socialAnalytics.getLatestMetrics(
      projectId,
      req.params.id,
    )
    if (existing && req.query.refresh !== '1') {
      res.json({ metrics: existing, cached: true })
      return
    }
    const collected = await socialAnalytics.collectMetrics({
      projectId,
      publishedPostId: req.params.id,
    })
    res.json({
      metrics: collected.metrics,
      snapshotId: collected.snapshot.id,
      artifactId: collected.artifactId,
      cached: false,
    })
  } catch (err) {
    sendError(res, err)
  }
})

app.patch('/api/marketing/content/:id', async (req, res) => {
  try {
    const body = req.body ?? {}
    const content = await marketing.patchContent(req.params.id, {
      projectId: body.projectId ? String(body.projectId) : undefined,
      title: body.title != null ? String(body.title) : undefined,
      body: body.body != null ? String(body.body) : undefined,
      hashtags: Array.isArray(body.hashtags)
        ? body.hashtags.map(String)
        : undefined,
      callToAction:
        body.callToAction != null ? String(body.callToAction) : undefined,
      creativeArtifactIds: Array.isArray(body.creativeArtifactIds)
        ? body.creativeArtifactIds.map(String)
        : undefined,
    })
    res.json({ content })
  } catch (err) {
    sendError(res, err)
  }
})

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

let readyPromise: Promise<void> | null = null

/** Idempotent boot for local listen + Vercel serverless cold start. */
export async function ensureReady(): Promise<void> {
  if (!readyPromise) {
    readyPromise = (async () => {
      await initLocalSession()
      try {
        const s = await projects.getSnapshot()
        hydrateSearchFromSnapshot(s)
      } catch (err) {
        console.warn('[agent-deck] snapshot hydrate failed', err)
      }
    })()
  }
  await readyPromise
}

export { app }

if (!isCloudRuntime()) {
  const server = app.listen(PORT, HOST, async () => {
    await ensureReady()
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
        console.log(
          '[agent-deck] boot recover: interrupted leftover running tasks',
        )
      }
      try {
        await syncUsageFromSnapshot(s)
        console.log('[agent-deck] usage: synced from existing runs')
      } catch (err) {
        console.warn('[agent-deck] usage sync on boot failed', err)
      }
      // Reconcile open RoutineRuns against Task state after harden recovery
      try {
        for (const p of s.projects) {
          await routineExecution.reconcileProject(p.id)
        }
      } catch (err) {
        console.warn('[agent-deck] routine run reconcile on boot failed', err)
      }
    })
    schedulerRuntime.start()
  })

  const shutdown = async (signal: string) => {
    console.log(`[agent-deck] ${signal}: shutting down scheduler…`)
    await schedulerRuntime.stop()
    server.close(() => {
      process.exit(0)
    })
    setTimeout(() => process.exit(0), 8000).unref()
  }
  process.once('SIGINT', () => void shutdown('SIGINT'))
  process.once('SIGTERM', () => void shutdown('SIGTERM'))
}
