import type {
  Agent,
  AgentHandoff,
  AgentRun,
  AiProviderState,
  Artifact,
  ArtifactStatus,
  ArtifactType,
  CodexMode,
  CodexRun,
  ExecutionProvider,
  ExecutionRecord,
  ExecutionStatus,
  PipelineStep,
  Project,
  ProjectBudget,
  ProjectContext,
  ProjectStatus,
  ProjectType,
  RoutePlan,
  Task,
  TaskPriority,
  UsageAggregation,
  WebSearchSession,
  WebSource,
  WorkflowKind,
  KnowledgeCategory,
  KnowledgeConflictCandidate,
  KnowledgeItem,
  KnowledgeStatus,
  DeckSettings,
  SettingsBoard,
} from '../domain/types'
import type {
  OperationsSnapshot,
  ProjectGoal,
  ProjectRoutine,
  RoutineRun,
} from '../domain/operations'

const API_BASE = import.meta.env.VITE_API_URL ?? ''

/** Default fetch options — credentials for HttpOnly session cookie. */
function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  return fetch(input, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init?.headers ?? {}),
    },
  })
}

let workStateRevision = 0

export function getWorkStateRevision(): number {
  return workStateRevision
}

export function setWorkStateRevision(rev: number): void {
  workStateRevision = rev
}

export async function bootstrapSession(): Promise<void> {
  await apiFetch(`${API_BASE}/api/session/bootstrap`)
}

export interface RegistryResponse {
  agents: Agent[]
  source: 'mock' | 'filesystem'
  total: number
  agentsDir?: string
  divisionMapSource: 'agency-agents' | 'committed-json'
  divisionMapCount: number
  warning?: string | null
  provider: AiProviderState
}

export interface ProjectsSnapshot {
  version: 1 | 2 | 3 | 4 | 5
  revision?: number
  activeProjectId: string | null
  projects: Project[]
  tasks?: Task[]
  pipelineSteps?: PipelineStep[]
  agentRuns?: AgentRun[]
  codexRuns?: CodexRun[]
}

export async function fetchRegistry(): Promise<RegistryResponse> {
  const res = await apiFetch(`${API_BASE}/api/agents`)
  if (!res.ok) throw new Error(`Registry request failed: ${res.status}`)
  return res.json() as Promise<RegistryResponse>
}

export async function fetchProvider(): Promise<AiProviderState> {
  const res = await apiFetch(`${API_BASE}/api/provider`)
  if (!res.ok) throw new Error(`Provider request failed: ${res.status}`)
  return res.json() as Promise<AiProviderState>
}

export async function fetchProjects(): Promise<ProjectsSnapshot> {
  const res = await apiFetch(`${API_BASE}/api/projects`)
  if (!res.ok) throw new Error(`Projects request failed: ${res.status}`)
  const snap = (await res.json()) as ProjectsSnapshot
  if (typeof snap.revision === 'number') setWorkStateRevision(snap.revision)
  return snap
}

export async function createProject(input: {
  name: string
  type: ProjectType
  path?: string
  agentIds: string[]
  status?: ProjectStatus
}): Promise<ProjectsSnapshot> {
  const res = await apiFetch(`${API_BASE}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as { error?: string }).error ?? `Create failed: ${res.status}`)
  }
  return res.json() as Promise<ProjectsSnapshot>
}

export async function updateProject(
  id: string,
  patch: Partial<Pick<Project, 'name' | 'type' | 'path' | 'status' | 'agentIds'>>,
): Promise<ProjectsSnapshot> {
  const res = await apiFetch(`${API_BASE}/api/projects/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!res.ok) throw new Error(`Update failed: ${res.status}`)
  return res.json() as Promise<ProjectsSnapshot>
}

export async function setProjectTeam(
  id: string,
  agentIds: string[],
): Promise<ProjectsSnapshot> {
  const res = await apiFetch(`${API_BASE}/api/projects/${id}/team`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentIds }),
  })
  if (!res.ok) throw new Error(`Team update failed: ${res.status}`)
  return res.json() as Promise<ProjectsSnapshot>
}

export async function setActiveProject(
  projectId: string | null,
): Promise<ProjectsSnapshot> {
  const res = await apiFetch(`${API_BASE}/api/projects/active`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId }),
  })
  if (!res.ok) throw new Error(`Set active failed: ${res.status}`)
  return res.json() as Promise<ProjectsSnapshot>
}

