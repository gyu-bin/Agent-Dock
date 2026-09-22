import { lookupModelPrice } from '../config/modelPricing.js'
import type { ExecutionProvider } from './usageTypes.js'

export type CostEstimate =
  | { kind: 'known'; usd: number }
  | { kind: 'unknown' }
  | { kind: 'na' }

/**
 * Estimate USD cost from tokens + pricing table.
 * Never invents prices for unknown models.
 */
export function estimateExecutionCost(input: {
  provider: ExecutionProvider
  model?: string
  inputTokens?: number
  outputTokens?: number
}): CostEstimate {
  const hasTokens =
    (input.inputTokens != null && input.inputTokens > 0) ||
    (input.outputTokens != null && input.outputTokens > 0)

  if (!hasTokens) {
    // Codex / web-search / empty usage — no token cost to report
    if (
      input.provider === 'codex' ||
      input.provider === 'web-search' ||
      input.provider === 'openai-image' ||
      input.provider === 'threads' ||
      input.provider === 'media-delivery'
    ) {
      if (input.provider === 'openai-image') {
        return input.model ? { kind: 'unknown' } : { kind: 'na' }
      }
      if (
        input.provider === 'threads' ||
        input.provider === 'media-delivery'
      ) {
        return { kind: 'unknown' }
      }
      return { kind: 'na' }
    }
    if (input.provider === 'human') return { kind: 'na' }
    // OpenAI/mock with zero tokens still N/A
    if (!input.model) return { kind: 'na' }
  }

  const priceProvider =
    input.provider === 'openai' || input.provider === 'mock'
      ? input.provider
      : null

  if (!priceProvider) {
    return hasTokens || input.provider === 'openai-image'
      ? { kind: 'unknown' }
      : { kind: 'na' }
  }

  const row = lookupModelPrice(priceProvider, input.model)
  if (!row) {
    return hasTokens || Boolean(input.model) ? { kind: 'unknown' } : { kind: 'na' }
  }

  const inTok = input.inputTokens ?? 0
  const outTok = input.outputTokens ?? 0
  const usd =
    (inTok / 1_000_000) * row.inputPer1M +
    (outTok / 1_000_000) * row.outputPer1M
  return { kind: 'known', usd: roundUsd(usd) }
}

function roundUsd(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000
}

export function applyCostToRecord(fields: {
  provider: ExecutionProvider
  model?: string
  inputTokens?: number
  outputTokens?: number
}): { estimatedCost?: number; costUnknown?: boolean } {
  const est = estimateExecutionCost(fields)
  if (est.kind === 'known') return { estimatedCost: est.usd, costUnknown: false }
  if (est.kind === 'unknown') return { costUnknown: true }
  return {}
}
