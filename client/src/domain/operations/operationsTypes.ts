/**
 * Project Operations Foundation — Goals / Routines / Runs.
 * Execution still goes through existing Task + Workflow + Safety.
 */

import type { AgentCapability } from '../capabilities/capabilityTypes'

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

export type ProjectGoalPriority = 'low' | 'normal' | 'high'

export interface ProjectGoal {
  id: string
  projectId: string
  type: ProjectGoalType
  title: string
  description?: string
  status: ProjectGoalStatus
  priority: ProjectGoalPriority
  successCriteria?: string[]
  createdAt: string
  updatedAt: string
}

export type RoutineStatus = 'active' | 'paused' | 'archived'

export type RoutineTrigger = 'manual' | 'scheduled' | 'event'

export type RoutineScheduleKind = 'daily' | 'weekly' | 'monthly' | 'cron'

export interface RoutineSchedule {
  kind: RoutineScheduleKind
  expression?: string
  daysOfWeek?: number[]
  time?: string
  timezone?: string
}

export interface RoutineExecutionPolicy {
  autoResearch: boolean
  autoPlan: boolean
  autoCreateContent: boolean
  requireApprovalForWrite: boolean
  requireApprovalForExternalAction: boolean
  autoStartTasks?: boolean
  maxTasksPerRun?: number
  maxEstimatedCost?: number
}

export interface ProjectRoutine {
  id: string
  projectId: string
  goalId?: string
  name: string
  description: string
  status: RoutineStatus
  trigger: RoutineTrigger
  schedule?: RoutineSchedule
  requiredCapabilities: AgentCapability[]
  /** Capabilities known to be future/unavailable — shown, never faked */
  futureCapabilities?: AgentCapability[]
  workflowTemplateId?: string
  executionPolicy: RoutineExecutionPolicy
  templateId?: string
  lastRunAt?: string
  nextRunAt?: string
  createdAt: string
  updatedAt: string
}

export type RoutineRunStatus =
  | 'queued'
  | 'running'
  | 'awaiting_approval'
  | 'blocked'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type RoutineTriggerSource = 'manual' | 'scheduled' | 'catch-up'

export interface RoutineRunAssignment {
  teamAgentIds?: string[]
  specialistAgentIds?: string[]
  preferredAgentId?: string
  source?: 'team' | 'specialist' | 'mixed'
}

export interface RoutineRun {
  id: string
  routineId: string
  projectId: string
  status: RoutineRunStatus
  taskIds: string[]
  scheduledFor?: string
  triggeredAt?: string
  triggerSource?: RoutineTriggerSource
  startedAt?: string
  completedAt?: string
  summary?: string
  missingCapabilities?: AgentCapability[]
  specialistAgentIds?: string[]
  assignment?: RoutineRunAssignment
  createdAt: string
}

export type TaskSourceType = 'user' | 'routine' | 'system'

export interface TaskSource {
  type: TaskSourceType
  routineId?: string
  routineRunId?: string
}

/** Optional project lifecycle stage — separate from ProjectType */
export type ProjectStage =
  | 'idea'
  | 'development'
  | 'pre-launch'
  | 'launched'
  | 'maintenance'

export interface OperationsSnapshot {
  version: 1
  projectId: string
  goals: ProjectGoal[]
  routines: ProjectRoutine[]
  runs: RoutineRun[]
  /** Optional lifecycle stage for future Wizard */
  stage?: ProjectStage
}

export const DEFAULT_EXECUTION_POLICY: RoutineExecutionPolicy = {
  autoResearch: true,
  autoPlan: true,
  autoCreateContent: true,
  requireApprovalForWrite: true,
  requireApprovalForExternalAction: true,
  autoStartTasks: true,
  maxTasksPerRun: 3,
}
