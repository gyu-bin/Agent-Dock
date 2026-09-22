import { deckEvents } from '../domain/events'
import { selectModelProfileId } from '../domain/modelProfileRouting'
import type { CodexRun, PipelineStep, Task } from '../domain/types'
import {
  busyAgentIds,
  taskProgress,
  type EngineStoreAccess,
  type ExecutionEngine,
} from './types'

const BASE_STEP_MS = 900
const HANDOFF_MS = 350

const MOCK_DIFF = `@@ -1,3 +1,12 @@
+export function LoginForm() {
+  return (
+    <form>
+      <label>이메일</label>
+      <input type="email" name="email" />
+      <label>비밀번호</label>
+      <input type="password" name="password" />
+      <button type="submit">로그인</button>
+    </form>
+  )
+}
`

/**
 * MockExecutionEngine — advances pipeline steps on timers.
 * Speeds: 1x / 2x / 4x. Does not call real AI providers.
 */
export class MockExecutionEngine implements ExecutionEngine {
  private timers = new Map<string, ReturnType<typeof setTimeout>>()
  private speed = 1
  private disposed = false
  private store: EngineStoreAccess

  constructor(store: EngineStoreAccess) {
    this.store = store
  }

  setSpeed(multiplier: number): void {
    this.speed = Math.max(0.25, Math.min(8, multiplier))
  }

  execute(taskId: string): void {
    if (this.disposed) return
    const task = this.store.getTasks().find((t) => t.id === taskId)
    if (!task) return
    if (task.status === 'completed' || task.status === 'cancelled') return

    const now = new Date().toISOString()
    this.store.patchTask(taskId, {
      status: 'running',
      startedAt: task.startedAt ?? now,
      updatedAt: now,
    })
    deckEvents.emit({ type: 'task.started', taskId })
    this.store.persistSoon()
    this.scheduleTick(taskId, 80)
  }

