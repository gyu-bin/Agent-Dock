/** Server-side Project Operations types (mirror of client domain). */

export type ProjectGoalType =
  | 'growth'
  | 'marketing'
  | 'development'
  | 'quality'
  | 'research'
  | 'launch'
  | 'maintenance'
  | 'custom'

export type ProjectGoalStatus =
  | 'active'
  | 'paused'
  | 'completed'
  | 'archived'

export interface StoredProjectGoal {
  id: string
  projectId: string
  type: ProjectGoalType
  title: string
  description?: string
  status: ProjectGoalStatus
  priority: 'low' | 'normal' | 'high'
  successCriteria?: string[]
  createdAt: string
  updatedAt: string
}

export interface StoredRoutineExecutionPolicy {
  autoResearch: boolean
  autoPlan: boolean
  autoCreateContent: boolean
  requireApprovalForWrite: boolean
  requireApprovalForExternalAction: boolean
  /** When true, scheduler/manual path may create+queue Tasks automatically */
  autoStartTasks?: boolean
  maxTasksPerRun?: number
  maxEstimatedCost?: number
}

export interface StoredRoutineSchedule {
  kind: 'daily' | 'weekly' | 'monthly' | 'cron'
  expression?: string
  daysOfWeek?: number[]
  time?: string
  timezone?: string
}

export interface StoredProjectRoutine {
  id: string
  projectId: string
  goalId?: string
  name: string
  description: string
  status: 'active' | 'paused' | 'archived'
  trigger: 'manual' | 'scheduled' | 'event'
  schedule?: StoredRoutineSchedule
  requiredCapabilities: string[]
  futureCapabilities?: string[]
  workflowTemplateId?: string
  executionPolicy: StoredRoutineExecutionPolicy
  templateId?: string
  lastRunAt?: string
  nextRunAt?: string
  createdAt: string
  updatedAt: string
}

export type RoutineTriggerSource = 'manual' | 'scheduled' | 'catch-up'

export type StoredRoutineRunStatus =
  | 'queued'
  | 'running'
  | 'awaiting_approval'
  | 'blocked'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface StoredRoutineRunAssignment {
  teamAgentIds?: string[]
  specialistAgentIds?: string[]
  preferredAgentId?: string
  source?: 'team' | 'specialist' | 'mixed'
}

export interface StoredRoutineRun {
  id: string
  routineId: string
  projectId: string
  status: StoredRoutineRunStatus
  taskIds: string[]
  /** Idempotency: routineId + scheduledFor */
  scheduledFor?: string
  triggeredAt?: string
  triggerSource?: RoutineTriggerSource
  startedAt?: string
  completedAt?: string
  summary?: string
  missingCapabilities?: string[]
  specialistAgentIds?: string[]
  assignment?: StoredRoutineRunAssignment
  createdAt: string
}

export type ProjectStage =
  | 'idea'
  | 'development'
  | 'pre-launch'
  | 'launched'
  | 'maintenance'

export interface OperationsStoreSnapshot {
  version: 1
  projectId: string
  goals: StoredProjectGoal[]
  routines: StoredProjectRoutine[]
  runs: StoredRoutineRun[]
  stage?: ProjectStage
}

export interface OperationsRepository {
  load(projectId: string): Promise<OperationsStoreSnapshot>
  save(snapshot: OperationsStoreSnapshot): Promise<void>
  listProjectIds(): Promise<string[]>
  deleteProject(projectId: string): Promise<void>
}

export const DEFAULT_POLICY: StoredRoutineExecutionPolicy = {
  autoResearch: true,
  autoPlan: true,
  autoCreateContent: true,
  requireApprovalForWrite: true,
  requireApprovalForExternalAction: true,
  autoStartTasks: true,
  maxTasksPerRun: 3,
}

/** Capabilities that have no real Tool yet — never fake-execute.
 * image.generate / social.publish / analytics.read are runtime-gated.
 */
export const FUTURE_CAPABILITIES = new Set(['video.generate'])

/** Runtime-gated capabilities checked via Tool Registry / providers. */
export const RUNTIME_GATED_CAPABILITIES = new Set([
  'image.generate',
  'social.publish',
  'analytics.read',
])
