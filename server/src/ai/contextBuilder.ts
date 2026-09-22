import type {
  AgentHandoff,
  Artifact,
  ProjectContext,
} from '../persistence/artifactTypes.js'
import type { KnowledgeItem } from '../persistence/knowledgeTypes.js'
import {
  formatKnowledgeExcerpts,
  inferPreferredKnowledgeCategories,
  selectRelevantKnowledge,
} from './knowledgeContext.js'

export const CONTEXT_BUDGET = {
  projectContextChars: 1200,
  userRequestChars: 2000,
  handoffChars: 1000,
  artifactExcerptChars: 1800,
  maxArtifacts: 3,
  previousResultChars: 1200,
  knowledgeChars: 2400,
  maxKnowledge: 5,
} as const

export interface BuiltAgentContext {
  projectBlock: string
  knowledgeBlock: string
  userRequest: string
  stepTask: string
  handoffBlock: string
  artifactsBlock: string
  previousBlock: string
  webSearchBlock: string
  /** Approximate char count of the assembled user message body */
  estimatedChars: number
  includedArtifactIds: string[]
  omittedArtifactCount: number
  includedKnowledgeIds: string[]
  omittedKnowledgeCount: number
}

function clip(text: string, max: number): string {
  const t = text.trim()
  if (t.length <= max) return t
  return `${t.slice(0, max - 1)}…`
}

export function formatProjectContext(ctx?: ProjectContext | null): string {
  if (!ctx) return ''
  const parts: string[] = []
  if (ctx.description) parts.push(`Description: ${ctx.description}`)
  if (ctx.goals) parts.push(`Goals: ${ctx.goals}`)
  if (ctx.constraints) parts.push(`Constraints: ${ctx.constraints}`)
  if (ctx.techStack) parts.push(`Tech stack: ${ctx.techStack}`)
  return clip(parts.join('\n'), CONTEXT_BUDGET.projectContextChars)
}

export function formatHandoff(h?: AgentHandoff | null): string {
  if (!h) return ''
  const lines = [
    `From: ${h.fromAgentId} → To: ${h.toAgentId}`,
    `Summary: ${h.summary}`,
  ]
  if (h.decisions.length) lines.push(`Decisions:\n- ${h.decisions.join('\n- ')}`)
  if (h.openQuestions.length)
    lines.push(`Open questions:\n- ${h.openQuestions.join('\n- ')}`)
  if (h.risks.length) lines.push(`Risks:\n- ${h.risks.join('\n- ')}`)
  if (h.relevantArtifactIds?.length)
    lines.push(`Relevant artifacts: ${h.relevantArtifactIds.join(', ')}`)
  if (h.relevantSourceIds?.length)
    lines.push(`Relevant source ids: ${h.relevantSourceIds.join(', ')}`)
  return clip(lines.join('\n'), CONTEXT_BUDGET.handoffChars)
}

/**
 * Select relevant artifacts (task-first) and budget excerpts.
 * Never dumps the full project artifact library.
 */
export function selectRelevantArtifacts(input: {
  taskArtifacts: Artifact[]
  linkedIds?: string[]
  allProjectArtifacts?: Artifact[]
  max?: number
}): { selected: Artifact[]; omitted: number } {
  const max = input.max ?? CONTEXT_BUDGET.maxArtifacts
  const byId = new Map<string, Artifact>()
  for (const a of input.taskArtifacts) {
    if (a.status === 'final' || a.status === 'draft') byId.set(a.id, a)
  }
  for (const id of input.linkedIds ?? []) {
    const hit = (input.allProjectArtifacts ?? input.taskArtifacts).find(
      (a) => a.id === id,
    )
    if (hit && hit.status !== 'rejected') byId.set(hit.id, hit)
  }
  const selected = [...byId.values()]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, max)
  const totalCandidates = byId.size
  return {
    selected,
    omitted: Math.max(0, totalCandidates - selected.length),
  }
}

export function formatArtifactExcerpts(artifacts: Artifact[]): string {
  if (artifacts.length === 0) return '(none)'
  return artifacts
    .map((a) => {
      const body = clip(a.content, CONTEXT_BUDGET.artifactExcerptChars)
      return `### ${a.title} (${a.type}, v${a.version}, id=${a.id})\n${a.summary}\n\n${body}`
    })
    .join('\n\n')
}

