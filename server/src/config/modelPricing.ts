/**
 * Separated provider/model pricing config.
 * Update here only — never hardcode prices across call sites.
 * Amounts are USD per 1M tokens.
 */

export interface ModelTokenPrice {
  provider: 'openai' | 'mock'
  model: string
  inputPer1M: number
  outputPer1M: number
}

/**
 * Known prices only. Missing model → Unknown (do not guess).
 * Codex / web-search have no token pricing entries by default.
 */
export const MODEL_TOKEN_PRICES: readonly ModelTokenPrice[] = [
  {
    provider: 'openai',
    model: 'gpt-4o',
    inputPer1M: 2.5,
    outputPer1M: 10,
  },
  {
    provider: 'openai',
    model: 'gpt-4o-mini',
    inputPer1M: 0.15,
    outputPer1M: 0.6,
  },
  {
    provider: 'openai',
    model: 'gpt-4.1',
    inputPer1M: 2,
    outputPer1M: 8,
  },
  {
    provider: 'openai',
    model: 'gpt-4.1-mini',
    inputPer1M: 0.4,
    outputPer1M: 1.6,
  },
  {
    provider: 'mock',
    model: 'mock',
    inputPer1M: 0,
    outputPer1M: 0,
  },
]

export function lookupModelPrice(
  provider: string,
  model: string | undefined,
): ModelTokenPrice | undefined {
  if (!model) return undefined
  const normalized = model.trim().toLowerCase()
  return MODEL_TOKEN_PRICES.find(
    (p) =>
      p.provider === provider &&
      p.model.toLowerCase() === normalized,
  )
}
