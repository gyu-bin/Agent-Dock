import { deckEvents } from '../domain/events'
import type { AgentRun, PipelineStep, Task } from '../domain/types'
import { inferStepProvider } from '../domain/providerRouting'
import {
  ensureSafetyPipelineAfterImplement,
  resolveSafetyAgents,
} from '../domain/safetyPipeline'
import {
  busyAgentIds,
  taskProgress,
  type EngineStoreAccess,
  type ExecutionEngine,
} from './types'
import { runAiStep, synthesizeAiResult } from '../api/client'
import {
  maybeCreateHandoff,
  persistCodexArtifact,
  persistFinalReport,
  persistOpenAiArtifact,
} from '../domain/artifactActions'
import { CodexExecutionEngine } from './codexExecutionEngine'

/**
 * RealAIExecutionEngine — OpenAI steps + hybrid Codex delegation by step.provider.
 * Never silently falls back to Mock.
 */
export class RealAIExecutionEngine implements ExecutionEngine {
  private aborted = new Set<string>()
  private running = new Set<string>()
  private disposed = false
  private store: EngineStoreAccess
  private codex: CodexExecutionEngine

  constructor(store: EngineStoreAccess) {
    this.store = store
    this.codex = new CodexExecutionEngine(store)
  }

  setSpeed(_multiplier: number): void {
    // Real AI has no mock speed multiplier
  }

  execute(taskId: string): void {
    if (this.disposed) return
    void this.runTask(taskId)
  }

  pause(taskId: string): void {
    this.aborted.add(taskId)
    this.codex.cancelTask(taskId)
    const task = this.store.getTasks().find((t) => t.id === taskId)
    if (!task || task.status !== 'running') return
    const now = new Date().toISOString()
    this.store.patchTask(taskId, { status: 'paused', updatedAt: now })
    const steps = this.store.getSteps().filter((s) => s.taskId === taskId)
    for (const step of steps) {
      if (step.status === 'running' || step.status === 'reviewing') {
        this.store.patchStep(step.id, { status: 'waiting' })
        this.store.setAgentRuntime(step.agentId, {
          status: 'waiting',
          currentTaskId: taskId,
          currentTaskLabel: step.label,
          speech: '일시 정지…',
        })
      }
    }
    deckEvents.emit({ type: 'task.paused', taskId })
    this.store.persistSoon()
  }

  resume(taskId: string): void {
    this.aborted.delete(taskId)
    const task = this.store.getTasks().find((t) => t.id === taskId)
    if (
      !task ||
      (task.status !== 'paused' &&
        task.status !== 'blocked' &&
        task.status !== 'awaiting_approval')
    ) {
      return
    }
    // awaiting_approval resume is only valid after approve/request-changes handlers
    if (task.status === 'awaiting_approval' && task.approval?.status === 'pending') {
      return
    }
    this.store.patchTask(taskId, {
      status: task.status === 'awaiting_approval' ? 'running' : 'running',
      updatedAt: new Date().toISOString(),
      verificationFailed: false,
    })
    deckEvents.emit({ type: 'task.started', taskId })
    this.store.persistSoon()
    void this.runTask(taskId)
  }

  cancel(taskId: string): void {
    this.aborted.add(taskId)
    this.codex.cancelTask(taskId)
    const now = new Date().toISOString()
    this.store.patchTask(taskId, {
      status: 'cancelled',
      updatedAt: now,
      completedAt: now,
    })
    const steps = this.store.getSteps().filter((s) => s.taskId === taskId)
    for (const step of steps) {
      if (step.status !== 'completed') {
        this.store.patchStep(step.id, { status: 'queued' })
      }
      this.releaseAgent(step.agentId, taskId)
    }
    deckEvents.emit({ type: 'task.cancelled', taskId })
    this.store.persistSoon()
  }

  dispose(): void {
    this.disposed = true
    for (const id of this.running) {
      this.aborted.add(id)
      this.codex.cancelTask(id)
    }
  }

