import type { CapabilityRisk } from './capabilityTypes'
import { getCapabilityDefinition } from './capabilityRegistry'
import type { AgentCapability } from './capabilityTypes'

/**
 * Permission policy hooks — structure only.
 * Existing Safety Pipeline still owns code.write Diff/Approval.
 */
export type CapabilityPermission =
  | 'auto-allow'
  | 'safety-pipeline'
  | 'human-approval-required'

export function permissionForRisk(risk: CapabilityRisk): CapabilityPermission {
  if (risk === 'read') return 'auto-allow'
  if (risk === 'write') return 'safety-pipeline'
  return 'human-approval-required'
}

export function permissionForCapability(
  capability: AgentCapability,
): CapabilityPermission {
  const def = getCapabilityDefinition(capability)
  if (!def) return 'human-approval-required'
  // External always needs human approval; write uses existing Safety Pipeline.
  if (def.risk === 'external' || def.requiresApproval) {
    return 'human-approval-required'
  }
  return permissionForRisk(def.risk)
}
