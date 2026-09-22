import type {
  AgentHandoff,
  ArtifactType,
} from '../persistence/artifactTypes.js'

/** Infer artifact type from agent id / step label — no extra LLM call. */
export function inferArtifactType(input: {
  agentId: string
  stepLabel?: string
  workflow?: string
  mode?: string
}): ArtifactType {
  const id = input.agentId.toLowerCase()
  const label = `${input.stepLabel ?? ''} ${input.workflow ?? ''}`.toLowerCase()

  if (input.mode === 'implement') return 'code-change'
  if (input.mode === 'verify') return 'verification'
  if (input.mode === 'review') return 'review'

  if (/research|trend|market|analyst/.test(id) || /리서치|조사|research/.test(label))
    return 'research'
  if (/design|ux|ui|game-designer|visual/.test(id) || /디자인|컨셉|design/.test(label))
    return 'design'
  if (/product|planner|manager|strateg/.test(id) || /기획|plan|roadmap/.test(label))
    return 'plan'
  if (/reality|review|critique|qa/.test(id) || /검토|리뷰|현실/.test(label))
    return 'review'
  if (/report|final|summary/.test(label)) return 'report'
  return 'document'
}

/**
 * Only persist results that are reusable (length + role heuristics).
 * Tiny acknowledgements / empty outputs are skipped.
 */
export function shouldCreateArtifact(input: {
  output: string
  agentId: string
  stepLabel?: string
  mode?: string
  provider?: string
}): boolean {
  const text = input.output.trim()
  if (text.length < 120) return false
  if (input.mode === 'inspect') return false
  if (input.provider === 'human') return false
  // Always keep codex verify/review/implement (implement gated by approval separately)
  if (input.mode === 'verify' || input.mode === 'review' || input.mode === 'implement')
    return true
  // Skip pure orchestrator glue
  if (/orchestrator|agents-orchestrator/.test(input.agentId)) return false
  return true
}

export function defaultArtifactTitle(input: {
  type: ArtifactType
  stepLabel?: string
  agentId: string
}): string {
  if (input.stepLabel?.trim()) return input.stepLabel.trim().slice(0, 80)
  const map: Record<ArtifactType, string> = {
    research: '리서치 결과',
    plan: '기획안',
    design: '디자인 결과',
    document: '문서',
    'code-change': '코드 변경',
    review: '리뷰',
    verification: '검증 결과',
    report: '보고서',
    other: '결과물',
  }
  return map[input.type]
}

function extractBullets(text: string, keywords: RegExp, limit = 6): string[] {
  const lines = text.split(/\r?\n/)
  const hits: string[] = []
  for (const line of lines) {
    const cleaned = line.replace(/^[-*•\d.)\s]+/, '').trim()
    if (cleaned.length < 8) continue
    if (keywords.test(line) || keywords.test(cleaned)) {
      hits.push(cleaned.slice(0, 200))
      if (hits.length >= limit) break
    }
  }
  return hits
}

/**
 * Build structured handoff from step output without an extra LLM call.
 */
export function buildHandoffFromOutput(input: {
  projectId: string
  taskId: string
  fromAgentId: string
  toAgentId: string
  fromStepId?: string
  toStepId?: string
  output: string
  artifactIds: string[]
}): Omit<AgentHandoff, 'id' | 'createdAt'> {
  const text = input.output.trim()
  const firstPara =
    text.split(/\n\s*\n/).find((p) => p.trim().length > 40)?.trim() ??
    text.slice(0, 400)
  const summary = firstPara.replace(/\s+/g, ' ').slice(0, 600)

  const decisions = extractBullets(
    text,
    /decision|결정|선택한|권장|recommend|conclude/i,
  )
  const openQuestions = extractBullets(
    text,
    /\?$|question|미결|확인 필요|open|unknown|불확실/i,
  )
  const risks = extractBullets(
    text,
    /risk|위험|주의|limitation|제약|trade-?off|우려/i,
  )

  return {
    projectId: input.projectId,
    taskId: input.taskId,
    fromAgentId: input.fromAgentId,
    toAgentId: input.toAgentId,
    fromStepId: input.fromStepId,
    toStepId: input.toStepId,
    summary: summary || `${input.fromAgentId} completed step`,
    decisions,
    openQuestions,
    risks,
    artifactIds: input.artifactIds,
  }
}