/**
 * Build bounded context for one agent step.
 * Order: Project → Confirmed Knowledge → Request → Handoff → Artifacts.
 * Prefer handoff + artifacts over raw previousResult.
 */
export function buildAgentContext(input: {
  projectName?: string
  projectType?: string
  projectContext?: ProjectContext | null
  userRequest: string
  stepTask: string
  handoff?: AgentHandoff | null
  taskArtifacts?: Artifact[]
  linkedArtifactIds?: string[]
  allProjectArtifacts?: Artifact[]
  previousResult?: string
  webSearchBlock?: string
  /** Project-scoped knowledge only */
  knowledgeItems?: KnowledgeItem[]
  agentId?: string
}): BuiltAgentContext {
  const projectParts = [
    `Type: ${input.projectType ?? 'custom'}`,
    `Name: ${input.projectName ?? ''}`,
  ]
  const ctxText = formatProjectContext(input.projectContext)
  if (ctxText) projectParts.push(ctxText)
  const projectBlock = clip(
    projectParts.join('\n'),
    CONTEXT_BUDGET.projectContextChars + 80,
  )

  const preferred = inferPreferredKnowledgeCategories({
    userRequest: input.userRequest,
    stepTask: input.stepTask,
    agentId: input.agentId,
  })
  const knowledgePick = selectRelevantKnowledge({
    items: input.knowledgeItems ?? [],
    userRequest: input.userRequest,
    stepTask: input.stepTask,
    preferredCategories: preferred,
    max: CONTEXT_BUDGET.maxKnowledge,
  })
  const knowledgeBlock = formatKnowledgeExcerpts(knowledgePick.selected)

  const linkedFromHandoff = [
    ...(input.linkedArtifactIds ?? []),
    ...(input.handoff?.relevantArtifactIds ?? []),
    ...(input.handoff?.artifactIds ?? []),
  ]

  const { selected, omitted } = selectRelevantArtifacts({
    taskArtifacts: input.taskArtifacts ?? [],
    linkedIds: linkedFromHandoff,
    allProjectArtifacts: input.allProjectArtifacts,
  })

  const handoffBlock = formatHandoff(input.handoff)
  const artifactsBlock = formatArtifactExcerpts(selected)

  // If we have structured handoff or artifacts, shrink raw previous output
  const hasStructured = Boolean(handoffBlock) || selected.length > 0
  const previousBlock = hasStructured
    ? clip(input.previousResult ?? '', Math.min(400, CONTEXT_BUDGET.previousResultChars))
    : clip(input.previousResult ?? '', CONTEXT_BUDGET.previousResultChars)

  const userRequest = clip(input.userRequest, CONTEXT_BUDGET.userRequestChars)
  const webSearchBlock = clip(input.webSearchBlock ?? '', 8000)

  const estimatedChars =
    projectBlock.length +
    knowledgeBlock.length +
    userRequest.length +
    input.stepTask.length +
    handoffBlock.length +
    artifactsBlock.length +
    previousBlock.length +
    webSearchBlock.length

  return {
    projectBlock,
    knowledgeBlock,
    userRequest,
    stepTask: input.stepTask,
    handoffBlock: handoffBlock || '(none)',
    artifactsBlock,
    previousBlock: previousBlock || '(none — you are the first step)',
    webSearchBlock,
    estimatedChars,
    includedArtifactIds: selected.map((a) => a.id),
    omittedArtifactCount: omitted,
    includedKnowledgeIds: knowledgePick.selected.map((k) => k.id),
    omittedKnowledgeCount: knowledgePick.omitted,
  }
}

export function assembleUserPrompt(ctx: BuiltAgentContext): string {
  const searchSection = ctx.webSearchBlock
    ? `\n${ctx.webSearchBlock}\n`
    : '\n(No web search for this step — do not claim you searched the live web.)\n'

  return `PROJECT CONTEXT
${ctx.projectBlock}

CONFIRMED PROJECT KNOWLEDGE
${ctx.knowledgeBlock || '(none)'}

USER REQUEST
${ctx.userRequest}

CURRENT STEP
${ctx.stepTask}

HANDOFF
${ctx.handoffBlock}

RELEVANT ARTIFACTS
${ctx.artifactsBlock}

PREVIOUS RESULT (abbreviated)
${ctx.previousBlock}
${searchSection}
Produce the deliverable for this step.`
}
