export type AgentStatus =
  | 'idle'
  | 'working'
  | 'waiting'
  | 'reviewing'
  | 'verifying'
  | 'blocked'
  | 'offline'

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

export type DivisionId =
  | 'academic'
  | 'design'
  | 'engineering'
  | 'finance'
  | 'game-development'
  | 'gis'
  | 'healthcare'
  | 'marketing'
  | 'paid-media'
  | 'product'
  | 'project-management'
  | 'research'
  | 'sales'
  | 'security'
  | 'spatial-computing'
  | 'specialized'
  | 'support'
  | 'testing'
  | 'strategy'

export interface Agent {
  id: string
  name: string
  division: DivisionId
  description: string
  status: AgentStatus
  currentTaskId?: string
  currentTaskLabel?: string
  avatar?: string
  enabled: boolean
  /** Optional speech / thought for Office bubbles */
  speech?: string
}

export interface Project {
  id: string
  name: string
  type: ProjectType
  path?: string
  status: ProjectStatus
  agentIds: string[]
  context?: ProjectContext
  createdAt: string
  updatedAt?: string
}

export interface ProjectContext {
  description?: string
  goals?: string
  constraints?: string
  techStack?: string
}

export type ArtifactType =
  | 'research'
  | 'plan'
  | 'design'
  | 'document'
  | 'code-change'
  | 'review'
  | 'verification'
  | 'report'
  | 'other'

export type ArtifactContentType = 'markdown' | 'text' | 'json' | 'diff'
export type ArtifactStatus = 'draft' | 'final' | 'rejected'

export interface Artifact {
  id: string
  familyId: string
  projectId: string
  taskId?: string
  stepId?: string
  agentId?: string
  type: ArtifactType
  title: string
  summary: string
  contentType: ArtifactContentType
  content: string
  version: number
  status: ArtifactStatus
  metadata?: Record<string, unknown>
  sources?: WebSource[]
  searchedAt?: string
  createdAt: string
  updatedAt: string
}

export type KnowledgeCategory =
  | 'product'
  | 'requirement'
  | 'decision'
  | 'design'
  | 'technical'
  | 'game-design'
  | 'constraint'
  | 'research'
  | 'marketing'
  | 'convention'

export type KnowledgeStatus = 'proposed' | 'confirmed' | 'deprecated'

export interface KnowledgeItem {
  id: string
  familyId: string
  projectId: string
  category: KnowledgeCategory
  title: string
  content: string
  status: KnowledgeStatus
  sourceArtifactIds: string[]
  sourceTaskIds: string[]
  sourceIds: string[]
  createdBy: string
  version: number
  createdAt: string
  updatedAt: string
  note?: string
  conflictWithIds?: string[]
}

export interface KnowledgeConflictCandidate {
  existing: KnowledgeItem
  reason: string
  score: number
}

export type ExecutionProvider =
  | 'openai'
  | 'codex'
  | 'web-search'
  | 'mock'
  | 'human'

export type ExecutionStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type ObservabilityErrorCategory =
  | 'RATE_LIMIT'
  | 'AUTH'
  | 'QUOTA'
  | 'TIMEOUT'
  | 'UPSTREAM'
  | 'INVALID_REQUEST'
  | 'CANCELLED'
  | 'UNKNOWN'

export type ExecutionSourceKind =
  | 'agent-run'
  | 'codex-run'
  | 'web-search'
  | 'manual'

export interface ExecutionRecord {
  id: string
  projectId: string
  taskId: string
  stepId?: string
  agentId?: string
  provider: ExecutionProvider
  model?: string
  operation: string
  status: ExecutionStatus
  startedAt: string
  completedAt?: string
  durationMs?: number
  inputTokens?: number
  outputTokens?: number
  estimatedCost?: number
  costUnknown?: boolean
  errorCategory?: ObservabilityErrorCategory
  userMessage?: string
  technicalSummary?: string
  retryCount: number
  metadata: {
    sourceKind: ExecutionSourceKind
    sourceId: string
    artifactIds?: string[]
    extra?: Record<string, string | number | boolean | null>
  }
}

export interface UsageAggregation {
  calls: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  estimatedCost: number | null
  hasUnknownCost: boolean
  averageDurationMs: number
  failures: number
  retries: number
  openaiCalls: number
  codexRuns: number
  webSearches: number
  mockCalls: number
  humanCalls: number
}

