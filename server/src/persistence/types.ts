export type ProjectType =
  | 'steam-game'
  | 'mobile-game'
  | 'mobile-app'
  | 'web-app'
  | 'saas'
  | 'website'
  | 'custom'

export type ProjectStatus = 'planning' | 'active' | 'paused' | 'completed'

export type TaskStatus =
  | 'queued'
  | 'running'
  | 'paused'
  | 'review'
  | 'awaiting_approval'
  | 'rejected'
  | 'verifying'
  | 'completed'
  | 'failed'
  | 'blocked'
  | 'cancelled'
  | 'interrupted'

export type PipelineStepStatus =
  | 'queued'
  | 'waiting'
  | 'running'
  | 'reviewing'
  | 'awaiting_approval'
  | 'completed'
  | 'failed'
  | 'blocked'

export type WorkflowKind =
  | 'IDEA'
  | 'GAME_IDEA'
  | 'RESEARCH'
  | 'PLAN'
  | 'BUILD'
  | 'DESIGN'
  | 'REVIEW'
  | 'MARKETING'
  | 'RELEASE'

export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent'

export type ExecutionMode = 'MOCK' | 'REAL_AI'

export type StepProvider = 'openai' | 'codex' | 'mock' | 'human'
export type CodexMode = 'inspect' | 'implement' | 'review' | 'verify'

export type ApprovalDecision =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'changes_requested'

export interface StoredTaskApproval {
  status: ApprovalDecision
  stepId: string
  kind?: 'plan' | 'change'
  runId?: string
  snapshotId?: string
  decidedAt?: string
  note?: string
  feedback?: string
  planExcerpt?: string
}

export interface StoredImplementationIteration {
  index: number
  runId: string
  status: 'pending_approval' | 'approved' | 'rejected' | 'changes_requested'
  feedback?: string
  at: string
  summary?: string
}

export type CodexRunStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface StoredVerificationCommand {
  name: string
  command: string
  status: 'pass' | 'fail' | 'skipped'
  exitCode: number | null
  outputSnippet?: string
}

export interface StoredCodexRun {
  id: string
  taskId: string
  stepId: string
  agentId: string
  mode: CodexMode
  projectPath: string
  status: CodexRunStatus
  summary?: string
  changedFiles?: string[]
  addedFiles?: string[]
  modifiedFiles?: string[]
  deletedFiles?: string[]
  snapshotId?: string
  unifiedDiff?: string
  diffByFile?: Record<string, string>
  commands?: StoredVerificationCommand[]
  activity?: string
  startedAt: string
  completedAt?: string
  error?: string
  userMessageKo?: string
  iteration?: number
  durationMs?: number
  exitCode?: number | null
  timedOut?: boolean
  cancelled?: boolean
  errorCategory?: string
  stderrSummary?: string
  attempt?: number
  retries?: number
}

export interface StoredProjectContext {
  description?: string
  goals?: string
  constraints?: string
  techStack?: string
}

export interface StoredProject {
  id: string
  name: string
  type: ProjectType
  path?: string
  status: ProjectStatus
  agentIds: string[]
  context?: StoredProjectContext
  createdAt: string
  updatedAt: string
  isDemo?: boolean
}

export interface StoredPipelineStep {
  id: string
  taskId: string
  agentId: string
  order: number
  label: string
  status: PipelineStepStatus
  provider?: StepProvider
  mode?: CodexMode
  role?: string
  templateStepKey?: string
  approvalKind?: 'plan' | 'change'
  outputArtifactType?: string
  inputArtifactTypes?: string[]
  requiresWebSearch?: boolean
  startedAt?: string
  completedAt?: string
}

export interface StoredTask {
  id: string
  projectId: string
  title: string
  description: string
  status: TaskStatus
  workflow: WorkflowKind
  priority: TaskPriority
  assignedAgentIds: string[]
  recommendedExtraAgentIds: string[]
  preferredAgentId?: string
  progress: number
  createdAt: string
  updatedAt: string
  startedAt?: string
  completedAt?: string
  simulateFailure?: boolean
  executionMode?: ExecutionMode
  finalResult?: string
  approval?: StoredTaskApproval
  implementationIterations?: StoredImplementationIteration[]
  pendingImplementFeedback?: string
  verificationFailed?: boolean
  workflowTemplateId?: string
  workflowTemplateVersion?: number
  workflowPreview?: string[]
  agentRoleAssignments?: Record<string, string>
  planSummary?: string
  /** W1 web search history (persisted with task) */
  webSearchSessions?: StoredWebSearchSession[]
  webSearchFailure?: {
    message: string
    stepId?: string
    at: string
  }
}

export interface StoredWebSource {
  id: string
  title: string
  url: string
  domain: string
  publishedAt?: string
  snippet?: string
  quality?: string
}

export interface StoredWebSearchSession {
  id: string
  taskId: string
  stepId?: string
  agentId?: string
  queries: string[]
  sources: StoredWebSource[]
  searchedAt: string
  status: 'ok' | 'failed'
  error?: string
  results?: Array<{
    query: string
    sources: StoredWebSource[]
    searchedAt: string
  }>
}

export interface StoredAgentRun {
  id: string
  taskId: string
  stepId: string
  agentId: string
  status: 'running' | 'completed' | 'failed'
  inputSummary: string
  output: string
  startedAt: string
  completedAt?: string
  error?: string
  model?: string
  inputTokens?: number
  outputTokens?: number
}

export interface ProjectStoreSnapshot {
  version: 2 | 3 | 4 | 5
  /** Monotonic revision for work-state optimistic concurrency (Harden-0). */
  revision: number
  activeProjectId: string | null
  projects: StoredProject[]
  tasks: StoredTask[]
  pipelineSteps: StoredPipelineStep[]
  agentRuns: StoredAgentRun[]
  codexRuns?: StoredCodexRun[]
}

export interface ProjectRepository {
  load(): Promise<ProjectStoreSnapshot>
  save(snapshot: ProjectStoreSnapshot): Promise<void>
}
