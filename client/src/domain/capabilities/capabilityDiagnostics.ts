/**
 * Client-side capability diagnostics for Settings > Advanced.
 * No server call — pure derived metadata.
 */
import divisionMap from '../../data/agencyDivisionMap.json'
import type { Agent, DivisionId } from '../types'
import {
  auditCapabilityProfiles,
  deriveAgentCapabilities,
  listAvailableTools,
  listFutureCapabilities,
  profileAllAgents,
  TOOL_DEFINITIONS,
} from './index'

function agentsFromDivisionMap(): Agent[] {
  const slug = (
    divisionMap as { slugToDivision: Record<string, string> }
  ).slugToDivision
  return Object.entries(slug)
    .map(([id, division]) => ({
      id,
      name: id,
      division: division as DivisionId,
      description: '',
      status: 'idle' as const,
      enabled: true,
    }))
    .sort((a, b) => a.id.localeCompare(b.id))
}

export function buildCapabilityDiagnosticsSummary(_registry?: Agent[]) {
  // Prefer full 279 from division map for audit (registry may be mock subset)
  const full = agentsFromDivisionMap()
  const profiles = profileAllAgents(full)
  const audit = auditCapabilityProfiles(profiles)
  const available = listAvailableTools().map((t) => t.id)
  const futureCaps = listFutureCapabilities()
  const futureTools = TOOL_DEFINITIONS.filter(
    (t) => t.availability === 'future',
  ).map((t) => t.id)

  return {
    agentCount: audit.total,
    withCapabilities: audit.withCapabilities,
    withoutCapabilities: audit.withoutCapabilities,
    capabilityDistribution: audit.capabilityDistribution,
    preferredToolDistribution: audit.preferredToolDistribution,
    sourceDistribution: audit.sourceDistribution,
    availableTools: available,
    futureTools,
    futureCapabilities: futureCaps,
    sampleProfiles: profiles.slice(0, 8).map((p) => ({
      agentId: p.agentId,
      capabilities: p.capabilities,
      preferredTools: p.preferredTools,
      source: p.source,
    })),
    /** Astra-ready export shape */
    astraCatalog: {
      agents: profiles.map((p) => ({
        id: p.agentId,
        capabilities: p.capabilities,
        preferredTools: p.preferredTools,
      })),
      tools: TOOL_DEFINITIONS.map((t) => ({
        id: t.id,
        capabilities: t.capabilities,
        availability: t.availability,
      })),
    },
  }
}

export function profileAgent(agent: Agent) {
  return deriveAgentCapabilities(agent)
}
