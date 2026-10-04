import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * Live progress of one running pipeline step (in memory, per server process).
 * Reported from deep inside the run (search pipeline, model stream) via AsyncLocalStorage,
 * so no callback has to be threaded through every function signature.
 */
export type StepPhase = 'preparing' | 'planning-search' | 'searching' | 'writing' | 'done' | 'failed'

export interface StepProgress {
  stepId: string
  phase: StepPhase
  searchDone?: number
  searchTotal?: number
  /** Last search query started/finished (shown to the user) */
  query?: string
  /** Characters of the answer streamed so far (ChatGPT Plan streams; other providers report none) */
  chars?: number
  startedAt: string
  updatedAt: string
}

const progress = new Map<string, StepProgress>()
const scope = new AsyncLocalStorage<string>()
const KEEP_MS = 10 * 60_000

function prune(now = Date.now()) {
  for (const [id, p] of progress) if (now - Date.parse(p.updatedAt) > KEEP_MS) progress.delete(id)
}

export function reportProgress(patch: Partial<Omit<StepProgress, 'stepId' | 'startedAt' | 'updatedAt'>>): void {
  const id = scope.getStore()
  if (!id) return
  const cur = progress.get(id)
  if (!cur) return
  progress.set(id, { ...cur, ...patch, updatedAt: new Date().toISOString() })
}

/** Count one finished search query (success or skipped). */
export function reportSearchStep(query: string): void {
  const id = scope.getStore()
  const cur = id ? progress.get(id) : undefined
  if (!cur) return
  reportProgress({ searchDone: (cur.searchDone ?? 0) + 1, query })
}

export async function withStepProgress<T>(stepId: string | undefined, fn: () => Promise<T>): Promise<T> {
  if (!stepId) return fn()
  prune()
  const now = new Date().toISOString()
  progress.set(stepId, { stepId, phase: 'preparing', startedAt: now, updatedAt: now })
  return scope.run(stepId, async () => {
    try {
      const result = await fn()
      reportProgress({ phase: 'done' })
      return result
    } catch (err) {
      reportProgress({ phase: 'failed' })
      throw err
    }
  })
}

export function getStepProgress(stepId: string): StepProgress | null {
  prune()
  return progress.get(stepId) ?? null
}