  private async runTask(taskId: string): Promise<void> {
    if (this.running.has(taskId)) return
    this.running.add(taskId)
    try {
      const task = this.store.getTasks().find((t) => t.id === taskId)
      if (!task) return
      if (task.status === 'completed' || task.status === 'cancelled') return

      const now = new Date().toISOString()
      this.store.patchTask(taskId, {
        status: 'running',
        startedAt: task.startedAt ?? now,
        updatedAt: now,
        executionMode: 'REAL_AI',
      })
      deckEvents.emit({ type: 'task.started', taskId })
      this.store.persistSoon()

      while (!this.disposed && !this.aborted.has(taskId)) {
        const current = this.store.getTasks().find((t) => t.id === taskId)
        if (
          !current ||
          (current.status !== 'running' && current.status !== 'verifying')
        ) {
          break
        }

        const steps = this.store
          .getSteps()
          .filter((s) => s.taskId === taskId)
          .sort((a, b) => a.order - b.order)

        const next = steps.find(
          (s) => s.status === 'queued' || s.status === 'waiting',
        )
        if (!next) {
          await this.finishSuccess(current, steps)
          break
        }

        const busy = busyAgentIds(this.store.getTasks(), this.store.getSteps())
        if (busy.has(next.agentId)) {
          this.store.patchStep(next.id, { status: 'waiting' })
          this.store.setAgentRuntime(next.agentId, {
            status: 'waiting',
            currentTaskId: taskId,
            currentTaskLabel: next.label,
            speech: '대기 중…',
          })
          await sleep(800)
          continue
        }

        const ok = await this.executeStep(current, next, steps)
        if (!ok) break
      }
    } finally {
      this.running.delete(taskId)
    }
  }

  private async executeStep(
    task: Task,
    step: PipelineStep,
    all: PipelineStep[],
  ): Promise<boolean> {
    const provider =
      step.provider ??
      inferStepProvider({
        agentId: step.agentId,
        workflow: task.workflow,
        stepTask: step.label,
        userRequest: task.description || task.title,
      })

    if (provider === 'human') {
      return this.enterApprovalGate(task, step)
    }
    if (provider === 'codex') {
      return this.executeCodexStep(task, step, all)
    }
    return this.executeOpenAiStep(task, step, all)
  }

  private enterApprovalGate(task: Task, step: PipelineStep): boolean {
    const now = new Date().toISOString()
    const kind: 'plan' | 'change' =
      step.approvalKind ??
      (/계획/i.test(step.label) ? 'plan' : 'change')

    // Plan approval — always wait for human; never run IMPLEMENT before this
    if (kind === 'plan') {
      const prev = this.store
        .getSteps()
        .filter((s) => s.taskId === task.id && s.order < step.order)
        .sort((a, b) => b.order - a.order)[0]
      const prevRun = prev
        ? this.store
            .getAgentRuns?.()
            ?.filter((r) => r.stepId === prev.id && r.status === 'completed')
            .at(-1)
        : undefined
      const planExcerpt = (
        task.planSummary ??
        prevRun?.output ??
        '이전 단계에서 작성된 구현 계획을 검토하세요.'
      ).slice(0, 4000)

      this.store.patchStep(step.id, {
        status: 'awaiting_approval',
        startedAt: now,
        provider: 'human',
        approvalKind: 'plan',
      })
      this.store.patchTask(task.id, {
        status: 'awaiting_approval',
        updatedAt: now,
        planSummary: planExcerpt,
        approval: {
          status: 'pending',
          stepId: step.id,
          kind: 'plan',
          planExcerpt,
          requestedAt: now,
        },
      })
      this.store.setAgentRuntime(step.agentId, {
        status: 'waiting',
        currentTaskId: task.id,
        currentTaskLabel: step.label,
        speech: '계획 승인 대기…',
      })
      this.aborted.add(task.id)
      this.store.persistSoon()
      return false
    }

    // Change approval (F1)
    const implementRuns = (this.store.getCodexRuns?.() ?? [])
      .filter(
        (r) =>
          r.taskId === task.id &&
          r.mode === 'implement' &&
          r.status === 'completed',
      )
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    const latest = implementRuns.at(-1)
    const hasChanges = (latest?.changedFiles?.length ?? 0) > 0

    if (!hasChanges) {
      this.store.patchStep(step.id, {
        status: 'completed',
        startedAt: now,
        completedAt: now,
        provider: 'human',
        approvalKind: 'change',
      })
      this.store.patchTask(task.id, {
        approval: {
          status: 'approved',
          stepId: step.id,
          kind: 'change',
          runId: latest?.id,
          snapshotId: latest?.snapshotId,
          decidedAt: now,
          note: '변경 없음 — 자동 승인',
        },
        updatedAt: now,
      })
      this.store.persistSoon()
      return true
    }

    this.store.patchStep(step.id, {
      status: 'awaiting_approval',
      startedAt: now,
      provider: 'human',
      approvalKind: 'change',
    })
    this.store.patchTask(task.id, {
      status: 'awaiting_approval',
      updatedAt: now,
      approval: {
        status: 'pending',
        stepId: step.id,
        kind: 'change',
        runId: latest?.id,
        snapshotId: latest?.snapshotId,
        requestedAt: now,
      },
      implementationIterations: [
        ...(task.implementationIterations ?? []),
        {
          index: (task.implementationIterations?.length ?? 0) + 1,
          runId: latest!.id,
          status: 'pending_approval',
          at: now,
          summary: latest?.summary?.slice(0, 500),
        },
      ],
    })
    this.store.setAgentRuntime(step.agentId, {
      status: 'waiting',
      currentTaskId: task.id,
      currentTaskLabel: step.label,
      speech: '승인 대기…',
    })
    this.aborted.add(task.id)
    this.store.persistSoon()
    return false
  }

