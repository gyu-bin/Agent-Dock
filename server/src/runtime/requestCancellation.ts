import type { Response } from 'express'
import type { AiProvider } from '../providers/aiProvider.js'
import type { WebSearchProvider } from '../search/types.js'

/** Abort upstream work if the requesting browser stops waiting for the response. */
export function requestCancellation(res: Response) {
  const controller = new AbortController()
  const onClose = () => {
    if (!res.writableEnded) controller.abort()
  }
  res.once('close', onClose)
  return {
    signal: controller.signal,
    dispose: () => res.off('close', onClose),
  }
}

export function cancellableAi(provider: AiProvider, signal: AbortSignal): AiProvider {
  return {
    getState: () => provider.getState(),
    isConfigured: () => provider.isConfigured(),
    chat: input => {
      signal.throwIfAborted()
      return provider.chat({ ...input, signal })
    },
  }
}

export function cancellableSearch(provider: WebSearchProvider, signal: AbortSignal): WebSearchProvider {
  return {
    id: provider.id,
    label: provider.label,
    isAvailable: () => provider.isAvailable(),
    search: input => {
      signal.throwIfAborted()
      return provider.search({ ...input, signal })
    },
  }
}
