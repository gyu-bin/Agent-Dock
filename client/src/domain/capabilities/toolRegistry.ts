import type { AgentCapability, ToolDefinition, ToolId } from './capabilityTypes'

export type ToolAvailability = ToolDefinition['availability']

/**
 * Actual execution backends. Never claim support for unimplemented tools.
 * Runtime may override availability (e.g. image-generation when OpenAI Image is configured).
 */
export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    availability: 'available',
    risk: 'read',
    capabilities: [
      'project.plan',
      'research.analyze',
      'research.synthesize',
      'design.analyze',
      'design.ui',
      'content.write',
      'marketing.plan',
      'marketing.content',
      'document.write',
    ],
  },
  {
    id: 'codex',
    label: 'Codex',
    availability: 'available',
    risk: 'write',
    capabilities: ['code.inspect', 'code.write', 'code.test', 'code.review'],
  },
  {
    id: 'web-search',
    label: 'Web Search',
    availability: 'available',
    risk: 'read',
    capabilities: ['research.web', 'marketing.research'],
  },
  {
    id: 'human',
    label: 'Human Approval',
    availability: 'available',
    risk: 'external',
    capabilities: [],
  },
  {
    id: 'image-generation',
    label: 'Image Generation',
    /** Default unavailable until server reports configured — never fake */
    availability: 'unavailable',
    risk: 'write',
    capabilities: ['image.generate', 'design.asset'],
  },
  {
    id: 'video-generation',
    label: 'Video Generation',
    availability: 'future',
    risk: 'write',
    capabilities: ['video.generate'],
  },
  {
    id: 'social-publisher',
    label: 'Social Publisher',
    /** Default unavailable until a SocialConnector is configured — never fake */
    availability: 'unavailable',
    risk: 'external',
    capabilities: ['social.publish'],
  },
  {
    id: 'analytics',
    label: 'Analytics',
    availability: 'unavailable',
    risk: 'read',
    capabilities: ['analytics.read'],
  },
]

const BY_ID = new Map(TOOL_DEFINITIONS.map((t) => [t.id, t]))

const runtimeAvailability = new Map<ToolId, ToolAvailability>()

/** Apply server-reported tool availability (e.g. after /api/tools/image/status). */
export function setToolAvailability(
  id: ToolId,
  availability: ToolAvailability,
): void {
  runtimeAvailability.set(id, availability)
}

export function clearToolAvailabilityOverrides(): void {
  runtimeAvailability.clear()
}

export function getToolDefinition(id: ToolId): ToolDefinition | undefined {
  const base = BY_ID.get(id)
  if (!base) return undefined
  const override = runtimeAvailability.get(id)
  if (!override) return base
  return { ...base, availability: override }
}

export function listAvailableTools(): ToolDefinition[] {
  return TOOL_DEFINITIONS.map((t) => getToolDefinition(t.id)!).filter(
    (t) => t.availability === 'available',
  )
}

/** Capability → tools that claim it (any availability). */
export function toolsForCapability(capability: AgentCapability): ToolDefinition[] {
  return TOOL_DEFINITIONS.map((t) => getToolDefinition(t.id)!).filter((t) =>
    t.capabilities.includes(capability),
  )
}