  private async executeCodexStep(
    task: Task,
    step: PipelineStep,
    all: PipelineStep[],
  ): Promise<boolean> {
    const now = new Date().toISOString()
    const isLast = step.order === Math.max(...all.map((s) => s.order))
    const isVerify = step.mode === 'verify'
    const status = isVerify
      ? 'running'
      : isLast && all.length > 1
        ? 'reviewing'
        : 'running'

    if (isVerify) {
      this.store.patchTask(task.id, {
        status: 'verifying',
        updatedAt: now,
      })
    }

    for (const s of all) {
      if (s.id !== step.id && s.status === 'completed') {
        this.releaseAgent(s.agentId, task.id)
      }
    }

    this.store.patchStep(step.id, {
      status,
      startedAt: now,
      provider: 'codex',
      mode: step.mode,
    })
    deckEvents.emit({
      type: 'pipeline.step.started',
      taskId: task.id,
      stepId: step.id,
      agentId: step.agentId,
    })

    const result = await this.codex.executeStep(task, {
      ...step,
      provider: 'codex',
    })

    if (this.aborted.has(task.id) || this.disposed) return false

    if (!result.ok) {
      const failedAt = new Date().toISOString()
      const isVerify = (step.mode ?? result.run.mode) === 'verify'
      this.store.patchStep(step.id, { status: 'failed', completedAt: failedAt })
      this.store.setAgentRuntime(step.agentId, {
        status: 'blocked',
        currentTaskId: task.id,
        currentTaskLabel: step.label,
        speech: isVerify ? '검증 실패' : '차단됨 — Codex 실패',
      })
      this.store.patchTask(task.id, {
        status: 'blocked',
        updatedAt: failedAt,
        progress: taskProgress(task.id, this.store.getSteps()),
        verificationFailed: isVerify,
      })
      deckEvents.emit({
        type: 'pipeline.step.failed',
        taskId: task.id,
        stepId: step.id,
        agentId: step.agentId,
      })
      deckEvents.emit({
        type: 'agent.blocked',
        agentId: step.agentId,
        taskId: task.id,
      })
      deckEvents.emit({ type: 'task.failed', taskId: task.id })
      this.store.persistSoon()
      return false
    }

    // Verify step — treat any fail command as failure (engine already fails run)
    if (step.mode === 'verify' || result.run.mode === 'verify') {
      const failedCmds = (result.run.commands ?? []).filter((c) => c.status === 'fail')
      if (failedCmds.length > 0) {
        const failedAt = new Date().toISOString()
        this.store.patchStep(step.id, { status: 'failed', completedAt: failedAt })
        this.store.patchTask(task.id, {
          status: 'blocked',
          updatedAt: failedAt,
          verificationFailed: true,
          progress: taskProgress(task.id, this.store.getSteps()),
        })
        this.store.setAgentRuntime(step.agentId, {
          status: 'blocked',
          currentTaskId: task.id,
          currentTaskLabel: step.label,
          speech: '검증 실패',
        })
        this.store.persistSoon()
        return false
      }
    }

    // Mark verifying status while verify runs is handled via agent runtime above
    if (step.mode === 'verify') {
      this.store.patchTask(task.id, {
        status: 'running',
        updatedAt: new Date().toISOString(),
      })
    }

    const completedAt = new Date().toISOString()
    this.store.patchStep(step.id, { status: 'completed', completedAt })
    this.store.setAgentRuntime(step.agentId, {
      status: 'idle',
      speech: '완료!',
      currentTaskId: undefined,
      currentTaskLabel: undefined,
    })
    this.store.patchTask(task.id, {
      progress: taskProgress(task.id, this.store.getSteps()),
      updatedAt: completedAt,
    })
    deckEvents.emit({
      type: 'pipeline.step.completed',
      taskId: task.id,
      stepId: step.id,
      agentId: step.agentId,
    })
    deckEvents.emit({
      type: 'agent.completed',
      agentId: step.agentId,
      taskId: task.id,
    })

    // F2: verification/review artifacts immediately; implement waits for approval
    const mode = step.mode ?? result.run.mode
    if (mode === 'verify' || mode === 'review') {
      try {
        await persistCodexArtifact({
          projectId: task.projectId,
          task,
          step,
          run: result.run,
          approved: false,
        })
        const next = all
          .filter((s) => s.order > step.order)
          .sort((a, b) => a.order - b.order)[0]
        if (next && result.run.summary) {
          await maybeCreateHandoff({
            projectId: task.projectId,
            task,
            fromStep: step,
            toStep: next,
            output: result.run.summary,
            artifactIds: [],
          })
        }
      } catch (err) {
        console.warn('[F2] codex artifact persist failed', err)
      }
    }

    // System policy: after Codex IMPLEMENT, force safety chain (LLM cannot skip).
    const ranImplement =
      mode === 'implement' || result.run.mode === 'implement'
    if (ranImplement && this.store.replaceStepsForTask) {
      const currentSteps = this.store
        .getSteps()
        .filter((s) => s.taskId === task.id)
      const agents = resolveSafetyAgents({
        assignedAgentIds: task.assignedAgentIds,
        steps: currentSteps,
        registryIds: (this.store.getRegistry?.() ?? []).map((a) => a.id),
      })
      const enforced = ensureSafetyPipelineAfterImplement({
        taskId: task.id,
        steps: currentSteps,
        implementStepId: step.id,
        agents,
      })
      this.store.replaceStepsForTask(task.id, enforced)
    }

    this.store.persistSoon()
    return true
  }

