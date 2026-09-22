export type {
  AgentCapability,
  AgentCapabilityProfile,
  AgentAssignment,
  CapabilityCoverage,
  CapabilityDefinition,
  CapabilityRisk,
  ToolDefinition,
  ToolId,
  ToolResolveResult,
} from './capabilityTypes'

export {
  CAPABILITY_DEFINITIONS,
  getCapabilityDefinition,
  listActiveCapabilities,
  listFutureCapabilities,
} from './capabilityRegistry'

export {
  TOOL_DEFINITIONS,
  getToolDefinition,
  listAvailableTools,
  toolsForCapability,
  setToolAvailability,
  clearToolAvailabilityOverrides,
} from './toolRegistry'

export {
  resolveToolForCapability,
  toolToExecutionBinding,
} from './toolResolver'

export {
  deriveAgentCapabilities,
  profileAllAgents,
  auditCapabilityProfiles,
} from './agentCapabilityResolver'

export {
  matchAgentForCapabilities,
  computeCapabilityCoverage,
  detectCapabilityConflicts,
} from './capabilityMatcher'

export {
  permissionForCapability,
  permissionForRisk,
  type CapabilityPermission,
} from './permissionPolicy'

export { capabilityNeedsForProjectType } from './projectCapabilityNeeds'

export { buildCapabilityDiagnosticsSummary, profileAgent } from './capabilityDiagnostics'