export async function deleteProject(id: string): Promise<ProjectsSnapshot> {
  const res = await apiFetch(`${API_BASE}/api/projects/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`Delete failed: ${res.status}`)
  return res.json() as Promise<ProjectsSnapshot>
}

export async function saveWorkState(
  input: {
    tasks: Task[]
    pipelineSteps: PipelineStep[]
    agentRuns?: AgentRun[]
    codexRuns?: CodexRun[]
  },
  opts?: { recover?: boolean },
): Promise<ProjectsSnapshot> {
  const res = await apiFetch(`${API_BASE}/api/work-state`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tasks: input.tasks,
      pipelineSteps: input.pipelineSteps,
      agentRuns: input.agentRuns,
      codexRuns: input.codexRuns,
      recover: opts?.recover === true,
      expectedRevision: workStateRevision,
    }),
  })
  if (res.status === 409) {
    const body = await res.json().catch(() => ({}))
    const err = new Error(
      (body as { userMessageKo?: string }).userMessageKo ??
        (body as { error?: string }).error ??
        'Work state conflict',
    ) as Error & { code?: string }
    err.code = 'PERSISTENCE_CONFLICT'
    throw err
  }
  if (!res.ok) throw new Error(`Work state save failed: ${res.status}`)
  const snap = (await res.json()) as ProjectsSnapshot
  if (typeof snap.revision === 'number') setWorkStateRevision(snap.revision)
  return snap
}

export async function orchestrateAi(input: {
  userRequest: string
  projectType?: string
  projectName?: string
  teamAgentIds: string[]
  preferredAgentId?: string
}): Promise<{
  plan: RoutePlan
  usage: { model: string; inputTokens?: number; outputTokens?: number }
}> {
  const res = await apiFetch(`${API_BASE}/api/ai/orchestrate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(
      (body as { error?: string }).error ?? `Orchestrate failed: ${res.status}`,
    )
  }
  return res.json() as Promise<{
    plan: RoutePlan
    usage: { model: string; inputTokens?: number; outputTokens?: number }
  }>
}

export async function runAiStep(input: {
  agentId: string
  stepTask: string
  userRequest: string
  projectId?: string
  taskId?: string
  stepId?: string
  projectType?: string
  projectName?: string
  previousResult?: string
  handoffId?: string
  linkedArtifactIds?: string[]
  requiresWebSearch?: boolean
  role?: string
  skipWebSearch?: boolean
  skipBecausePriorResearch?: boolean
}): Promise<{
  output: string
  inputSummary: string
  usage: { model: string; inputTokens?: number; outputTokens?: number }
  contextMeta?: {
    estimatedChars: number
    includedArtifactIds: string[]
    omittedArtifactCount: number
  }
  webSearch?: {
    skipped: boolean
    session?: WebSearchSession
    sources: WebSource[]
  }
}> {
  const res = await apiFetch(`${API_BASE}/api/ai/run-step`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const err = new Error(
      (body as { error?: string }).error ?? `Run step failed: ${res.status}`,
    ) as Error & { code?: string }
    err.code = (body as { code?: string }).code
    throw err
  }
  return res.json()
}

export async function fetchSearchStatus(): Promise<{
  available: boolean
  providerId: string
  label: string
}> {
  const res = await apiFetch(`${API_BASE}/api/search/status`)
  if (!res.ok) throw new Error(`Search status failed: ${res.status}`)
  return res.json()
}

export async function fetchSearchHistory(taskId: string): Promise<{
  taskId: string
  queryCount: number
  sourceCount: number
  sessions: WebSearchSession[]
}> {
  const res = await apiFetch(
    `${API_BASE}/api/search/history/${encodeURIComponent(taskId)}`,
  )
  if (!res.ok) throw new Error(`Search history failed: ${res.status}`)
  return res.json()
}

