import {
  createArtifact,
  createArtifactVersion,
  deriveAndCreateHandoff,
} from '../api/client'
import type {
  Artifact,
  ArtifactType,
  CodexRun,
  PipelineStep,
  Task,
} from './types'

function inferType(input: {
  agentId: string
  stepLabel?: string
  mode?: string
}): ArtifactType {
  const id = input.agentId.toLowerCase()
  const label = (input.stepLabel ?? '').toLowerCase()
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
  if (/report|final|요약/.test(label)) return 'report'
  return 'document'
}

export function shouldPersistArtifact(input: {
  output: string
  mode?: string
  provider?: string
  agentId: string
}): boolean {
  const text = input.output.trim()
  if (text.length < 120) return false
  if (input.mode === 'inspect') return false
  if (input.provider === 'human') return false
  if (input.mode === 'verify' || input.mode === 'review' || input.mode === 'implement')
    return true
  if (/orchestrator|agents-orchestrator/.test(input.agentId)) return false
  return true
}

export async function persistOpenAiArtifact(input: {
  projectId: string
  task: Task
  step: PipelineStep
  output: string
  sources?: import('./types').WebSource[]
  searchedAt?: string
}): Promise<Artifact | null> {
  if (
    !shouldPersistArtifact({
      output: input.output,
      agentId: input.step.agentId,
      provider: input.step.provider,
      mode: input.step.mode,
    })
  ) {
    return null
  }
  const type = inferType({
    agentId: input.step.agentId,
    stepLabel: input.step.label,
    mode: input.step.mode,
  })
  return createArtifact(input.projectId, {
    type,
    title: input.step.label || type,
    summary: input.output.replace(/\s+/g, ' ').slice(0, 280),
    content: input.output,
    contentType: 'markdown',
    taskId: input.task.id,
    stepId: input.step.id,
    agentId: input.step.agentId,
    status: 'final',
    sources: input.sources,
    searchedAt: input.searchedAt,
  })
}

export async function persistCodexArtifact(input: {
  projectId: string
  task: Task
  step: PipelineStep
  run: CodexRun
  /** Only create final code-change after human approval */
  approved?: boolean
}): Promise<Artifact | null> {
  const mode = input.step.mode ?? input.run.mode
  if (mode === 'implement') {
    if (!input.approved) return null
    if (!(input.run.changedFiles?.length)) return null
    const diff =
      input.run.unifiedDiff?.slice(0, 24000) ||
      Object.entries(input.run.diffByFile ?? {})
        .map(([f, d]) => `## ${f}\n${d}`)
        .join('\n\n')
        .slice(0, 24000)
    return createArtifact(input.projectId, {
      type: 'code-change',
      title: `코드 변경 — ${input.step.label}`,
      summary: input.run.summary?.slice(0, 280) ?? `${input.run.changedFiles.length} files changed`,
      content: [
        `# Code Change`,
        ``,
        input.run.summary ?? '',
        ``,
        `## Changed files`,
        ...(input.run.changedFiles ?? []).map((f) => `- ${f}`),
        ``,
        `## Diff`,
        '```diff',
        diff || '(no diff)',
        '```',
        ``,
        `Iteration: ${input.run.iteration ?? 1}`,
        `Run: ${input.run.id}`,
      ].join('\n'),
      contentType: 'diff',
      taskId: input.task.id,
      stepId: input.step.id,
      agentId: input.step.agentId,
      status: 'final',
      metadata: {
        runId: input.run.id,
        snapshotId: input.run.snapshotId,
        changedFiles: input.run.changedFiles,
        iteration: input.run.iteration,
      },
    })
  }

  if (mode === 'verify') {
    const cmds = input.run.commands ?? []
    const body = [
      `# Verification`,
      input.run.summary ?? '',
      ``,
      ...cmds.map(
        (c) =>
          `- **${c.name}**: ${c.status}${c.exitCode != null ? ` (exit ${c.exitCode})` : ''}`,
      ),
    ].join('\n')
    if (body.length < 80) return null
    return createArtifact(input.projectId, {
      type: 'verification',
      title: '검증 결과',
      summary: cmds.map((c) => `${c.name}:${c.status}`).join(', ').slice(0, 280),
      content: body,
      contentType: 'markdown',
      taskId: input.task.id,
      stepId: input.step.id,
      agentId: input.step.agentId,
      status: 'final',
      metadata: { runId: input.run.id, commands: cmds },
    })
  }

  if (mode === 'review') {
    const text = input.run.summary ?? ''
    if (text.length < 80) return null
    return createArtifact(input.projectId, {
      type: 'review',
      title: '코드 리뷰',
      summary: text.slice(0, 280),
      content: text,
      contentType: 'markdown',
      taskId: input.task.id,
      stepId: input.step.id,
      agentId: input.step.agentId,
      status: 'final',
      metadata: { runId: input.run.id },
    })
  }

  return null
}

export async function persistFinalReport(input: {
  projectId: string
  task: Task
  content: string
  agentId?: string
}): Promise<Artifact | null> {
  if (input.content.trim().length < 80) return null
  return createArtifact(input.projectId, {
    type: 'report',
    title: `최종 보고서 — ${input.task.title}`,
    summary: input.content.replace(/\s+/g, ' ').slice(0, 280),
    content: input.content,
    contentType: 'markdown',
    taskId: input.task.id,
    agentId: input.agentId ?? 'reality-checker',
    status: 'final',
  })
}

export async function maybeCreateHandoff(input: {
  projectId: string
  task: Task
  fromStep: PipelineStep
  toStep: PipelineStep
  output: string
  artifactIds: string[]
  relevantArtifactIds?: string[]
  relevantSourceIds?: string[]
}): Promise<void> {
  if (!input.output.trim()) return
  await deriveAndCreateHandoff(input.projectId, {
    taskId: input.task.id,
    fromAgentId: input.fromStep.agentId,
    toAgentId: input.toStep.agentId,
    fromStepId: input.fromStep.id,
    toStepId: input.toStep.id,
    output: input.output,
    artifactIds: input.artifactIds,
    relevantArtifactIds: input.relevantArtifactIds,
    relevantSourceIds: input.relevantSourceIds,
  })
}

export async function bumpArtifactVersion(input: {
  projectId: string
  familyId: string
  content: string
  summary?: string
  agentId?: string
  taskId?: string
}): Promise<Artifact> {
  return createArtifactVersion(input.projectId, input.familyId, {
    content: input.content,
    summary: input.summary,
    agentId: input.agentId,
    taskId: input.taskId,
    status: 'final',
  })
}
