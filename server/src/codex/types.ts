export type CodexMode = 'inspect' | 'implement' | 'review' | 'verify'

export type StepProvider = 'openai' | 'codex' | 'mock' | 'human'

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

export interface CodexRunDiagnostics {
  durationMs: number
  exitCode: number | null
  timedOut: boolean
  cancelled: boolean
  errorCategory?: CodexErrorCategory
  stderrSummary?: string
  attempt?: number
  retries?: number
}

export interface VerificationCommand {
  name: string
  command: string
  status: 'pass' | 'fail' | 'skipped'
  exitCode: number | null
  outputSnippet?: string
}

export interface CodexRunRecord {
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
  /** User-facing Korean message (preferred for UI) */
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
  diagnostics?: CodexRunDiagnostics
}

export interface CodexProviderState {
  available: boolean
  binary: string | null
  label: string
  version?: string
  error?: string
}

export interface CodexExecuteInput {
  runId: string
  taskId: string
  stepId: string
  agentId: string
  mode: CodexMode
  /** Harden-0 ownership */
  projectId: string
  projectPath: string
  userRequest: string
  stepTask: string
  previousResult?: string
  timeoutMs?: number
}

export interface CodexExecuteResult {
  run: CodexRunRecord
  output: string
}