export async function executeWebSearch(input: {
  taskId?: string
  userRequest: string
  stepTask?: string
  agentId?: string
}): Promise<{
  skipped: boolean
  session?: WebSearchSession
  sources: WebSource[]
  plan?: { queries: string[]; reason: string }
}> {
  const res = await apiFetch(`${API_BASE}/api/search/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const err = new Error(
      (body as { error?: string }).error ?? `웹 검색 실패: ${res.status}`,
    ) as Error & { code?: string }
    err.code = (body as { code?: string }).code
    throw err
  }
  return res.json()
}

export async function checkRequiresWebSearch(input: {
  agentId: string
  userRequest: string
  role?: string
  stepLabel?: string
  requiresWebSearch?: boolean
  skipBecausePriorResearch?: boolean
}): Promise<{ requiresWebSearch: boolean }> {
  const res = await apiFetch(`${API_BASE}/api/search/requires`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) throw new Error(`requires check failed: ${res.status}`)
  return res.json()
}

export async function fetchProjectArtifacts(
  projectId: string,
  opts?: { taskId?: string; type?: ArtifactType; all?: boolean },
): Promise<Artifact[]> {
  const q = new URLSearchParams()
  if (opts?.taskId) q.set('taskId', opts.taskId)
  if (opts?.type) q.set('type', opts.type)
  if (opts?.all) q.set('all', '1')
  const qs = q.toString()
  const res = await apiFetch(
    `${API_BASE}/api/projects/${encodeURIComponent(projectId)}/artifacts${qs ? `?${qs}` : ''}`,
  )
  if (!res.ok) throw new Error(`Artifacts fetch failed: ${res.status}`)
  const body = (await res.json()) as { artifacts: Artifact[] }
  return body.artifacts
}

export async function fetchArtifactDetail(
  projectId: string,
  artifactId: string,
): Promise<{ artifact: Artifact; versions: Artifact[] }> {
  const res = await apiFetch(
    `${API_BASE}/api/projects/${encodeURIComponent(projectId)}/artifacts/${encodeURIComponent(artifactId)}`,
  )
  if (!res.ok) throw new Error(`Artifact detail failed: ${res.status}`)
  return res.json()
}

export async function createArtifact(
  projectId: string,
  input: {
    type: ArtifactType
    title: string
    summary?: string
    content: string
    contentType?: string
    taskId?: string
    stepId?: string
    agentId?: string
    status?: ArtifactStatus
    familyId?: string
    metadata?: Record<string, unknown>
    sources?: WebSource[]
    searchedAt?: string
  },
): Promise<Artifact> {
  const res = await apiFetch(
    `${API_BASE}/api/projects/${encodeURIComponent(projectId)}/artifacts`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  )
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(
      (body as { error?: string }).error ?? `Create artifact failed: ${res.status}`,
    )
  }
  const body = (await res.json()) as { artifact: Artifact }
  return body.artifact
}

export async function createArtifactVersion(
  projectId: string,
  familyId: string,
  input: {
    content: string
    title?: string
    summary?: string
    agentId?: string
    taskId?: string
    stepId?: string
    status?: ArtifactStatus
    metadata?: Record<string, unknown>
  },
): Promise<Artifact> {
  const res = await apiFetch(
    `${API_BASE}/api/projects/${encodeURIComponent(projectId)}/artifacts/${encodeURIComponent(familyId)}/versions`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  )
  if (!res.ok) throw new Error(`Create version failed: ${res.status}`)
  const body = (await res.json()) as { artifact: Artifact }
  return body.artifact
}

export async function updateArtifactStatus(
  projectId: string,
  artifactId: string,
  status: ArtifactStatus,
): Promise<Artifact> {
  const res = await apiFetch(
    `${API_BASE}/api/projects/${encodeURIComponent(projectId)}/artifacts/${encodeURIComponent(artifactId)}/status`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    },
  )
  if (!res.ok) throw new Error(`Update artifact status failed: ${res.status}`)
  const body = (await res.json()) as { artifact: Artifact }
  return body.artifact
}

export async function fetchHandoffs(
  projectId: string,
  opts?: { taskId?: string },
): Promise<AgentHandoff[]> {
  const q = opts?.taskId ? `?taskId=${encodeURIComponent(opts.taskId)}` : ''
  const res = await apiFetch(
    `${API_BASE}/api/projects/${encodeURIComponent(projectId)}/handoffs${q}`,
  )
  if (!res.ok) throw new Error(`Handoffs fetch failed: ${res.status}`)
  const body = (await res.json()) as { handoffs: AgentHandoff[] }
  return body.handoffs
}

export async function deriveAndCreateHandoff(
  projectId: string,
  input: {
    taskId: string
    fromAgentId: string
    toAgentId: string
    fromStepId?: string
    toStepId?: string
    output: string
    artifactIds?: string[]
    relevantArtifactIds?: string[]
    relevantSourceIds?: string[]
  },
): Promise<AgentHandoff> {
  const res = await apiFetch(
    `${API_BASE}/api/projects/${encodeURIComponent(projectId)}/handoffs/derive`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  )
  if (!res.ok) throw new Error(`Derive handoff failed: ${res.status}`)
  const body = (await res.json()) as { handoff: AgentHandoff }
  return body.handoff
}

export async function updateProjectContext(
  projectId: string,
  context: ProjectContext,
): Promise<ProjectsSnapshot> {
  const res = await apiFetch(
    `${API_BASE}/api/projects/${encodeURIComponent(projectId)}/context`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(context),
    },
  )
  if (!res.ok) throw new Error(`Update context failed: ${res.status}`)
  return res.json()
}

export async function fetchProjectOperations(
  projectId: string,
): Promise<OperationsSnapshot> {
  const res = await apiFetch(
    `${API_BASE}/api/projects/${encodeURIComponent(projectId)}/operations`,
  )
  if (!res.ok) throw new Error(`Operations fetch failed: ${res.status}`)
  return res.json() as Promise<OperationsSnapshot>
}

export async function createProjectGoal(
  projectId: string,
  input: {
    type: ProjectGoal['type']
    title: string
    description?: string
    priority?: ProjectGoal['priority']
    successCriteria?: string[]
  },
): Promise<ProjectGoal> {
  const res = await apiFetch(
    `${API_BASE}/api/projects/${encodeURIComponent(projectId)}/goals`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  )
  if (!res.ok) throw new Error(`Create goal failed: ${res.status}`)
  const body = (await res.json()) as { goal: ProjectGoal }
  return body.goal
}

export async function patchProjectGoal(
  goalId: string,
  patch: {
    projectId?: string
    title?: string
    description?: string
    status?: ProjectGoal['status']
    priority?: ProjectGoal['priority']
    type?: ProjectGoal['type']
    successCriteria?: string[]
  },
): Promise<ProjectGoal> {
  const res = await apiFetch(
    `${API_BASE}/api/goals/${encodeURIComponent(goalId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    },
  )
  if (!res.ok) throw new Error(`Patch goal failed: ${res.status}`)
  const body = (await res.json()) as { goal: ProjectGoal }
  return body.goal
}

export async function createProjectRoutine(
  projectId: string,
  input: Record<string, unknown>,
): Promise<ProjectRoutine> {
  const res = await apiFetch(
    `${API_BASE}/api/projects/${encodeURIComponent(projectId)}/routines`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  )
  if (!res.ok) throw new Error(`Create routine failed: ${res.status}`)
  const body = (await res.json()) as { routine: ProjectRoutine }
  return body.routine
}

export async function patchProjectRoutine(
  routineId: string,
  patch: Record<string, unknown>,
): Promise<ProjectRoutine> {
  const res = await apiFetch(
    `${API_BASE}/api/routines/${encodeURIComponent(routineId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    },
  )
  if (!res.ok) throw new Error(`Patch routine failed: ${res.status}`)
  const body = (await res.json()) as { routine: ProjectRoutine }
  return body.routine
}

export async function runProjectRoutine(
  routineId: string,
  body: Record<string, unknown> = {},
): Promise<{
  run: RoutineRun
  routine: ProjectRoutine
  taskSeed: {
    title: string
    description: string
    workflowTemplateId?: string
    missingCapabilities: string[]
    specialistAgentIds: string[]
  } | null
}> {
  const res = await apiFetch(
    `${API_BASE}/api/routines/${encodeURIComponent(routineId)}/run`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
  if (!res.ok) throw new Error(`Routine run failed: ${res.status}`)
  return res.json()
}

export async function fetchMarketingCampaigns(
  projectId: string,
): Promise<import('../domain/marketing').MarketingCampaign[]> {
  const res = await apiFetch(
    `${API_BASE}/api/projects/${encodeURIComponent(projectId)}/marketing/campaigns`,
  )
  if (!res.ok) throw new Error(`Marketing campaigns failed: ${res.status}`)
  const body = (await res.json()) as {
    campaigns: import('../domain/marketing').MarketingCampaign[]
  }
  return body.campaigns
}

export async function createMarketingCampaign(
  projectId: string,
  input: Record<string, unknown> = {},
): Promise<{
  campaign: import('../domain/marketing').MarketingCampaign
  contents: import('../domain/marketing').MarketingContent[]
  publishPackage: import('../domain/marketing').MarketingPublishPackage
}> {
  const res = await apiFetch(
    `${API_BASE}/api/projects/${encodeURIComponent(projectId)}/marketing/campaigns`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  )
  if (!res.ok) throw new Error(`Create marketing campaign failed: ${res.status}`)
  return res.json()
}

export async function approveMarketingCampaign(
  campaignId: string,
  input: {
    projectId?: string
    note?: string
    publishMode?: 'queue' | 'now' | 'scheduled' | 'draft'
    dueAt?: string | null
    bufferChannelId?: string
  } = {},
): Promise<{ campaign: import('../domain/marketing').MarketingCampaign }> {
  const res = await apiFetch(
    `${API_BASE}/api/marketing/campaigns/${encodeURIComponent(campaignId)}/approve`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  )
  if (!res.ok) throw new Error(`Approve marketing campaign failed: ${res.status}`)
  return res.json()
}

export async function fetchBufferStatus(): Promise<{
  configured: boolean
  available: boolean
  label: string
  channelCount: number
  channels: Array<{
    id: string
    name: string
    service: string
    displayName?: string
  }>
  organizations: Array<{ id: string; name?: string }>
  lastCheckedAt?: string
}> {
  const res = await apiFetch(`${API_BASE}/api/social/buffer/status`)
  if (!res.ok) throw new Error(`Buffer status failed: ${res.status}`)
  return res.json()
}

export async function refreshBufferStatus(): Promise<{
  configured: boolean
  available: boolean
  label: string
  channelCount: number
  channels: Array<{
    id: string
    name: string
    service: string
    displayName?: string
  }>
}> {
  const res = await apiFetch(`${API_BASE}/api/social/buffer/refresh`, {
    method: 'POST',
  })
  if (!res.ok) throw new Error(`Buffer refresh failed: ${res.status}`)
  return res.json()
}

export async function fetchProjectDistribution(
  projectId: string,
): Promise<{
  distribution: {
    provider: 'manual' | 'buffer'
    bufferChannels: {
      threadsChannelId?: string
      instagramChannelId?: string
      youtubeChannelId?: string
    }
  }
}> {
  const res = await apiFetch(
    `${API_BASE}/api/projects/${encodeURIComponent(projectId)}/distribution`,
  )
  if (!res.ok) throw new Error(`Distribution prefs failed: ${res.status}`)
  return res.json()
}

export async function updateProjectDistribution(
  projectId: string,
  body: {
    provider: 'manual' | 'buffer'
    bufferChannels?: {
      threadsChannelId?: string
      instagramChannelId?: string
      youtubeChannelId?: string
    }
  },
): Promise<{
  distribution: {
    provider: 'manual' | 'buffer'
    bufferChannels: Record<string, string | undefined>
  }
}> {
  const res = await apiFetch(
    `${API_BASE}/api/projects/${encodeURIComponent(projectId)}/distribution`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
  if (!res.ok) throw new Error(`Update distribution failed: ${res.status}`)
  return res.json()
}

export async function publishToBuffer(body: {
  projectId: string
  contentId: string
  campaignId?: string
  mode: 'queue' | 'now' | 'scheduled' | 'draft'
  dueAt?: string
  bufferChannelId?: string
}): Promise<{
  duplicate: boolean
  bufferPostId: string
  mode: string
  status: string
  dueAt: string | null
  publishedPostStatus: string
  publishedPostId: string
}> {
  const res = await apiFetch(`${API_BASE}/api/social/buffer/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(
      (err as { error?: string }).error ?? `Buffer publish failed: ${res.status}`,
    )
  }
  return res.json()
}

export async function regenerateMarketingImage(
  previousArtifactId: string,
  body: {
    projectId: string
    feedback?: string
    campaignId?: string
    contentId?: string
    modelProfile?: 'fast' | 'quality'
  },
): Promise<{
  artifactId: string
  version: number
  familyId: string
  publicPath?: string
  model: string
}> {
  const res = await apiFetch(`${API_BASE}/api/tools/image/regenerate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ previousArtifactId, ...body }),
  })
  if (!res.ok) throw new Error(`Regenerate image failed: ${res.status}`)
  return res.json()
}

export async function fetchImageToolStatus(): Promise<{
  configured: boolean
  available: boolean
  fastModel: string
  qualityModel: string
  label: string
  providerName: string
}> {
  const res = await apiFetch(`${API_BASE}/api/tools/image/status`)
  if (!res.ok) throw new Error(`Image status failed: ${res.status}`)
  return res.json()
}

export async function fetchSocialConnectors(): Promise<{
  connectors: Array<{
    id: string
    channel: string
    state: string
    label: string
    configured: boolean
    available: boolean
    capabilities: string[]
    connection?: {
      status: string
      username?: string
      profileId?: string
    }
  }>
  socialPublishAvailable: boolean
  analyticsReadAvailable: boolean
}> {
  const res = await apiFetch(`${API_BASE}/api/social/connectors`)
  if (!res.ok) throw new Error(`Social connectors failed: ${res.status}`)
  return res.json()
}

export async function startThreadsOAuth(): Promise<{ authorizeUrl: string }> {
  const res = await apiFetch(`${API_BASE}/api/social/threads/oauth/start`, {
    method: 'POST',
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(
      (err as { error?: string }).error ?? `Threads OAuth start failed: ${res.status}`,
    )
  }
  return res.json()
}

export async function disconnectThreads(): Promise<{ ok: boolean }> {
  const res = await apiFetch(`${API_BASE}/api/social/threads/disconnect`, {
    method: 'POST',
  })
  if (!res.ok) throw new Error(`Threads disconnect failed: ${res.status}`)
  return res.json()
}

export async function fetchMediaDeliveryStatus(): Promise<{
  configured: boolean
  available: boolean
  provider: string
  label: string
  defaultTtlSeconds: number
}> {
  const res = await apiFetch(`${API_BASE}/api/media-delivery/status`)
  if (!res.ok) throw new Error(`Media delivery status failed: ${res.status}`)
  return res.json()
}

export type WorkAttachmentDto = {
  id: string
  kind: string
  name: string
  source: string
  createdAt: string
  projectId: string
  stagingId?: string
  taskId?: string
  lifecycle: string
  mimeType?: string
  bytes?: number
  extension?: string
  localRef?: string
  path?: string
  displayName?: string
  url?: string
  githubKind?: string
  owner?: string
  repo?: string
  number?: number
  title?: string
}

export async function stageAttachmentFile(
  projectId: string,
  input: {
    name: string
    mimeType?: string
    bytesBase64: string
    stagingId?: string
    source?: string
  },
): Promise<WorkAttachmentDto> {
  const res = await apiFetch(
    `${API_BASE}/api/projects/${encodeURIComponent(projectId)}/attachments/stage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  )
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw Object.assign(
      new Error((err as { error?: string }).error ?? `stage failed ${res.status}`),
      { code: (err as { code?: string }).code },
    )
  }
  const data = (await res.json()) as { attachment: WorkAttachmentDto }
  return data.attachment
}

