import type {
  AgentCapability,
  AgentCapabilityProfile,
  ToolId,
  ToolResolveResult,
} from './capabilityTypes'
import { getCapabilityDefinition } from './capabilityRegistry'
import { getToolDefinition, toolsForCapability } from './toolRegistry'

/**
 * Pick an execution tool for a capability.
 * Never auto-falls back to Mock.
 */
export function resolveToolForCapability(input: {
  capability: AgentCapability
  agent?: AgentCapabilityProfile | null
  /** Prefer only these tool ids when set */
  availableTools?: ToolId[]
}): ToolResolveResult {
  const { capability } = input
  const def = getCapabilityDefinition(capability)
  const candidates = toolsForCapability(capability)

  if (candidates.length === 0) {
    return {
      capability,
      toolId: null,
      status: 'unsupported',
      message: `지원 도구가 등록되지 않은 capability: ${capability}`,
    }
  }

  const allow = input.availableTools
    ? new Set(input.availableTools)
    : null

  const preferred = input.agent?.preferredTools ?? []

  const order = [
    ...preferred,
    ...candidates.map((c) => c.id),
  ].filter((id, i, arr) => arr.indexOf(id) === i)

  for (const toolId of order) {
    if (allow && !allow.has(toolId)) continue
    const tool = getToolDefinition(toolId)
    if (!tool || !tool.capabilities.includes(capability)) continue

    if (tool.availability === 'available') {
      return { capability, toolId: tool.id, status: 'ok' }
    }
    if (tool.availability === 'future' || tool.availability === 'unavailable') {
      const label =
        def?.status === 'future'
          ? `${def.label} 도구가 아직 연결되지 않았습니다.`
          : `${tool.label} 도구를 사용할 수 없습니다.`
      return {
        capability,
        toolId: tool.id,
        status: 'unavailable',
        message: label,
      }
    }
  }

  // All matching tools filtered out or unavailable
  const first = candidates[0]
  if (first && first.availability !== 'available') {
    return {
      capability,
      toolId: first.id,
      status: 'unavailable',
      message: `${first.label} 도구가 연결되지 않았습니다.`,
    }
  }

  return {
    capability,
    toolId: null,
    status: 'unsupported',
    message: `사용 가능한 도구가 없습니다: ${capability}`,
  }
}

/** Map Tool → existing StepProvider / search flag. */
export function toolToExecutionBinding(toolId: ToolId | null): {
  provider?: 'openai' | 'codex' | 'human' | 'mock'
  requiresWebSearch?: boolean
} {
  if (!toolId) return {}
  if (toolId === 'openai') return { provider: 'openai' }
  if (toolId === 'codex') return { provider: 'codex' }
  if (toolId === 'human') return { provider: 'human' }
  if (toolId === 'web-search') {
    return { provider: 'openai', requiresWebSearch: true }
  }
  // Future tools: no silent OpenAI substitute
  return {}
}
