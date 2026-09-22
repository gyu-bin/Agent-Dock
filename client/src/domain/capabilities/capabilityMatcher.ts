import type { Agent } from '../types'
import { deriveAgentCapabilities } from './agentCapabilityResolver'
import type {
  AgentAssignment,
  AgentCapability,
  AgentCapabilityProfile,
  CapabilityCoverage,
  CapabilityMatchInput,
} from './capabilityTypes'
import { resolveToolForCapability } from './toolResolver'

function coverageOf(
  required: AgentCapability[],
  profile: AgentCapabilityProfile,
): { covered: AgentCapability[]; missing: AgentCapability[]; score: number } {
  const set = new Set(profile.capabilities)
  const covered = required.filter((c) => set.has(c))
  const missing = required.filter((c) => !set.has(c))
  const score =
    required.length === 0
      ? 0
      : Math.round((covered.length / required.length) * 100)
  return { covered, missing, score }
}

export function computeCapabilityCoverage(
  required: AgentCapability[],
  profiles: AgentCapabilityProfile[],
): CapabilityCoverage {
  const union = new Set<AgentCapability>()
  for (const p of profiles) {
    for (const c of p.capabilities) union.add(c)
  }
  const covered = required.filter((c) => union.has(c))
  const missing = required.filter((c) => !union.has(c))
  return { required, covered, missing }
}

/**
 * Team-first capability matcher + specialist discovery.
 * Capability coverage is the dominant score.
 */
export function matchAgentForCapabilities(
  input: CapabilityMatchInput & { roleScore?: (agent: Agent) => number },
): AgentAssignment | null {
  const required = input.requiredCapabilities
  const used = input.usedIds ?? new Set<string>()

  function scorePool(
    pool: CapabilityMatchInput['team'],
    source: AgentAssignment['source'],
  ): AgentAssignment | null {
    let best: AgentAssignment | null = null
    let bestScore = -1

    for (const raw of pool) {
      if (used.has(raw.id)) continue
      const agent = raw as Agent
      const profile = deriveAgentCapabilities(agent)
      const { covered, missing, score: cov } = coverageOf(required, profile)
      if (required.length > 0 && covered.length === 0) continue

      let score = cov * 10
      // Preferred tool availability for covered caps
      for (const cap of covered) {
        const tool = resolveToolForCapability({
          capability: cap,
          agent: profile,
        })
        if (tool.status === 'ok') score += 5
        else if (tool.status === 'unavailable') score -= 20
      }
      if (input.roleScore) score += input.roleScore(agent)

      if (score > bestScore) {
        bestScore = score
        best = {
          agentId: agent.id,
          source,
          reason:
            source === 'core-team'
              ? `team coverage ${covered.length}/${required.length}`
              : `specialist coverage ${covered.length}/${required.length}`,
          matchedCapabilities: covered,
        }
        // attach missing for debug via reason
        if (missing.length) {
          best.reason += ` (missing: ${missing.join(',')})`
        }
      }
    }
    return best
  }

  const teamHit = scorePool(input.team, 'core-team')
  if (teamHit && required.length > 0) {
    const profile = deriveAgentCapabilities(
      input.team.find((a) => a.id === teamHit.agentId) as Agent,
    )
    const { score } = coverageOf(required, profile)
    if (score >= 50) return teamHit
  }
  if (teamHit && required.length === 0) return teamHit

  const specialist = scorePool(input.registry, 'specialist')
  return specialist ?? teamHit
}

/** Detect conflicts for required capabilities vs tools. */
export function detectCapabilityConflicts(input: {
  required: AgentCapability[]
  agent?: AgentCapabilityProfile | null
}): Array<{ capability: AgentCapability; code: string; message: string }> {
  const out: Array<{
    capability: AgentCapability
    code: string
    message: string
  }> = []

  for (const cap of input.required) {
    if (input.agent && !input.agent.capabilities.includes(cap)) {
      out.push({
        capability: cap,
        code: 'agent_capability_missing',
        message: `Agent ${input.agent.agentId} lacks capability ${cap}`,
      })
    }
    const tool = resolveToolForCapability({
      capability: cap,
      agent: input.agent,
    })
    if (tool.status === 'unsupported') {
      out.push({
        capability: cap,
        code: 'tool_unsupported',
        message: tool.message ?? `No tool for ${cap}`,
      })
    } else if (tool.status === 'unavailable') {
      out.push({
        capability: cap,
        code: 'tool_unavailable',
        message: tool.message ?? `Tool unavailable for ${cap}`,
      })
    }
  }
  return out
}