export async function stageAttachmentFolder(
  projectId: string,
  input: { path: string; displayName?: string; stagingId?: string },
): Promise<WorkAttachmentDto> {
  const res = await apiFetch(
    `${API_BASE}/api/projects/${encodeURIComponent(projectId)}/attachments/stage-folder`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  )
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw Object.assign(
      new Error((err as { error?: string }).error ?? `folder stage failed`),
      { code: (err as { code?: string }).code },
    )
  }
  const data = (await res.json()) as { attachment: WorkAttachmentDto }
  return data.attachment
}

export async function stageAttachmentUrl(
  projectId: string,
  input: { url: string; title?: string; stagingId?: string },
): Promise<WorkAttachmentDto> {
  const res = await apiFetch(
    `${API_BASE}/api/projects/${encodeURIComponent(projectId)}/attachments/stage-url`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  )
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw Object.assign(
      new Error((err as { error?: string }).error ?? `url stage failed`),
      { code: (err as { code?: string }).code },
    )
  }
  const data = (await res.json()) as { attachment: WorkAttachmentDto }
  return data.attachment
}

export async function bindAttachmentsToTask(
  projectId: string,
  taskId: string,
  attachmentIds: string[],
): Promise<WorkAttachmentDto[]> {
  const res = await apiFetch(
    `${API_BASE}/api/projects/${encodeURIComponent(projectId)}/attachments/bind`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId, attachmentIds }),
    },
  )
  if (!res.ok) throw new Error(`bind attachments failed: ${res.status}`)
  const data = (await res.json()) as { attachments: WorkAttachmentDto[] }
  return data.attachments
}

