import type { Agent, DivisionId, ProjectType } from './types'
import { TEAM_PRESETS, type TeamPreset, type TeamPresetRole, getPresetForProjectType } from './teamPresets'

export interface PresetMatch {
  role: TeamPresetRole
  agent: Agent | null
}

/** Score how well an agent fits a preset role. Higher is better. */
function scoreAgent(agent: Agent, role: TeamPresetRole): number {
  let score = 0
  const id = agent.id.toLowerCase()
  const name = agent.name.toLowerCase()
  const hay = `${id} ${name}`

  if (role.preferredDivisions.includes(agent.division)) score += 40

  for (const hint of role.preferredNameHints) {
    const h = hint.toLowerCase()
    if (id === h || id === h.replace(/\s+/g, '-')) score += 100
    else if (id.includes(h.replace(/\s+/g, '-'))) score += 50
    else if (name.includes(h)) score += 35
    else if (hay.includes(h)) score += 15
  }

  return score
}

export function matchPresetToRegistry(
  registry: Agent[],
  preset: TeamPreset,
): PresetMatch[] {
  const used = new Set<string>()
  const matches: PresetMatch[] = []

  for (const role of preset.roles) {
    let best: Agent | null = null
    let bestScore = 0
    for (const agent of registry) {
      if (used.has(agent.id)) continue
      const s = scoreAgent(agent, role)
      if (s > bestScore) {
        bestScore = s
        best = agent
      }
    }
    // Require a minimum signal so we don't randomly assign unrelated agents
    if (best && bestScore >= 40) {
      used.add(best.id)
      matches.push({ role, agent: best })
    } else {
      matches.push({ role, agent: null })
    }
  }

  return matches
}

export function recommendTeamIds(
  registry: Agent[],
  projectType: ProjectType,
): string[] {
  const preset = getPresetForProjectType(projectType)
  if (!preset) return []
  return matchPresetToRegistry(registry, preset)
    .map((m) => m.agent?.id)
    .filter((id): id is string => Boolean(id))
}

export function getPresetMatches(
  registry: Agent[],
  projectType: ProjectType,
): PresetMatch[] {
  const preset = getPresetForProjectType(projectType)
  if (!preset) return []
  return matchPresetToRegistry(registry, preset)
}

export { TEAM_PRESETS, getPresetForProjectType }
export type { TeamPreset, TeamPresetRole, DivisionId }