export interface ProjectBudget {
  projectId: string
  maxCost?: number
  maxTokens?: number
  warningThreshold?: number
  updatedAt: string
}

export interface WebSource {
  id: string
  title: string
  url: string
  domain: string
  publishedAt?: string
  snippet?: string
  quality?: string
}

export interface AgentHandoff {
  id: string
  projectId: string
  taskId: string
  fromAgentId: string
  toAgentId: string
  fromStepId?: string
  toStepId?: string
  summary: string
  decisions: string[]
  openQuestions: string[]
  risks: string[]
  artifactIds: string[]
  relevantArtifactIds?: string[]
  relevantSourceIds?: string[]
  createdAt: string
}

export interface PipelineStep {
  id: string
  taskId: string
  agentId: string
  order: number
  label: string
  status: PipelineStepStatus
  provider?: StepProvider
  mode?: CodexMode
  /** Template role / step key (F3) */
  role?: string
  templateStepKey?: string
  approvalKind?: 'plan' | 'change'
  outputArtifactType?: ArtifactType
  inputArtifactTypes?: ArtifactType[]
  /** W1 — this step should run web search when true */
  requiresWebSearch?: boolean
  startedAt?: string
  completedAt?: string
}

export interface Task {
  id: string
  projectId: string
  title: string
  description: string
  status: TaskStatus
  workflow: WorkflowKind
  priority: TaskPriority
  assignedAgentIds: string[]
  /** Agent ids recommended but not on the current project team */
  recommendedExtraAgentIds: string[]
  preferredAgentId?: string
  progress: number
  division?: DivisionId
  etaLabel?: string
  createdAt: string
  updatedAt: string
  startedAt?: string
  completedAt?: string
  /** When true, mock engine fails the next running step once */
  simulateFailure?: boolean
  executionMode?: ExecutionMode
  finalResult?: string
  approval?: TaskApprovalState
  implementationIterations?: ImplementationIteration[]
  pendingImplementFeedback?: string
  verificationFailed?: boolean
  /** F3 workflow template */
  workflowTemplateId?: string
  workflowTemplateVersion?: number
  workflowPreview?: string[]
  agentRoleAssignments?: Record<string, string>
  planSummary?: string
  /** W1 web search */
  webSearchSessions?: WebSearchSession[]
  webSearchFailure?: {
    message: string
    stepId?: string
    at: string
  }
}

export interface WebSearchSession {
  id: string
  taskId: string
  stepId?: string
  agentId?: string
  queries: string[]
  sources: WebSource[]
  searchedAt: string
  status: 'ok' | 'failed'
  error?: string
  results?: Array<{
    query: string
    sources: WebSource[]
    searchedAt: string
  }>
}

