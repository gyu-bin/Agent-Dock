/**
 * Server-side mirror of client model profile routing (no shared package).
 */
export type ModelProfileId = 'FAST' | 'STANDARD' | 'REASONING'

export function selectModelProfileId(input: {
  purpose?: string
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
    /orchestrat|reality|game-designer|planning|plan|advisory/.test(blob)
  ) {
    return 'REASONING'
  }

  return 'STANDARD'
}

export function resolveModelFromSettings(
  settingsProfiles:
    | Partial<Record<ModelProfileId, { model?: string }>>
    | null
    | undefined,
  input: {
    agentId?: string
    role?: string
    stepLabel?: string
    mode?: string
    purpose?: string
  },
): { profileId: ModelProfileId; model: string } {
  const profileId = selectModelProfileId(input)
  const defaults: Record<ModelProfileId, string> = {
    FAST: 'gpt-4o-mini',
    STANDARD: 'gpt-4o-mini',
    REASONING: 'gpt-4o',
  }
  const model =
    settingsProfiles?.[profileId]?.model?.trim() || defaults[profileId]
  return { profileId, model }
}
