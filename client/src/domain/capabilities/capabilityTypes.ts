/**
 * Agent Deck Capability Foundation — domain types.
 * Independent of WorkflowTemplate / Office / Providers.
 */

export type CapabilityRisk = 'read' | 'write' | 'external'

export type AgentCapability =
  | 'project.plan'
  | 'research.web'
  | 'research.analyze'
  | 'research.synthesize'
  | 'code.inspect'
  | 'code.write'
  | 'code.test'
  | 'code.review'
  | 'design.analyze'
  | 'design.ui'
  | 'design.asset'
  | 'image.generate'
  | 'video.generate'
  | 'qa.test'
  | 'qa.verify'
  | 'content.write'
  | 'marketing.research'
  | 'marketing.plan'
  | 'marketing.content'
  | 'analytics.read'
  | 'social.publish'
  | 'document.write'

export type CapabilityCategory =
  | 'project'
  | 'research'
  | 'code'
  | 'design'
  | 'qa'
  | 'content'
  | 'marketing'
  | 'analytics'
  | 'social'
  | 'document'
  | 'creative'

export interface CapabilityDefinition {
  id: AgentCapability
  category: CapabilityCategory
  risk: CapabilityRisk
  requiresApproval: boolean
  /** future = registered but no real Tool yet */
  status: 'active' | 'future'
  label: string
}

export type ToolId =
  | 'openai'
  | 'codex'
  | 'web-search'
  | 'human'
  | 'image-generation'
  | 'video-generation'
  | 'social-publisher'
  | 'analytics'

export type ToolAvailability = 'available' | 'unavailable' | 'future'

export interface ToolDefinition {
  id: ToolId
  label: string
  capabilities: AgentCapability[]
  availability: ToolAvailability
  risk: CapabilityRisk
}

export type CapabilitySource =
  | 'agent-id'
  | 'division'
  | 'name-hint'
  | 'description-hint'
  | 'fallback-safe'

export interface AgentCapabilityProfile {
  agentId: string
  capabilities: AgentCapability[]
  preferredTools: ToolId[]
  source: CapabilitySource
  /** Why these caps were chosen (deterministic rule tag) */
  reason: string
}

export type AssignmentSource = 'core-team' | 'specialist'

export interface AgentAssignment {
  agentId: string
  source: AssignmentSource
  reason: string
  matchedCapabilities: AgentCapability[]
}

export interface ToolResolveResult {
  capability: AgentCapability
  toolId: ToolId | null
  status: 'ok' | 'unsupported' | 'unavailable'
  message?: string
}

export interface CapabilityCoverage {
  required: AgentCapability[]
  covered: AgentCapability[]
  missing: AgentCapability[]
}

export interface CapabilityMatchInput {
  requiredCapabilities: AgentCapability[]
  role?: string
  team: Array<{ id: string; name: string; division: string; description?: string }>
  registry: Array<{ id: string; name: string; division: string; description?: string }>
  usedIds?: Set<string>
}