export async function fetchTaskAttachments(
  projectId: string,
  taskId: string,
): Promise<WorkAttachmentDto[]> {
  const q = new URLSearchParams({ taskId })
  const res = await apiFetch(
    `${API_BASE}/api/projects/${encodeURIComponent(projectId)}/attachments?${q}`,
  )
  if (!res.ok) throw new Error(`list attachments failed: ${res.status}`)
  const data = (await res.json()) as { attachments: WorkAttachmentDto[] }
  return data.attachments
}

export async function deleteAttachment(
  projectId: string,
  attachmentId: string,
): Promise<void> {
  const res = await apiFetch(
    `${API_BASE}/api/projects/${encodeURIComponent(projectId)}/attachments/${encodeURIComponent(attachmentId)}`,
    { method: 'DELETE' },
  )
  if (!res.ok) throw new Error(`delete attachment failed: ${res.status}`)
}

export async function fetchPublishPreview(
  contentId: string,
  projectId: string,
): Promise<{
  contentId: string
  channel: string
  body: string
  title?: string
  account: { username?: string; connected: boolean } | null
  approvalStatus: string
}> {
  const q = new URLSearchParams({ projectId })
  const res = await apiFetch(
    `${API_BASE}/api/marketing/content/${encodeURIComponent(contentId)}/publish-preview?${q}`,
  )
  if (!res.ok) throw new Error(`Publish preview failed: ${res.status}`)
  return res.json()
}

