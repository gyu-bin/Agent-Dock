import type { AgentCapability } from '../capabilities/capabilityTypes'
import {
  DEFAULT_EXECUTION_POLICY,
  type ProjectRoutine,
  type RoutineExecutionPolicy,
} from './operationsTypes'

export type RoutineTemplateId = 'WEEKLY_MARKETING' | 'COMPETITOR_RESEARCH'

export interface RoutineTemplate {
  id: RoutineTemplateId
  name: string
  description: string
  goalTypeHint: 'marketing' | 'research'
  requiredCapabilities: AgentCapability[]
  futureCapabilities: AgentCapability[]
  workflowTemplateId?: string
  defaultSchedule: ProjectRoutine['schedule']
  executionPolicy: RoutineExecutionPolicy
}

export const ROUTINE_TEMPLATES: RoutineTemplate[] = [
  {
    id: 'WEEKLY_MARKETING',
    name: '주간 마케팅',
    description:
      '조사 → 전략 → 콘텐츠. 게시/분석은 Tool 연결 후 활성화됩니다.',
    goalTypeHint: 'marketing',
    requiredCapabilities: [
      'research.web',
      'marketing.research',
      'marketing.plan',
      'marketing.content',
    ],
    futureCapabilities: [
      'image.generate',
      'social.publish',
      'analytics.read',
    ],
    workflowTemplateId: 'MARKETING_CAMPAIGN',
    defaultSchedule: {
      kind: 'weekly',
      daysOfWeek: [1],
      time: '09:00',
      timezone: 'Asia/Seoul',
    },
    executionPolicy: { ...DEFAULT_EXECUTION_POLICY },
  },
  {
    id: 'COMPETITOR_RESEARCH',
    name: '경쟁사 조사',
    description: '시장/경쟁 리서치 → Research Artifact → Knowledge 후보',
    goalTypeHint: 'research',
    requiredCapabilities: [
      'research.web',
      'research.analyze',
      'research.synthesize',
      'document.write',
    ],
    futureCapabilities: [],
    workflowTemplateId: 'RESEARCH_TO_BUILD',
    defaultSchedule: {
      kind: 'weekly',
      daysOfWeek: [3],
      time: '10:00',
      timezone: 'Asia/Seoul',
    },
    executionPolicy: {
      ...DEFAULT_EXECUTION_POLICY,
      autoCreateContent: false,
      maxTasksPerRun: 1,
    },
  },
]

export function getRoutineTemplate(
  id: RoutineTemplateId,
): RoutineTemplate | undefined {
  return ROUTINE_TEMPLATES.find((t) => t.id === id)
}