  pause(taskId: string): void {
    this.clearTimer(taskId)
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
        deckEvents.emit({
          type: 'agent.waiting',
          agentId: step.agentId,
          taskId,
        })
      }
    }
    deckEvents.emit({ type: 'task.paused', taskId })
    this.store.persistSoon()
  }

  resume(taskId: string): void {
    const task = this.store.getTasks().find((t) => t.id === taskId)
    if (!task) return
    const canResume =
      task.status === 'paused' ||
      task.status === 'blocked' ||
      task.status === 'awaiting_approval' ||
      (task.status === 'running' && task.approval?.status === 'approved')
    if (!canResume) return
    if (task.status === 'awaiting_approval' && task.approval?.status === 'pending') {
      return
    }
    this.store.patchTask(taskId, {
      status: 'running',
      updatedAt: new Date().toISOString(),
      simulateFailure: false,
    })
    deckEvents.emit({ type: 'task.started', taskId })
    this.store.persistSoon()
    this.scheduleTick(taskId, 120)
  }

  cancel(taskId: string): void {
    this.clearTimer(taskId)
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
    for (const id of this.timers.keys()) this.clearTimer(id)
  }

  private scheduleTick(taskId: string, delayMs: number): void {
    this.clearTimer(taskId)
    const ms = delayMs / this.speed
    const handle = setTimeout(() => this.tick(taskId), ms)
    this.timers.set(taskId, handle)
  }

  private clearTimer(taskId: string): void {
    const t = this.timers.get(taskId)
    if (t) clearTimeout(t)
    this.timers.delete(taskId)
  }

  private tick(taskId: string): void {
    if (this.disposed) return
    const task = this.store.getTasks().find((t) => t.id === taskId)
    if (!task || task.status !== 'running') return

    const steps = this.store
      .getSteps()
      .filter((s) => s.taskId === taskId)
      .sort((a, b) => a.order - b.order)

    const active = steps.find(
      (s) => s.status === 'running' || s.status === 'reviewing',
    )
    if (active) {
      this.completeActiveStep(task, active, steps)
      return
    }

    const next = steps.find(
      (s) => s.status === 'queued' || s.status === 'waiting',
    )
    if (!next) {
      this.finishTask(taskId, 'completed')
      return
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
      deckEvents.emit({
        type: 'agent.waiting',
        agentId: next.agentId,
        taskId,
      })
      this.store.persistSoon()
      this.scheduleTick(taskId, BASE_STEP_MS)
      return
    }

    this.startStep(task, next, steps)
  }

  private startStep(task: Task, step: PipelineStep, all: PipelineStep[]): void {
    const now = new Date().toISOString()

    // Human approval gate (Mock BUILD) — pause for user; seed fixture Diff for change gates
    if (step.provider === 'human') {
      const kind = step.approvalKind === 'plan' ? 'plan' : 'change'
      let runId: string | undefined
      if (kind === 'change') {
        runId = this.seedMockImplementDiff(task, step)
      }
      this.store.patchStep(step.id, {
        status: 'awaiting_approval',
        startedAt: now,
        provider: 'human',
      })
      this.store.patchTask(task.id, {
        status: 'awaiting_approval',
        updatedAt: now,
        approval: {
          status: 'pending',
          stepId: step.id,
          kind,
          note: kind === 'plan' ? '계획 확인' : '변경 확인',
          requestedAt: now,
          runId,
        },
        ...(kind === 'plan'
          ? {
              planSummary:
                task.planSummary ??
                `「${task.title}」계획을 확인해주세요.\n\n1) 요구사항 정리\n2) 구현 범위\n3) 검증 기준`,
            }
          : {}),
      })
      // Free Office agents — human gate has no character assignment
      for (const s of all) {
        if (s.status === 'completed' || s.id === step.id) {
          this.releaseAgent(s.agentId, task.id)
        }
      }
      this.clearTimer(task.id)
      this.store.persistSoon()
      return
    }

    // Record which Model Profile would be used (no live API call)
    if (step.provider === 'openai' || !step.provider) {
      const profileId = selectModelProfileId({
        agentId: step.agentId,
        role: step.role,
        stepLabel: step.label,
        mode: step.mode,
      })
      const runId = `mockrun_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`
      this.store.upsertAgentRun?.({
        id: runId,
        taskId: task.id,
        stepId: step.id,
        agentId: step.agentId,
        status: 'running',
        inputSummary: `${step.label} · profile=${profileId}`,
        output: '',
        startedAt: now,
        model: profileId,
      })
    }

    const isLast = step.order === Math.max(...all.map((s) => s.order))
    const status = isLast && all.length > 1 ? 'reviewing' : 'running'

    // End handoff meeting: prior agents for this task return to idle
    for (const s of all) {
      if (s.id === step.id) continue
      if (s.status === 'completed') {
        this.releaseAgent(s.agentId, task.id)
      }
    }

    this.store.patchStep(step.id, {
      status,
      startedAt: now,
    })
    this.store.setAgentRuntime(step.agentId, {
      status: status === 'reviewing' ? 'reviewing' : 'working',
      currentTaskId: task.id,
      currentTaskLabel: step.label,
      speech: speechForStep(step),
    })
    this.store.patchTask(task.id, {
      progress: taskProgress(task.id, this.store.getSteps()),
      updatedAt: now,
      etaLabel: '~' + Math.ceil(((all.length - step.order + 1) * BASE_STEP_MS) / this.speed / 1000) + 's',
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
    this.store.persistSoon()
    this.scheduleTick(task.id, BASE_STEP_MS)
  }

  private completeActiveStep(
    task: Task,
    step: PipelineStep,
    all: PipelineStep[],
  ): void {
    const now = new Date().toISOString()

    if (task.simulateFailure) {
      this.store.patchStep(step.id, { status: 'failed', completedAt: now })
      this.store.setAgentRuntime(step.agentId, {
        status: 'blocked',
        currentTaskId: task.id,
        currentTaskLabel: step.label,
        speech: '차단됨 — 재시도 필요',
      })
      this.store.patchTask(task.id, {
        status: 'blocked',
        simulateFailure: false,
        updatedAt: now,
        progress: taskProgress(task.id, this.store.getSteps()),
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
      return
    }

    this.store.patchStep(step.id, { status: 'completed', completedAt: now })
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

    const next = all.find((s) => s.order === step.order + 1)
    if (next) {
      // Brief handoff in Meeting Room so Office shows the transfer
      this.store.patchStep(next.id, { status: 'waiting' })
      this.store.setAgentRuntime(step.agentId, {
        status: 'reviewing',
        currentTaskId: task.id,
        currentTaskLabel: step.label,
        speech: '인수인계…',
      })
      this.store.setAgentRuntime(next.agentId, {
        status: 'reviewing',
        currentTaskId: task.id,
        currentTaskLabel: next.label,
        speech: '인수인계 중…',
      })
      deckEvents.emit({
        type: 'agent.reviewing',
        agentId: step.agentId,
        taskId: task.id,
      })
      deckEvents.emit({
        type: 'agent.waiting',
        agentId: next.agentId,
        taskId: task.id,
      })
    } else {
      this.store.setAgentRuntime(step.agentId, {
        status: 'idle',
        currentTaskId: undefined,
        currentTaskLabel: undefined,
        speech: '완료!',
      })
    }

    this.store.patchTask(task.id, {
      progress: taskProgress(task.id, this.store.getSteps()),
      updatedAt: now,
    })
    this.store.persistSoon()

    const remaining = all.some(
      (s) => s.status === 'queued' || s.status === 'waiting',
    )
    if (!remaining && !next) {
      this.finishTask(task.id, 'completed')
      return
    }
    this.scheduleTick(task.id, HANDOFF_MS)
  }

  private finishTask(taskId: string, status: 'completed' | 'failed'): void {
    this.clearTimer(taskId)
    const now = new Date().toISOString()
    const task = this.store.getTasks().find((t) => t.id === taskId)
    const finalResult =
      status === 'completed'
        ? [
            `「${task?.title ?? '작업'}」이(가) 완료되었습니다.`,
            '',
            '요약',
            '- 요청하신 작업을 Mock 워크플로로 완료했습니다.',
            '- 변경 사항은 승인 후 검증·리뷰를 거쳤습니다.',
            '',
            '다음 단계',
            '- 결과물에서 산출물을 확인하세요.',
          ].join('\n')
        : undefined
    this.store.patchTask(taskId, {
      status,
      progress: 100,
      updatedAt: now,
      completedAt: now,
      etaLabel: undefined,
      ...(finalResult ? { finalResult } : {}),
    })
    const steps = this.store.getSteps().filter((s) => s.taskId === taskId)
    for (const step of steps) {
      this.releaseAgent(step.agentId, taskId)
    }
    deckEvents.emit({
      type: status === 'completed' ? 'task.completed' : 'task.failed',
      taskId,
    })
    this.store.persistSoon()

    // Unblock other tasks waiting on freed agents
    for (const t of this.store.getTasks()) {
      if (t.status === 'running' && t.id !== taskId) {
        this.scheduleTick(t.id, 200)
      }
    }
  }

  private seedMockImplementDiff(task: Task, approvalStep: PipelineStep): string {
    const prior =
      this.store
        .getSteps()
        .filter((s) => s.taskId === task.id && s.order < approvalStep.order)
        .sort((a, b) => b.order - a.order)
        .find((s) => s.mode === 'implement' || s.provider === 'codex') ??
      this.store
        .getSteps()
        .filter((s) => s.taskId === task.id && s.order < approvalStep.order)
        .sort((a, b) => b.order - a.order)[0]

    const now = new Date().toISOString()
    const runId = `mockcodex_${Date.now().toString(36)}`
    const run: CodexRun = {
      id: runId,
      taskId: task.id,
      stepId: prior?.id ?? approvalStep.id,
      agentId: prior?.agentId ?? approvalStep.agentId,
      mode: 'implement',
      projectPath: '/mock/project',
      status: 'completed',
      summary: '로그인 폼 컴포넌트 추가 (Mock Diff)',
      changedFiles: ['src/components/LoginForm.tsx'],
      addedFiles: ['src/components/LoginForm.tsx'],
      modifiedFiles: [],
      deletedFiles: [],
      unifiedDiff: MOCK_DIFF,
      diffByFile: {
        'src/components/LoginForm.tsx': MOCK_DIFF,
      },
      startedAt: now,
      completedAt: now,
    }
    this.store.upsertCodexRun?.(run)
    this.store.patchTask(task.id, {
      implementationIterations: [
        ...(task.implementationIterations ?? []),
        {
          index: (task.implementationIterations?.length ?? 0) + 1,
          status: 'pending_approval',
          runId,
          summary: run.summary,
          at: now,
        },
      ],
      updatedAt: now,
    })
    return runId
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

function speechForStep(step: PipelineStep): string {
  const label = step.label.toLowerCase()
  if (label.includes('research') || label.includes('market')) return '시장 조사 중...'
  if (label.includes('core loop') || label.includes('game')) return 'Core Loop 설계 중...'
  if (label.includes('ui')) return 'UI 작업 중...'
  if (label.includes('ux')) return 'UX 조사 중...'
  if (label.includes('implement') || label.includes('code') || label.includes('build'))
    return '구현 작업 중...'
  if (label.includes('review') || label.includes('reality') || label.includes('check'))
    return '결과 검토 중...'
  if (label.includes('market') || label.includes('content') || label.includes('release'))
    return '출시 전략 분석 중...'
  return `${step.label}…`
}

export function createMockExecutionEngine(
  store: EngineStoreAccess,
): MockExecutionEngine {
  return new MockExecutionEngine(store)
}
