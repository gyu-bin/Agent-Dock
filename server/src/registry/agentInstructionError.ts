import type { AgentSource } from './agentSource.js'

export type AgentInstructionErrorCode =
  | 'AGENT_INSTRUCTION_FILE_NOT_FOUND'
  | 'AGENT_INSTRUCTION_READ_FAILED'
  | 'AGENT_INSTRUCTION_PARSE_FAILED'
  | 'AGENT_INSTRUCTION_MISSING_FIELD'
  | 'AGENT_SOURCE_UNAVAILABLE'
  | 'AGENT_BUNDLE_INVALID'

export class AgentInstructionError extends Error {
  readonly status = 503
  readonly userMessage = '담당 에이전트의 실행 지침을 불러오지 못했습니다.'
  readonly technicalSummary: string

  constructor(
    readonly code: AgentInstructionErrorCode,
    readonly agentId: string,
    readonly source: AgentSource,
    readonly resolvedPath: string,
    underlying?: unknown,
  ) {
    // TOML parser messages can contain source text. Log only safe error identity/code.
    const causeType = underlying instanceof Error ? underlying.name : undefined
    const causeCode = underlying && typeof underlying === 'object' && 'code' in underlying ? String(underlying.code) : source.failureCode
    const parserLocation = underlying && typeof underlying === 'object'
      ? Object.fromEntries(['line', 'col', 'pos'].flatMap((key) => {
        const value = (underlying as Record<string, unknown>)[key]
        return typeof value === 'number' ? [[key, value]] : []
      })) : undefined
    const summary = `${code}: agentId=${agentId} source=${source.type} path=${resolvedPath}`
    super(summary, { cause: underlying })
    this.name = 'AgentInstructionError'
    this.technicalSummary = summary
    console.warn('[agent-deck] agent instruction failure', { code, agentId, source: source.type, path: resolvedPath, causeType, causeCode, parserLocation })
  }
}
