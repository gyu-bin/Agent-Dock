/**
 * Model Profile routing — Settings FAST / STANDARD / REASONING → runtime model.
 * Does not call providers; resolves which profile/model a step should use.
 */
import type { ModelProfile, ModelProfileId, PipelineStep } from './types'

export const DEFAULT_MODEL_PROFILES: Record<ModelProfileId, ModelProfile> = {
  FAST: {
    id: 'FAST',
    label: 'FAST',
    description: 'Router · Classification · 간단 요약',
    model: 'gpt-4o-mini',
    roles: ['router', 'classification', 'summary'],
  },
  STANDARD: {
    id: 'STANDARD',
    label: 'STANDARD',
    description: '일반 Agent · Research · Product · Marketing',
    model: 'gpt-4o-mini',
    roles: ['agent', 'research', 'product', 'marketing'],
  },
  REASONING: {
    id: 'REASONING',
    label: 'REASONING',
    description: 'Orchestrator · Game Designer · Reality Checker · 중요 Planning',
    model: 'gpt-4o',
    roles: ['orchestrator', 'game-designer', 'reality-checker', 'planning'],
  },
}

export type ModelProfilePurpose =
  | 'intent'
  | 'template'
  | 'summary'
  | 'agent'
  | 'research'
  | 'product'
  | 'marketing'
  | 'orchestrator'
  | 'planning'
  | 'reality'
  | 'game-designer'

/** Pick profile from purpose / agent / step — never hardcode a model id per agent. */
export function selectModelProfileId(input: {
  purpose?: ModelProfilePurpose
  agentId?: string
  role?: string
  stepLabel?: string
  mode?: string
}): ModelProfileId {
  const blob = [
    input.purpose ?? '',
    input.agentId ?? '',
    input.role ?? '',
    input.stepLabel ?? '',
    input.mode ?? '',
  ]
    .join(' ')
    .toLowerCase()

  if (
    input.purpose === 'intent' ||
    input.purpose === 'template' ||
    input.purpose === 'summary' ||
    /router|classif|summar|intent|template/.test(blob)
  ) {
    return 'FAST'
  }

  if (
    input.purpose === 'orchestrator' ||
    input.purpose === 'planning' ||
    input.purpose === 'reality' ||
    input.purpose === 'game-designer' ||
    /orchestrat|reality|game-designer|중요|planning|plan|advisory/.test(blob)
  ) {
    return 'REASONING'
  }

  if (
    input.purpose === 'research' ||
    input.purpose === 'product' ||
    input.purpose === 'marketing' ||
    /research|product|market|trend|content/.test(blob)
  ) {
    return 'STANDARD'
  }

  return 'STANDARD'
}

export function resolveModelForStep(
  profiles: Partial<Record<ModelProfileId, Pick<ModelProfile, 'model'>>> | null | undefined,
  step: Pick<PipelineStep, 'agentId' | 'role' | 'label' | 'mode'>,
): { profileId: ModelProfileId; model: string } {
  const profileId = selectModelProfileId({
    agentId: step.agentId,
    role: step.role,
    stepLabel: step.label,
    mode: step.mode,
  })
  const fromSettings = profiles?.[profileId]?.model?.trim()
  const fallback = DEFAULT_MODEL_PROFILES[profileId].model
  return { profileId, model: fromSettings || fallback }
}