export async function publishMarketingContent(
  contentId: string,
  body: { projectId: string; campaignId?: string },
): Promise<{
  post?: unknown
  duplicate: boolean
  campaignStatus?: string
}> {
  const res = await apiFetch(
    `${API_BASE}/api/marketing/content/${encodeURIComponent(contentId)}/publish`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(
      (err as { error?: string }).error ?? `Publish failed: ${res.status}`,
    )
  }
  return res.json()
}

export async function generateMarketingContentImage(
  campaignId: string,
  body: Record<string, unknown>,
): Promise<{
  artifactId: string
  version: number
  publicPath?: string
  contentId: string
}> {
  const res = await apiFetch(
    `${API_BASE}/api/marketing/campaigns/${encodeURIComponent(campaignId)}/generate-image`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
  if (!res.ok) throw new Error(`Generate image failed: ${res.status}`)
  return res.json()
}

export async function fetchProjectKnowledge(
  projectId: string,
  opts?: {
    category?: KnowledgeCategory
    status?: KnowledgeStatus
    q?: string
    all?: boolean
  },
): Promise<KnowledgeItem[]> {
  const q = new URLSearchParams()
  if (opts?.category) q.set('category', opts.category)
  if (opts?.status) q.set('status', opts.status)
  if (opts?.q) q.set('q', opts.q)
  if (opts?.all) q.set('all', '1')
  const qs = q.toString()
  const res = await apiFetch(
    `${API_BASE}/api/projects/${encodeURIComponent(projectId)}/knowledge${qs ? `?${qs}` : ''}`,
  )
  if (!res.ok) throw new Error(`Knowledge fetch failed: ${res.status}`)
  const body = (await res.json()) as { items: KnowledgeItem[] }
  return body.items
}

export async function fetchKnowledgeDetail(
  projectId: string,
  knowledgeId: string,
): Promise<{ item: KnowledgeItem; versions: KnowledgeItem[] }> {
  const res = await apiFetch(
    `${API_BASE}/api/projects/${encodeURIComponent(projectId)}/knowledge/${encodeURIComponent(knowledgeId)}`,
  )
  if (!res.ok) throw new Error(`Knowledge detail failed: ${res.status}`)
  return res.json()
}

export async function createKnowledge(
  projectId: string,
  input: {
    category: KnowledgeCategory
    title: string
    content: string
    createdBy?: string
    sourceArtifactIds?: string[]
    sourceTaskIds?: string[]
    sourceIds?: string[]
    familyId?: string
  },
): Promise<{
  item: KnowledgeItem
  conflicts: KnowledgeConflictCandidate[]
}> {
  const res = await apiFetch(
    `${API_BASE}/api/projects/${encodeURIComponent(projectId)}/knowledge`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  )
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(
      (body as { error?: string }).error ?? `Create knowledge failed: ${res.status}`,
    )
  }
  return res.json()
}

export async function confirmKnowledge(
  projectId: string,
  knowledgeId: string,
  input?: {
    title?: string
    content?: string
    category?: KnowledgeCategory
    createdBy?: string
    resolveConflicts?: 'keep-existing' | 'use-new' | 'keep-both'
    note?: string
  },
): Promise<{
  item: KnowledgeItem
  conflicts: KnowledgeConflictCandidate[]
  needsConflictResolution?: boolean
}> {
  const res = await apiFetch(
    `${API_BASE}/api/projects/${encodeURIComponent(projectId)}/knowledge/${encodeURIComponent(knowledgeId)}/confirm`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input ?? {}),
    },
  )
  const body = (await res.json().catch(() => ({}))) as {
    item?: KnowledgeItem
    conflicts?: KnowledgeConflictCandidate[]
    error?: string
  }
  if (res.status === 409) {
    return {
      item: body.item!,
      conflicts: body.conflicts ?? [],
      needsConflictResolution: true,
    }
  }
  if (!res.ok) {
    throw new Error(body.error ?? `Confirm knowledge failed: ${res.status}`)
  }
  return {
    item: body.item!,
    conflicts: body.conflicts ?? [],
  }
}

export async function rejectKnowledge(
  projectId: string,
  knowledgeId: string,
  note?: string,
): Promise<KnowledgeItem> {
  const res = await apiFetch(
    `${API_BASE}/api/projects/${encodeURIComponent(projectId)}/knowledge/${encodeURIComponent(knowledgeId)}/reject`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note }),
    },
  )
  if (!res.ok) throw new Error(`Reject knowledge failed: ${res.status}`)
  const body = (await res.json()) as { item: KnowledgeItem }
  return body.item
}

