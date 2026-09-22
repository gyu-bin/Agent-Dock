import type { CodexMode, StepProvider } from './types.js'

const CODEX_AGENT_IDS = new Set([
  'frontend-developer',
  'backend-architect',
  'mobile-app-builder',
  'code-reviewer',
  'devops-automator',
  'ai-engineer',
  'rapid-prototyper',
  'senior-developer',
  'fullstack-developer',
  'api-tester',
])

const CODEX_ID_HINTS = [
  /developer/,
  /architect/,
  /engineer/,
  /builder/,
  /code-reviewer/,
  /devops/,
  /sre/,
]

export function isCodexAgent(agentId: string): boolean {
  const id = agentId.toLowerCase()
  if (CODEX_AGENT_IDS.has(id)) return true
  return CODEX_ID_HINTS.some((re) => re.test(id))
}

export function inferCodexMode(input: {
  agentId: string
  stepTask: string
  workflow?: string
  userRequest?: string
}): CodexMode {
  const text = `${input.stepTask} ${input.userRequest ?? ''}`.toLowerCase()
  const id = input.agentId.toLowerCase()

  if (
    /verify|typecheck|lint|test|build|검증|타입체크/.test(text) ||
    id.includes('tester') ||
    id.includes('qa')
  ) {
    return 'verify'
  }
  if (
    /review|리뷰|audit|inspect.*change|변경.*검토/.test(text) ||
    id.includes('code-reviewer') ||
    id.includes('reviewer')
  ) {
    return 'review'
  }
  if (
    /inspect|analy[sz]e|구조|분석|read.?only|파일은 수정하지|do not modify|don't modify|수정하지\s*마/.test(
      text,
    )
  ) {
    return 'inspect'
  }
  if (
    /implement|fix|bug|build|코딩|구현|개발|만들어|추가|refactor/.test(text) ||
    /developer|builder|architect|engineer/.test(id)
  ) {
    return 'implement'
  }
  if (input.workflow === 'REVIEW') return 'review'
  if (input.workflow === 'BUILD') return 'implement'
  if (input.workflow === 'RELEASE') return 'verify'
  return 'inspect'
}

export function inferStepProvider(input: {
  agentId: string
  workflow?: string
  stepTask?: string
  userRequest?: string
  preferred?: StepProvider
}): StepProvider {
  if (input.preferred) return input.preferred
  const text = `${input.stepTask ?? ''} ${input.userRequest ?? ''}`.toLowerCase()
  const wf = input.workflow

  // Explicit OpenAI / strategy agents stay on OpenAI even in BUILD hybrids
  if (
    /reality-checker|product-manager|trend-researcher|game-designer|growth|marketing|content/.test(
      input.agentId,
    )
  ) {
    return 'openai'
  }

  if (isCodexAgent(input.agentId)) return 'codex'

  if (wf === 'BUILD' || wf === 'REVIEW' || wf === 'RELEASE') {
    if (isCodexAgent(input.agentId)) return 'codex'
  }

  if (/codex|repository|repo|코드베이스|프로젝트 구조/.test(text)) {
    return 'codex'
  }

  return 'openai'
}

export function defaultProvidersForWorkflow(workflow: string): {
  preferCodex: boolean
} {
  return {
    preferCodex:
      workflow === 'BUILD' ||
      workflow === 'REVIEW' ||
      workflow === 'RELEASE',
  }
}
