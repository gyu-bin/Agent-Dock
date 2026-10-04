/**
 * Team talk — what agents say to each other while a task runs (kickoff, handoff, wrap-up).
 * Lines are built from the real plan and the real step output; no extra LLM call.
 */
import type { Agent, PipelineStep, Project } from './types'
import { displayAgentName } from '../i18n/agentNames'

const PM_PREFERENCE = [
  'senior-project-manager',
  'project-shepherd',
  'product-manager',
  'studio-producer',
  'agents-orchestrator',
]

/** The manager who distributes the work: a PM on the team, else the registry orchestrator/PM. */
export function pickManager(project: Project | undefined, registry: Agent[]): Agent | undefined {
  const usable = (a: Agent | undefined) => a && a.executable !== false && a.instructionAvailable !== false
  const team = new Set(project?.agentIds ?? [])
  for (const id of PM_PREFERENCE) {
    const a = registry.find((r) => r.id === id)
    if (team.has(id) && usable(a)) return a
  }
  for (const id of PM_PREFERENCE) {
    const a = registry.find((r) => r.id === id)
    if (usable(a)) return a
  }
  return undefined
}

export function displayName(agentId: string, registry: Agent[]): string {
  return displayAgentName(agentId, registry.find((a) => a.id === agentId)?.name ?? agentId)
}

/** PM kickoff: who does what, in which order. */
export function kickoffLine(input: { request: string; steps: PipelineStep[]; registry: Agent[] }): string {
  const work = input.steps.filter((s) => s.provider !== 'human')
  const lines = work.map((s, i) => `${i + 1}. ${s.label} — ${displayName(s.agentId, input.registry)}`)
  const gates = input.steps.filter((s) => s.provider === 'human').length
  return [
    `이번 요청은 ${work.length}단계로 나눠서 순서대로 진행할게요.`,
    ...lines,
    gates ? `중간에 확인이 필요한 단계가 ${gates}번 있어요.` : '',
    '단계가 끝날 때마다 다음 담당자에게 인수인계하겠습니다.',
  ]
    .filter(Boolean)
    .join('\n')
}

/** First substantive sentences of a step output, markdown stripped. */
export function gist(output: string, max = 160): string {
  const text = output
    .split('\n')
    .map((l) => l.replace(/^\s*(#{1,6}\s+|[-*•]\s+|\d+[.)]\s+|>\s*)/, '').replace(/\*\*|__|`/g, '').trim())
    .filter((l) => l.length > 15 && !/^(요약|summary|개요|결론)\s*:?$/i.test(l))
    .join(' ')
    .replace(/\[(cite_)?\d+\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('다. '), cut.lastIndexOf('요. '))
  return (end > max * 0.5 ? cut.slice(0, end + 1) : cut) + '…'
}

/** Outgoing agent → next agent. */
export function handoffLine(input: {
  from: PipelineStep
  to: PipelineStep
  output: string
  sourceCount?: number
  registry: Agent[]
}): string {
  const toName = displayName(input.to.agentId, input.registry)
  const summary = gist(input.output)
  const sources = input.sourceCount ? ` (출처 ${input.sourceCount}건 정리해 뒀어요)` : ''
  const v = variant(input.from.id)
  const opener = [
    `${toName}님, ${input.from.label} 끝났어요${sources}.`,
    `${toName}님, ${input.from.label} 마무리했어요${sources}.`,
    `${input.from.label} 정리 끝! ${toName}님께 넘길게요${sources}.`,
  ][v % 3]
  const ask = [
    `이어서 "${input.to.label}" 부탁드려요.`,
    `"${input.to.label}"은 ${toName}님이 맡아 주세요.`,
    `이걸 바탕으로 "${input.to.label}" 진행해 주시면 돼요.`,
  ][(v >> 2) % 3]
  return [opener, summary ? `핵심: ${summary}` : '', ask]
    .filter(Boolean)
    .join('\n')
}

/** Next agent acknowledges. */
export function ackLine(step: PipelineStep): string {
  return [
    `넵, 받았어요. ${step.label} 시작할게요.`,
    `확인했어요! ${step.label} 바로 들어갈게요.`,
    `좋아요, 넘겨주신 내용 보고 ${step.label} 할게요.`,
    `알겠습니다. ${step.label}, 제가 이어서 할게요.`,
  ][variant(step.id) % 4]!
}

/** Stable per-step variety (same step → same wording, different steps differ). */
function variant(key: string): number {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  return h
}

export function approvalLine(step: PipelineStep): string {
  return `여기서 확인이 필요해요: "${step.label}". 확인해 주시면 이어서 진행할게요.`
}

export function wrapUpLine(stepCount: number): string {
  return `${stepCount}단계 모두 끝났습니다. 최종 결과를 정리해서 전달드릴게요.`
}