export async function createKnowledgeVersion(
  projectId: string,
  familyId: string,
  input: {
    content: string
    title?: string
    category?: KnowledgeCategory
    createdBy?: string
    sourceArtifactIds?: string[]
    sourceTaskIds?: string[]
    sourceIds?: string[]
  },
): Promise<{
  item: KnowledgeItem
  conflicts: KnowledgeConflictCandidate[]
}> {
  const res = await apiFetch(
    `${API_BASE}/api/projects/${encodeURIComponent(projectId)}/knowledge/${encodeURIComponent(familyId)}/versions`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  )
  if (!res.ok) throw new Error(`Knowledge version failed: ${res.status}`)
  return res.json()
}

export async function synthesizeAiResult(input: {
  userRequest: string
  workflow: string
  stepOutputs: Array<{
    agentId: string
    agentName: string
    task: string
    output: string
  }>
}): Promise<{
  output: string
  usage: { model: string; inputTokens?: number; outputTokens?: number }
}> {
  const res = await apiFetch(`${API_BASE}/api/ai/synthesize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(
      (body as { error?: string }).error ?? `Synthesize failed: ${res.status}`,
    )
  }
  return res.json() as Promise<{
    output: string
    usage: { model: string; inputTokens?: number; outputTokens?: number }
  }>
}

export async function fetchCodexStatus(): Promise<{
  available: boolean
  binary: string | null
  label: string
  version?: string
  error?: string
}> {
  const res = await apiFetch(`${API_BASE}/api/codex/status`)
  if (!res.ok) throw new Error(`Codex status failed: ${res.status}`)
  return res.json()
}

export async function preflightCodex(input: {
  projectPath?: string
  mode: CodexMode
  agentId: string
  stepTask: string
}): Promise<{
  ok: boolean
  projectPath?: string
  mode: CodexMode
  agentId: string
  stepTask: string
  readOnly: boolean
  filesMayBeModified: boolean
  codex: { available: boolean; label: string; error?: string }
  error?: string
}> {
  const res = await apiFetch(`${API_BASE}/api/codex/preflight`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  return res.json()
}

export async function runCodexStep(input: {
  runId: string
  taskId: string
  stepId: string
  agentId: string
  mode: CodexMode
  projectId: string
  projectPath: string
  userRequest: string
  stepTask: string
  previousResult?: string
  timeoutMs?: number
}): Promise<{ run: CodexRun; output: string }> {
  const res = await apiFetch(`${API_BASE}/api/codex/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const code = (body as { code?: string }).code
    const userKo = (body as { userMessageKo?: string }).userMessageKo
    const fromRun = (body as { run?: CodexRun }).run?.userMessageKo
    const message =
      userKo ||
      fromRun ||
      codexErrorMessageKo(code, res.status) ||
      (body as { error?: string }).error ||
      `Codex run failed: ${res.status}`
    const err = new Error(message) as Error & {
      run?: CodexRun
      code?: string
      userMessageKo?: string
    }
    err.run = (body as { run?: CodexRun }).run
    err.code = code
    err.userMessageKo = userKo || fromRun || message
    throw err
  }
  return body as { run: CodexRun; output: string }
}

/** Map Codex error categories / HTTP status to Korean UI copy. */
function codexErrorMessageKo(
  code: string | undefined,
  status: number,
): string | null {
  switch (code) {
    case 'UPSTREAM_ERROR':
    case 'CODEX_FAILED':
      return 'Codex 서비스가 일시적으로 응답하지 않습니다.'
    case 'TIMEOUT':
      return 'Codex 실행이 시간 제한을 초과했습니다. 잠시 후 다시 시도해 주세요.'
    case 'CODEX_UNAVAILABLE':
      return 'Codex CLI를 사용할 수 없습니다. 설치 상태와 CODEX_BIN을 확인해 주세요.'
    case 'PROCESS_ERROR':
      return 'Codex 프로세스 실행 중 오류가 발생했습니다.'
    case 'INVALID_PATH':
      return '프로젝트 경로가 유효하지 않거나 접근할 수 없습니다.'
    case 'CANCELLED':
      return 'Codex 실행이 취소되었습니다.'
    case 'VERIFY_FAILED':
      return '검증 명령이 실패했습니다. 결과를 확인한 뒤 다시 시도해 주세요.'
    default:
      break
  }
  if (status === 502 || status === 503 || status === 504) {
    return 'Codex 서비스가 일시적으로 응답하지 않습니다.'
  }
  return null
}

export async function cancelCodexRun(input: {
  runId?: string
  taskId?: string
}): Promise<{ ok: boolean }> {
  const res = await apiFetch(`${API_BASE}/api/codex/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) throw new Error(`Codex cancel failed: ${res.status}`)
  return res.json() as Promise<{ ok: boolean }>
}

export async function fetchCodexSnapshot(snapshotId: string): Promise<{
  id: string
  runId: string
  taskId: string
  projectPath: string
  changedFiles: string[]
  added: string[]
  modified: string[]
  deleted: string[]
  unifiedDiff: string
  diffByFile: Record<string, string>
  createdAt: string
} | null> {
  const res = await apiFetch(`${API_BASE}/api/codex/snapshot/${encodeURIComponent(snapshotId)}`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Snapshot fetch failed: ${res.status}`)
  return res.json()
}

