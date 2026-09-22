/**
 * Development / demo fixtures only.
 * SEED_PROJECT and SEED_AGENTS must NOT be treated as production data
 * or auto-hydrated into the live project store.
 */
import type {
  Agent,
  AiProviderState,
  ChatMessage,
  Project,
  Task,
  WeeklyGoal,
} from '../domain/types'
import { MOCK_REGISTRY } from './mockRegistry'

const now = new Date().toISOString()

/** Explicit flag — demo seed is never production persistence. */
export const IS_DEMO_SEED = true as const

const TEAM_IDS = [
  'trend-researcher',
  'feedback-synthesizer',
  'research-synthesist',
  'game-designer',
  'level-designer',
  'technical-artist',
  'ui-designer',
  'frontend-developer',
  'backend-architect',
  'reality-checker',
  'api-tester',
  'content-creator',
  'app-store-optimizer',
  'narrative-designer',
  'growth-hacker',
  'code-reviewer',
  'ux-researcher',
  'sprint-prioritizer',
  'agents-orchestrator',
  'studio-producer',
  'devops-automator',
  'application-security-engineer',
  'mobile-app-builder',
  'product-manager',
] as const

const STATUS_PLAN: Array<{
  id: (typeof TEAM_IDS)[number]
  status: Agent['status']
  taskId?: string
  taskLabel?: string
  speech?: string
}> = [
  {
    id: 'trend-researcher',
    status: 'working',
    taskId: 'task-market',
    taskLabel: 'Steam game market trend research',
    speech: "I'm organizing the market research!",
  },
  {
    id: 'research-synthesist',
    status: 'working',
    taskId: 'task-market',
    taskLabel: 'Steam game market trend research',
    speech: 'Competitor analysis complete! Writing report.',
  },
  {
    id: 'feedback-synthesizer',
    status: 'working',
    taskId: 'task-concepts',
    taskLabel: 'Game concept shortlist',
    speech: 'Synthesizing concept feedback...',
  },
  {
    id: 'game-designer',
    status: 'working',
    taskId: 'task-core-loop',
    taskLabel: 'Core loop design',
    speech: 'Designing the core loop...',
  },
  {
    id: 'ui-designer',
    status: 'working',
    taskId: 'task-ui-draft',
    taskLabel: 'UI draft screens',
    speech: 'Making the UI draft!',
  },
  {
    id: 'frontend-developer',
    status: 'working',
    taskId: 'task-player-move',
    taskLabel: 'Player movement system',
    speech: 'Implementing game logic... (Player movement)',
  },
  {
    id: 'backend-architect',
    status: 'working',
    taskId: 'task-player-move',
    taskLabel: 'Player movement system',
  },
  {
    id: 'api-tester',
    status: 'working',
    taskId: 'task-test-cases',
    taskLabel: 'Core loop test cases',
    speech: 'Running test cases, 2 bugs found.',
  },
  {
    id: 'app-store-optimizer',
    status: 'working',
    taskId: 'task-aso',
    taskLabel: 'Store page keyword analysis',
    speech: 'Analyzing store page keywords.',
  },
  { id: 'level-designer', status: 'waiting', speech: 'Waiting on art style guide...' },
  { id: 'technical-artist', status: 'waiting' },
  { id: 'ux-researcher', status: 'waiting' },
  { id: 'narrative-designer', status: 'waiting' },
  { id: 'content-creator', status: 'waiting' },
  { id: 'growth-hacker', status: 'waiting' },
  { id: 'code-reviewer', status: 'waiting' },
  { id: 'sprint-prioritizer', status: 'waiting' },
  { id: 'product-manager', status: 'waiting' },
  { id: 'mobile-app-builder', status: 'waiting' },
  { id: 'agents-orchestrator', status: 'reviewing', speech: 'Meeting in progress...' },
  { id: 'studio-producer', status: 'reviewing' },
  { id: 'devops-automator', status: 'reviewing' },
  { id: 'reality-checker', status: 'idle', speech: 'Have a cup of coffee!' },
  { id: 'application-security-engineer', status: 'offline' },
]

function buildAgents(): Agent[] {
  const byId = new Map(MOCK_REGISTRY.map((a) => [a.id, { ...a }]))
  for (const plan of STATUS_PLAN) {
    const agent = byId.get(plan.id)
    if (!agent) continue
    agent.status = plan.status
    agent.currentTaskId = plan.taskId
    agent.currentTaskLabel = plan.taskLabel
    agent.speech = plan.speech
  }
  return TEAM_IDS.map((id) => byId.get(id)).filter(Boolean) as Agent[]
}

export const SEED_PROJECT: Project = {
  id: 'proj-steam-1',
  name: 'Steam Game #1',
  type: 'steam-game',
  status: 'active',
  agentIds: [...TEAM_IDS],
  createdAt: now,
}

export const SEED_AGENTS: Agent[] = buildAgents()

export const SEED_TASKS: Task[] = []

/** Demo-only fixtures kept for reference — not hydrated into live store. */
export const SEED_TASKS_DEMO: Task[] = [
  {
    id: 'task-market',
    projectId: SEED_PROJECT.id,
    title: 'Steam game market trend research',
    description: 'Survey genre trends, competitor pricing, and wishlist signals.',
    status: 'running',
    workflow: 'RESEARCH',
    priority: 'normal',
    assignedAgentIds: ['trend-researcher', 'research-synthesist'],
    recommendedExtraAgentIds: [],
    progress: 70,
    division: 'research',
    etaLabel: '25m',
    createdAt: now,
    updatedAt: now,
  },
]

export const SEED_GOALS: WeeklyGoal[] = [
  { id: 'g1', title: '게임 컨셉 3개 확정', completed: 2, total: 3 },
  { id: 'g2', title: '아트 스타일 가이드', completed: 1, total: 1 },
  { id: 'g3', title: '코어 루프 프로토타입', completed: 0, total: 1 },
  { id: 'g4', title: 'Steam 페이지 초안', completed: 0, total: 1 },
]

export const SEED_CHAT: ChatMessage[] = []

export const SEED_AI_PROVIDER: AiProviderState = {
  mode: 'mock',
  label: 'Mock Mode',
  configured: false,
  providerName: 'none',
}

export const SEED_USER = {
  name: 'gyubin',
  role: 'AI Studio Owner',
}
