import type { ExecutionFailure } from './types'

/** Keep API failure metadata in the persisted task, step, and run. */
export function executionFailure(error: unknown): ExecutionFailure {
  const details = error as { code?: string; errorCode?: string; userMessage?: string; technicalSummary?: string; error?: string } | null
  return {
    errorCode: details?.code ?? details?.errorCode,
    userMessage: details?.userMessage,
    technicalSummary: details?.technicalSummary ?? details?.error ?? (error instanceof Error ? error.message : String(error)),
  }
}