export async function rollbackCodexSnapshot(
  snapshotId: string,
  opts: { projectId: string; projectPath: string },
): Promise<{ ok: boolean; restored: string[]; error?: string }> {
  const res = await apiFetch(`${API_BASE}/api/codex/rollback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      snapshotId,
      projectId: opts.projectId,
      projectPath: opts.projectPath,
    }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    return {
      ok: false,
      restored: [],
      error:
        (body as { userMessageKo?: string }).userMessageKo ??
        (body as { error?: string }).error ??
        `Rollback failed: ${res.status}`,
    }
  }
  return body as { ok: boolean; restored: string[]; error?: string }
}

export async function acquireExecutionLock(input: {
  projectId: string
  taskId: string
  clientId: string
}): Promise<{ ok: boolean; error?: string }> {
  const res = await apiFetch(`${API_BASE}/api/execution/lock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (res.status === 409) {
    const body = await res.json().catch(() => ({}))
    return {
      ok: false,
      error:
        (body as { userMessageKo?: string }).userMessageKo ??
        '다른 탭에서 이미 실행 중입니다.',
    }
  }
  if (!res.ok) return { ok: false, error: `Lock failed: ${res.status}` }
  return { ok: true }
}

export async function releaseExecutionLock(input: {
  projectId: string
  clientId: string
}): Promise<void> {
  await apiFetch(`${API_BASE}/api/execution/lock`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }).catch(() => undefined)
}

/* ─── Phase O1 Usage ─── */

export async function fetchUsageSummary(opts: {
  scope: 'today' | 'project' | 'all'
  projectId?: string
}): Promise<{
  scope: 'today' | 'project' | 'all'
  projectId?: string
  aggregation: UsageAggregation
  recent: ExecutionRecord[]
}> {
  const q = new URLSearchParams()
  q.set('scope', opts.scope)
  if (opts.projectId) q.set('projectId', opts.projectId)
  const res = await apiFetch(`${API_BASE}/api/usage/summary?${q}`)
  if (!res.ok) throw new Error(`Usage summary failed: ${res.status}`)
  return res.json()
}

export async function fetchUsageExecutions(opts?: {
  projectId?: string
  taskId?: string
  agentId?: string
  provider?: ExecutionProvider
  status?: ExecutionStatus
  dateFrom?: string
  dateTo?: string
  q?: string
}): Promise<ExecutionRecord[]> {
  const q = new URLSearchParams()
  if (opts?.projectId) q.set('projectId', opts.projectId)
  if (opts?.taskId) q.set('taskId', opts.taskId)
  if (opts?.agentId) q.set('agentId', opts.agentId)
  if (opts?.provider) q.set('provider', opts.provider)
  if (opts?.status) q.set('status', opts.status)
  if (opts?.dateFrom) q.set('dateFrom', opts.dateFrom)
  if (opts?.dateTo) q.set('dateTo', opts.dateTo)
  if (opts?.q) q.set('q', opts.q)
  const qs = q.toString()
  const res = await apiFetch(
    `${API_BASE}/api/usage/executions${qs ? `?${qs}` : ''}`,
  )
  if (!res.ok) throw new Error(`Usage executions failed: ${res.status}`)
  const body = (await res.json()) as { executions: ExecutionRecord[] }
  return body.executions
}

export async function fetchExecutionDetail(
  id: string,
  projectId?: string,
): Promise<ExecutionRecord> {
  const q = projectId
    ? `?projectId=${encodeURIComponent(projectId)}`
    : ''
  const res = await apiFetch(
    `${API_BASE}/api/usage/executions/${encodeURIComponent(id)}${q}`,
  )
  if (!res.ok) throw new Error(`Execution detail failed: ${res.status}`)
  const body = (await res.json()) as { execution: ExecutionRecord }
  return body.execution
}

export async function fetchProjectUsage(projectId: string): Promise<{
  projectId: string
  totalTasks: number
  aggregation: UsageAggregation
  budget: ProjectBudget | null
  budgetCheck: { overCost: boolean; overTokens: boolean; warning: boolean }
}> {
  const res = await apiFetch(
    `${API_BASE}/api/projects/${encodeURIComponent(projectId)}/usage`,
  )
  if (!res.ok) throw new Error(`Project usage failed: ${res.status}`)
  return res.json()
}

export async function fetchTaskUsage(
  projectId: string,
  taskId: string,
): Promise<{ aggregation: UsageAggregation }> {
  const res = await apiFetch(
    `${API_BASE}/api/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/usage`,
  )
  if (!res.ok) throw new Error(`Task usage failed: ${res.status}`)
  return res.json()
}

export type {
  TaskPriority,
  WorkflowKind,
  ExecutionRecord,
  ExecutionProvider,
  ExecutionStatus,
  UsageAggregation,
  ProjectBudget,
  DeckSettings,
  SettingsBoard,
}

export async function fetchSettingsBoard(): Promise<SettingsBoard> {
  const res = await apiFetch(`${API_BASE}/api/settings`)
  if (!res.ok) throw new Error(`Settings fetch failed: ${res.status}`)
  return res.json()
}

export async function patchSettings(
  patch: Record<string, unknown>,
): Promise<SettingsBoard> {
  const res = await apiFetch(`${API_BASE}/api/settings`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(
      (body as { error?: string }).error ?? `Settings update failed: ${res.status}`,
    )
  }
  return res.json()
}

export async function testOpenAIConnection(): Promise<{
  ran: boolean
  skipped: boolean
  reason: string
  configured: boolean
}> {
  const res = await apiFetch(`${API_BASE}/api/settings/openai/test`, {
    method: 'POST',
  })
  if (!res.ok) throw new Error(`OpenAI test failed: ${res.status}`)
  return res.json()
}
