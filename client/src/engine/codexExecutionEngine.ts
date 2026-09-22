import type { CodexMode, CodexRun, PipelineStep, Task } from '../domain/types'
import { inferCodexMode } from '../domain/providerRouting'
import { cancelCodexRun, preflightCodex, runCodexStep } from '../api/client'
import type { EngineStoreAccess } from './types'

/**
 * CodexExecutionEngine — repository-scoped Codex steps only.
 * Never falls back to OpenAI/Mock on failure.
 */
export class CodexExecutionEngine {
  private store: EngineStoreAccess
  private activeRunByTask = new Map<string, string>()

  constructor(store: EngineStoreAccess) {
    this.store = store
  }

  async executeStep(
    task: Task,
    step: PipelineStep,
  ): Promise<{ ok: boolean; output: string; run: CodexRun }> {
    const project =
      this.store.getProjects?.()?.find(
        (p) => p.id === (this.store.getActiveProjectId?.() ?? task.projectId),
      ) ?? null

    const mode: CodexMode =
      step.mode ??
      inferCodexMode({
        agentId: step.agentId,
        stepTask: step.label,
        workflow: task.workflow,
        userRequest: task.description || task.title,
      })

    const runId = `codex_${task.id}_${step.id}_${Date.now().toString(36)}`
    this.activeRunByTask.set(task.id, runId)

    const startedAt = new Date().toISOString()
    let run: CodexRun = {
      id: runId,
      taskId: task.id,
      stepId: step.id,
      agentId: step.agentId,
      mode,
      projectPath: project?.path ?? '',
      status: 'running',
      startedAt,
      activity:
        mode === 'inspect'
          ? 'Inspecting repository'
          : mode === 'implement'
            ? 'Editing files'
            : mode === 'review'
              ? 'Reviewing changes'
              : 'Running verification',
    }
    this.store.upsertCodexRun?.(run)
    this.store.persistSoon()

    const officeStatus =
      mode === 'review'
        ? 'reviewing'
        : mode === 'verify'
          ? 'verifying'
          : 'working'

    this.store.setAgentRuntime(step.agentId, {
      status: officeStatus,
      currentTaskId: task.id,
      currentTaskLabel: step.label,
      speech:
        mode === 'inspect'
          ? 'Inspecting repository…'
          : mode === 'implement'
            ? 'Editing files…'
            : mode === 'review'
              ? 'Reviewing changes…'
              : 'Verifying…',
    })

    try {
      const pre = await preflightCodex({
        projectPath: project?.path,
        mode,
        agentId: step.agentId,
        stepTask: step.label,
      })
      if (!pre.ok) {
        throw new Error(pre.error ?? 'Codex preflight failed')
      }

      const prevCompleted = this.store
        .getSteps()
        .filter((s) => s.taskId === task.id && s.order < step.order && s.status === 'completed')
        .sort((a, b) => b.order - a.order)[0]
      const prevCodex = prevCompleted
        ? this.store
            .getCodexRuns?.()
            ?.filter((r) => r.stepId === prevCompleted.id && r.status === 'completed')
            .at(-1)
        : undefined
      const prevAgent = prevCompleted
        ? this.store
            .getAgentRuns?.()
            ?.filter((r) => r.stepId === prevCompleted.id && r.status === 'completed')
            .at(-1)
        : undefined

      // Prefer implement diff for review/verify context
      const implementRun = this.store
        .getCodexRuns?.()
        ?.filter(
          (r) =>
            r.taskId === task.id &&
            r.mode === 'implement' &&
            r.status === 'completed',
        )
        .at(-1)

      const feedback = task.pendingImplementFeedback
      const prevParts = [
        feedback ? `USER FEEDBACK FOR CHANGES:\n${feedback}` : '',
        implementRun?.unifiedDiff
          ? `UNIFIED DIFF (priority for review):\n${implementRun.unifiedDiff.slice(0, 12000)}`
          : '',
        implementRun?.changedFiles?.length
          ? `CHANGED FILES:\n${implementRun.changedFiles.join('\n')}`
          : '',
        prevCodex?.summary ?? prevAgent?.output ?? '',
      ].filter(Boolean)

      const result = await runCodexStep({
        runId,
        taskId: task.id,
        stepId: step.id,
        agentId: step.agentId,
        mode,
        projectId: project?.id ?? task.projectId,
        projectPath: pre.projectPath ?? project?.path ?? '',
        userRequest: task.description || task.title,
        stepTask: step.label,
        previousResult: prevParts.join('\n\n') || undefined,
      })

      run = {
        ...result.run,
        status: 'completed',
        activity: 'Completed',
      }
      this.store.upsertCodexRun?.(run)
      this.store.persistSoon()
      this.activeRunByTask.delete(task.id)
      return { ok: true, output: result.output, run }
    } catch (err) {
      const withRun = err as {
        run?: CodexRun
        userMessageKo?: string
        code?: string
      }
      const message =
        withRun.userMessageKo ||
        withRun.run?.userMessageKo ||
        withRun.run?.error ||
        (err instanceof Error ? err.message : String(err))
      const failedAt = new Date().toISOString()
      const failedRun: CodexRun = {
        ...run,
        status:
          withRun.code === 'CANCELLED' ||
          message.toLowerCase().includes('취소') ||
          message.toLowerCase().includes('cancel')
            ? 'cancelled'
            : 'failed',
        completedAt: failedAt,
        error: message,
        userMessageKo: message,
        activity: 'Failed',
      }
      if (withRun.run) {
        Object.assign(failedRun, withRun.run, {
          error: withRun.run.userMessageKo || withRun.run.error || message,
          userMessageKo:
            withRun.run.userMessageKo || withRun.userMessageKo || message,
        })
      }
      this.store.upsertCodexRun?.(failedRun)
      this.store.persistSoon()
      this.activeRunByTask.delete(task.id)
      return { ok: false, output: '', run: failedRun }
    }
  }

  cancelTask(taskId: string): void {
    const runId = this.activeRunByTask.get(taskId)
    void cancelCodexRun({ runId, taskId })
    this.activeRunByTask.delete(taskId)
  }
}

export function createCodexExecutionEngine(
  store: EngineStoreAccess,
): CodexExecutionEngine {
  return new CodexExecutionEngine(store)
}