export interface AgentRun {
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

export type ExecutionMode = 'MOCK' | 'REAL_AI'

export type StepProvider = 'openai' | 'codex' | 'mock' | 'human'

export type ApprovalDecision = 'pending' | 'approved' | 'rejected' | 'changes_requested'

export interface TaskApprovalState {
  status: ApprovalDecision
  stepId: string
  kind?: 'plan' | 'change'
  runId?: string
  snapshotId?: string
  decidedAt?: string
  note?: string
  feedback?: string
  /** Plan content excerpt for UI */
  planExcerpt?: string
  /** When approval was requested (Simplify-1 inbox) */
  requestedAt?: string
}

export interface ImplementationIteration {
  index: number
  runId: string
  status: 'pending_approval' | 'approved' | 'rejected' | 'changes_requested'
  feedback?: string
  at: string
  summary?: string
}

export type CodexMode = 'inspect' | 'implement' | 'review' | 'verify'

export type CodexRunStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type CodexErrorCategory =
  | 'CODEX_UNAVAILABLE'
  | 'UPSTREAM_ERROR'
  | 'TIMEOUT'
  | 'PROCESS_ERROR'
  | 'INVALID_PATH'
  | 'CANCELLED'
  | 'UNKNOWN'

export interface VerificationCommand {
  name: string
  command: string
  status: 'pass' | 'fail' | 'skipped'
  exitCode: number | null
  outputSnippet?: string
}

export interface CodexRun {
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
  commands?: VerificationCommand[]
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
  errorCategory?: CodexErrorCategory
  stderrSummary?: string
  attempt?: number
  retries?: number
}

export interface RoutePlanStep {
  agentId: string
  task: string
  provider?: StepProvider
  mode?: CodexMode
}

export interface RoutePlan {
  workflow: WorkflowKind
  reason: string
  steps: RoutePlanStep[]
}

export interface WeeklyGoal {
  id: string
  title: string
  completed: number
  total: number
}

export interface ChatMessage {
  id: string
  role: 'assistant' | 'user' | 'system'
  content: string
  createdAt: string
  suggestedAgents?: Array<{
    agentId: string
    label: string
    statusDot: AgentStatus
  }>
  workProposal?: {
    title: string
    description: string
    workflow: WorkflowKind
    assignedAgentIds: string[]
    recommendedExtraAgentIds: string[]
    stepLabels: string[]
    routePlan?: RoutePlan
    executionMode?: ExecutionMode
    workflowTemplateId?: string
    workflowTemplateName?: string
    workflowPreview?: string[]
    preflight?: {
      projectPath?: string
      readOnly?: boolean
      filesMayBeModified?: boolean
    }
  }
  taskResult?: {
    taskId: string
    title: string
    summary: string
  }
}

export type AiProviderMode = 'mock' | 'not-configured' | 'openai'

export interface AiProviderState {
  mode: AiProviderMode
  label: string
  configured: boolean
  providerName: 'none' | 'openai'
  model?: string
  codex?: {
    available: boolean
    binary: string | null
    label: string
    version?: string
    error?: string
  }
}

export type ModelProfileId = 'FAST' | 'STANDARD' | 'REASONING'

export interface ModelProfile {
  id: ModelProfileId
  label: string
  description: string
  model: string
  roles: string[]
}

export type SearchProviderId =
  | 'openai-web-search'
  | 'steam'
  | 'duckduckgo'

export interface SearchProviderSetting {
  id: SearchProviderId
  label: string
  enabled: boolean
  order: number
}

export type SearchFailPolicy = 'block-step' | 'allow-continue-without'

export interface DeckSettings {
  version: 1
  openai: { enabled: boolean; model: string }
  modelProfiles: Record<ModelProfileId, ModelProfile>
  codex: { enabled: boolean; binaryPath?: string }
  webSearch: {
    providers: SearchProviderSetting[]
    failPolicy: SearchFailPolicy
  }
  agents: { codexAgentsDir?: string; agencySourceDir?: string }
  project: { requireProjectPath: boolean; sandboxNote: string }
  safety: {
    humanApproval: true
    verifyAfterCodeChange: true
    codeReview: boolean
    realityCheck: boolean
  }
  retry: {
    openaiMaxRetries: number
    codexMaxRetries: number
    webSearchMaxRetries: number
    implementAutoRetryRestricted: true
    implementNote: string
  }
  budget: {
    maxCost?: number
    maxTokens?: number
    warningThreshold: number
  }
  updatedAt: string
}

export type StatusLevel = 'ok' | 'warn' | 'off'

export interface SystemStatusItem {
  id: string
  label: string
  level: StatusLevel
  value: string
}

export interface DiagnosticCheck {
  id: string
  label: string
  ok: boolean
  detail: string
}

export interface SettingsBoard {
  settings: DeckSettings
  status: SystemStatusItem[]
  runtime: {
    openai: {
      configured: boolean
      enabled: boolean
      model: string | null
      label: string
      apiKeyConfigured: boolean
    }
    codex: {
      available: boolean
      enabled: boolean
      binary: string | null
      label: string
      version?: string
      authMode: 'local-login' | 'api-key' | 'unknown'
      apiKeyConfigured: boolean
      sandboxPolicy: string
    }
    webSearch: {
      configured: boolean
      primaryLabel: string
      fallbackLabels: string[]
      failPolicy: SearchFailPolicy
    }
    agents: {
      total: number
      source: string
      codexAgentsDir: string | null
      agencySourceDir: string | null
      divisionMapped: number
      divisionTotal: number
    }
    persistence: {
      writable: boolean
      settingsPath: string
    }
  }
  diagnostics: DiagnosticCheck[]
  advanced?: {
    openaiEnvKeys: string[]
    codexEnvKeys: string[]
    note: string
  }
  rejectedSafety?: string[]
}

export interface DepartmentMeta {
  id: DivisionId
  label: string
  shortLabel: string
  color: string
  priority: boolean
}
