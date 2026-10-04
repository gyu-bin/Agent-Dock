import { useEffect, useState } from 'react'
import { getStepProgress, type StepProgress } from '../api/client'
import type { PipelineStep } from './types'

/** How far the running step is, 0..1, from what the server reports it is doing. */
export function stepFraction(p: StepProgress | null): number {
  if (!p) return 0
  switch (p.phase) {
    case 'preparing': return 0.05
    case 'planning-search': return 0.1
    case 'searching': return 0.1 + 0.4 * ((p.searchDone ?? 0) / Math.max(1, p.searchTotal ?? 1))
    // Typical report length ~6k chars; capped so the bar never claims "done" before it is.
    case 'writing': return p.chars ? 0.5 + 0.45 * Math.min(1, p.chars / 6000) : 0.5
    case 'done': return 1
    default: return 0
  }
}

/** One line on what the agent is doing right now. */
export function activityLine(p: StepProgress | null): string | null {
  if (!p) return null
  const q = p.query ? ` · “${p.query.length > 40 ? `${p.query.slice(0, 39)}…` : p.query}”` : ''
  switch (p.phase) {
    case 'preparing': return '자료와 지난 단계 내용을 정리하는 중'
    case 'planning-search': return '검색어를 정하는 중'
    case 'searching': return `웹 검색 ${p.searchDone ?? 0}/${p.searchTotal ?? '?'}${q}`
    case 'writing': return p.chars ? `작성 중 · ${p.chars.toLocaleString()}자` : '작성 중'
    case 'done': return '마무리하는 중'
    case 'failed': return '이 단계에서 문제가 생겼어요'
  }
}

/** Overall task percent including the live fraction of the running step. */
export function liveTaskPercent(steps: PipelineStep[], running: PipelineStep | undefined, p: StepProgress | null, taskStatus?: string): number {
  if (taskStatus === 'completed') return 100
  if (!steps.length) return 0
  const done = steps.filter((s) => s.status === 'completed').length
  const extra = running && running.status === 'running' ? stepFraction(p) : 0
  // 100% only once the task itself is completed: after the last step the final
  // synthesis still runs for a minute or two.
  return Math.min(97, Math.round(((done + extra) / steps.length) * 100))
}

/** True while every step is done but the task is still assembling the final result. */
export function isFinalizing(steps: PipelineStep[], taskStatus: string): boolean {
  return steps.length > 0 && steps.every((s) => s.status === 'completed') && ['running', 'verifying'].includes(taskStatus)
}

/** Polls the server while a step runs. */
export function useStepProgress(stepId: string | undefined, active: boolean): StepProgress | null {
  const [p, setP] = useState<StepProgress | null>(null)
  useEffect(() => {
    if (!stepId || !active) return
    let alive = true
    const tick = () => void getStepProgress(stepId).then((next) => { if (alive) setP(next) }).catch(() => undefined)
    tick()
    const id = window.setInterval(tick, 1500)
    return () => { alive = false; window.clearInterval(id) }
  }, [stepId, active])
  return stepId && active ? p : null
}

/** Tokens used so far by a task's agent runs (input + output). */
export function taskTokens(runs: Array<{ taskId: string; inputTokens?: number; outputTokens?: number }>, taskId: string): number {
  return runs.filter((r) => r.taskId === taskId).reduce((n, r) => n + (r.inputTokens ?? 0) + (r.outputTokens ?? 0), 0)
}