  private async executeOpenAiStep(
    task: Task,
    step: PipelineStep,
    all: PipelineStep[],
  ): Promise<boolean> {
    const now = new Date().toISOString()
    const isLast = step.order === Math.max(...all.map((s) => s.order))
    const status = isLast && all.length > 1 ? 'reviewing' : 'running'

    for (const s of all) {
      if (s.id !== step.id && s.status === 'completed') {
        this.releaseAgent(s.agentId, task.id)
      }
    }

    this.store.patchStep(step.id, {
      status,
      startedAt: now,
      provider: step.provider ?? 'openai',
    })
    this.store.setAgentRuntime(step.agentId, {
      status: status === 'reviewing' ? 'reviewing' : 'working',
      currentTaskId: task.id,
      currentTaskLabel: step.label,
      speech: `${step.label}…`,
    })
    deckEvents.emit({
      type: 'pipeline.step.started',
      taskId: task.id,
      stepId: step.id,
      agentId: step.agentId,
    })
    deckEvents.emit({
      type: status === 'reviewing' ? 'agent.reviewing' : 'agent.started',
      agentId: step.agentId,
      taskId: task.id,
    })

    const runId = `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
    const run: AgentRun = {
      id: runId,
      taskId: task.id,
      stepId: step.id,
      agentId: step.agentId,
      status: 'running',
      inputSummary: step.label,
      output: '',
      startedAt: now,
    }
    this.store.upsertAgentRun?.(run)
    this.store.persistSoon()

    const project =
      this.store.getProjects?.()?.find(
        (p) => p.id === (this.store.getActiveProjectId?.() ?? task.projectId),
      ) ?? null

    const prevCompleted = all
      .filter((s) => s.order < step.order && s.status === 'completed')
      .sort((a, b) => b.order - a.order)[0]
    const prevRun = prevCompleted
      ? this.store
          .getAgentRuns?.()
          ?.filter((r) => r.stepId === prevCompleted.id && r.status === 'completed')
          .at(-1)
      : undefined
    const prevCodex = prevCompleted
      ? this.store
          .getCodexRuns?.()
          ?.filter((r) => r.stepId === prevCompleted.id && r.status === 'completed')
          .at(-1)
      : undefined

    try {
      const priorHasResearch =
        (step.inputArtifactTypes?.includes('research') ?? false) &&
        step.requiresWebSearch !== true
      const result = await runAiStep({
        agentId: step.agentId,
        stepTask: step.label,
        userRequest: task.description || task.title,
        projectId: project?.id ?? task.projectId,
        taskId: task.id,
        stepId: step.id,
        projectType: project?.type,
        projectName: project?.name,
        previousResult: (prevCodex?.summary ?? prevRun?.output)?.slice(0, 1200),
        requiresWebSearch: step.requiresWebSearch,
        role: step.role,
        skipBecausePriorResearch: priorHasResearch,
      })

      if (this.aborted.has(task.id) || this.disposed) return false

      const completedAt = new Date().toISOString()
      this.store.patchStep(step.id, { status: 'completed', completedAt })
      this.store.upsertAgentRun?.({
        ...run,
        status: 'completed',
        output: result.output,
        inputSummary: result.inputSummary,
        completedAt,
        model: result.usage.model,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
      })
      this.store.setAgentRuntime(step.agentId, {
        status: 'idle',
        speech: '완료!',
        currentTaskId: undefined,
        currentTaskLabel: undefined,
      })

      const session = result.webSearch?.session
      const sessions = session
        ? [...(task.webSearchSessions ?? []), session]
        : task.webSearchSessions
      this.store.patchTask(task.id, {
        progress: taskProgress(task.id, this.store.getSteps()),
        updatedAt: completedAt,
        webSearchSessions: sessions,
        webSearchFailure: undefined,
      })
      deckEvents.emit({
        type: 'pipeline.step.completed',
        taskId: task.id,
        stepId: step.id,
        agentId: step.agentId,
      })
      deckEvents.emit({
        type: 'agent.completed',
        agentId: step.agentId,
        taskId: task.id,
      })

      // F2: persist reusable artifact + structured handoff (no extra LLM)
      const projectId = project?.id ?? task.projectId
      let artifactIds: string[] = result.contextMeta?.includedArtifactIds ?? []
      try {
        if (
          step.outputArtifactType === 'plan' ||
          /계획|plan/i.test(step.label)
        ) {
          this.store.patchTask(task.id, {
            planSummary: result.output.slice(0, 4000),
            updatedAt: completedAt,
          })
        }
        const art = await persistOpenAiArtifact({
          projectId,
          task,
          step,
          output: result.output,
          sources: result.webSearch?.sources,
          searchedAt: session?.searchedAt,
        })
        if (art) artifactIds = [...artifactIds, art.id]
        const next = all
          .filter((s) => s.order > step.order)
          .sort((a, b) => a.order - b.order)[0]
        if (next) {
          await maybeCreateHandoff({
            projectId,
            task,
            fromStep: step,
            toStep: next,
            output: result.output,
            artifactIds,
            relevantArtifactIds: art ? [art.id] : artifactIds.slice(-1),
            relevantSourceIds: result.webSearch?.sources?.map((s) => s.id),
          })
        }
      } catch (err) {
        console.warn('[F2] artifact/handoff persist failed', err)
      }

      this.store.persistSoon()
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const code = (err as { code?: string }).code
      const failedAt = new Date().toISOString()
      const isSearchFail =
        code === 'WEB_SEARCH_FAILED' ||
        code === 'WEB_SEARCH_UNAVAILABLE' ||
        /웹 검색 실패/.test(message)

      this.store.patchStep(step.id, {
        status: isSearchFail ? 'blocked' : 'failed',
        completedAt: failedAt,
      })
      this.store.upsertAgentRun?.({
        ...run,
        status: 'failed',
        output: '',
        error: isSearchFail ? '웹 검색 실패' : message,
        completedAt: failedAt,
      })
      this.store.setAgentRuntime(step.agentId, {
        status: 'blocked',
        currentTaskId: task.id,
        currentTaskLabel: step.label,
        speech: isSearchFail ? '웹 검색 실패' : '차단됨 — Real AI 실패',
      })
      this.store.patchTask(task.id, {
        status: 'blocked',
        updatedAt: failedAt,
        progress: taskProgress(task.id, this.store.getSteps()),
        webSearchFailure: isSearchFail
          ? { message: '웹 검색 실패', stepId: step.id, at: failedAt }
          : undefined,
      })
      deckEvents.emit({
        type: 'pipeline.step.failed',
        taskId: task.id,
        stepId: step.id,
        agentId: step.agentId,
      })
      deckEvents.emit({
        type: 'agent.blocked',
        agentId: step.agentId,
        taskId: task.id,
      })
      deckEvents.emit({ type: 'task.failed', taskId: task.id })
      this.store.persistSoon()
      return false
    }
  }

  private async finishSuccess(task: Task, steps: PipelineStep[]): Promise<void> {
    const registry = this.store.getRegistry?.() ?? []
    const runs = this.store.getAgentRuns?.() ?? []
    const codexRuns = this.store.getCodexRuns?.() ?? []
    const stepOutputs = steps
      .filter((s) => s.status === 'completed')
      .map((s) => {
        const agent = registry.find((a) => a.id === s.agentId)
        const agentRun = runs
          .filter((r) => r.stepId === s.id && r.status === 'completed')
          .at(-1)
        const codexRun = codexRuns
          .filter((r) => r.stepId === s.id && r.status === 'completed')
          .at(-1)
        const output =
          agentRun?.output ||
          codexRun?.summary ||
          (codexRun?.changedFiles?.length
            ? `Changed files:\n${codexRun.changedFiles.join('\n')}`
            : '') ||
          ''
        return {
          agentId: s.agentId,
          agentName: agent?.name ?? s.agentId,
          task: s.label,
          output,
        }
      })

    let finalResult = stepOutputs
      .map((s) => `## ${s.agentName}\n${s.output}`)
      .join('\n\n')
    try {
      const synth = await synthesizeAiResult({
        userRequest: task.description || task.title,
        workflow: task.workflow,
        stepOutputs,
      })
      finalResult = synth.output
    } catch {
      // Keep concatenated fallback
    }

    const now = new Date().toISOString()
    this.store.patchTask(task.id, {
      status: 'completed',
      progress: 100,
      updatedAt: now,
      completedAt: now,
      finalResult,
      etaLabel: undefined,
    })
    for (const step of steps) this.releaseAgent(step.agentId, task.id)
    deckEvents.emit({ type: 'task.completed', taskId: task.id })

    try {
      await persistFinalReport({
        projectId: task.projectId,
        task,
        content: finalResult,
      })
    } catch (err) {
      console.warn('[F2] final report artifact failed', err)
    }

    this.store.persistSoon()
  }

  private releaseAgent(agentId: string, taskId: string): void {
    const runtime = this.store.getAgentRuntime()[agentId]
    if (runtime?.currentTaskId && runtime.currentTaskId !== taskId) return
    this.store.setAgentRuntime(agentId, {
      status: 'idle',
      currentTaskId: undefined,
      currentTaskLabel: undefined,
      speech: undefined,
    })
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export function createRealAIExecutionEngine(
  store: EngineStoreAccess,
): RealAIExecutionEngine {
  return new RealAIExecutionEngine(store)
}
