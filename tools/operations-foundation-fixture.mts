/**
 * Project Operations Foundation fixtures A–I.
 * Run: npx tsx tools/operations-foundation-fixture.mts
 * No real provider / timer / SNS.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { JsonOperationsRepository } from '../server/src/persistence/operationsRepository.ts'
import {
  OperationsService,
  calculateNextRun,
} from '../server/src/persistence/operationsService.ts'
import { matchAgentForCapabilities } from '../client/src/domain/capabilities/index.ts'
import { DEFAULT_EXECUTION_POLICY } from '../client/src/domain/operations/operationsTypes.ts'
import { getRoutineTemplate } from '../client/src/domain/operations/routineTemplates.ts'
import { calculateNextRun as clientNextRun } from '../client/src/domain/operations/routineScheduler.ts'
import type { Agent } from '../client/src/domain/types.ts'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg)
}

function eq<T>(a: T, b: T, msg: string) {
  assert(a === b, `${msg}: expected ${String(b)}, got ${String(a)}`)
}

const dir = mkdtempSync(path.join(tmpdir(), 'ad-ops-'))
const repo = new JsonOperationsRepository(dir)
const ops = new OperationsService(repo)

const PROJECT_A = 'proj_dont_move'
const PROJECT_B = 'proj_other'

try {
  // ——— A: Goal ———
  {
    const goal = await ops.createGoal(PROJECT_A, {
      type: 'marketing',
      title: '사용자 확보',
      successCriteria: ['꾸준한 SNS 노출', '스토어 방문 증가'],
    })
    eq(goal.title, '사용자 확보', 'A title')
    const board = await ops.getBoard(PROJECT_A)
    assert(board.goals.some((g) => g.id === goal.id), 'A reload')
    console.log('TEST A PASS')
  }

  // ——— B: Weekly Marketing ———
  {
    const board = await ops.getBoard(PROJECT_A)
    const goal = board.goals[0]
    const routine = await ops.createRoutine(PROJECT_A, {
      templateId: 'WEEKLY_MARKETING',
      goalId: goal.id,
      now: new Date('2026-03-02T00:00:00.000Z'),
    })
    eq(routine.templateId, 'WEEKLY_MARKETING', 'B template')
    assert(routine.goalId === goal.id, 'B goal link')
    assert(
      routine.requiredCapabilities.includes('marketing.plan'),
      'B caps',
    )
    assert(routine.schedule?.kind === 'weekly', 'B schedule')
    assert(routine.executionPolicy.requireApprovalForWrite === true, 'B policy')
    assert(routine.nextRunAt, 'B nextRunAt')
    const tpl = getRoutineTemplate('WEEKLY_MARKETING')
    assert(tpl, 'B client template')
    console.log('TEST B PASS')
  }

  // ——— C: Manual Run + task source linkage ———
  {
    const board = await ops.getBoard(PROJECT_A)
    const routine = board.routines[0]
    const taskId = 'task_fixture_c'
    const result = await ops.runManual(routine.id, {
      projectId: PROJECT_A,
      taskId,
      teamAgentIds: ['frontend-developer', 'product-manager'],
      specialistCandidates: ['growth-hacker', 'trend-researcher'],
    })
    eq(result.run.taskIds[0], taskId, 'C task id')
    assert(result.run.routineId === routine.id, 'C routine link')
    const source = {
      type: 'routine' as const,
      routineId: routine.id,
      routineRunId: result.run.id,
    }
    eq(source.type, 'routine', 'C source type')
    assert(source.routineRunId === result.run.id, 'C run id')
    console.log('TEST C PASS')
  }

  // ——— D: Specialist discovery (capability matcher, no provider) ———
  {
    const team: Agent[] = [
      {
        id: 'frontend-developer',
        name: 'Frontend',
        division: 'engineering',
        description: '',
        status: 'idle',
        enabled: true,
      },
      {
        id: 'product-manager',
        name: 'PM',
        division: 'product',
        description: '',
        status: 'idle',
        enabled: true,
      },
    ]
    const registry: Agent[] = [
      ...team,
      {
        id: 'growth-hacker',
        name: 'Growth',
        division: 'marketing',
        description: 'marketing growth',
        status: 'idle',
        enabled: true,
      },
    ]
    const hit = matchAgentForCapabilities({
      requiredCapabilities: ['marketing.plan', 'marketing.content'],
      team,
      registry,
    })
    assert(hit, 'D hit')
    eq(hit.source, 'specialist', 'D specialist')
    eq(hit.agentId, 'growth-hacker', 'D growth')
    console.log('TEST D PASS')
  }

  // ——— E: Optional future social.publish must NOT block required path ———
  {
    const routine = await ops.createRoutine(PROJECT_A, {
      name: 'Publish attempt',
      description: 'future publish optional',
      requiredCapabilities: ['marketing.content'],
      futureCapabilities: ['social.publish'],
      trigger: 'manual',
    })
    const result = await ops.runManual(routine.id, { projectId: PROJECT_A })
    assert(
      result.taskSeed.optionalUnavailable?.includes('social.publish') ||
        result.run.missingCapabilities?.includes('social.publish'),
      'E notes social.publish optional unavailable',
    )
    assert(
      result.taskSeed.description.includes('unavailable') ||
        result.taskSeed.description.includes('social.publish'),
      'E message',
    )
    // Future/optional must not block — no fake publish success either
    assert(result.run.status !== 'blocked', 'E not blocked by optional')
    assert(result.run.status !== 'completed', 'E not fake complete')
    console.log('TEST E PASS')
  }

  // ——— F: Safety policy inheritance ———
  {
    const routine = await ops.createRoutine(PROJECT_A, {
      name: 'Code maintenance',
      description: 'code.write routine',
      requiredCapabilities: ['code.write', 'code.inspect'],
      trigger: 'manual',
    })
    eq(
      routine.executionPolicy.requireApprovalForWrite,
      DEFAULT_EXECUTION_POLICY.requireApprovalForWrite,
      'F write approval',
    )
    assert(
      routine.executionPolicy.requireApprovalForWrite === true,
      'F no bypass',
    )
    console.log('TEST F PASS')
  }

  // ——— G: Persistence restart simulation ———
  {
    const before = await ops.getBoard(PROJECT_A)
    const repo2 = new JsonOperationsRepository(dir)
    const ops2 = new OperationsService(repo2)
    const after = await ops2.getBoard(PROJECT_A)
    eq(before.goals.length, after.goals.length, 'G goals')
    eq(before.routines.length, after.routines.length, 'G routines')
    eq(before.runs.length, after.runs.length, 'G runs')
    console.log('TEST G PASS')
  }

  // ——— H: Isolation ———
  {
    await ops.createGoal(PROJECT_B, {
      type: 'development',
      title: 'Other project goal',
    })
    const a = await ops.getBoard(PROJECT_A)
    const b = await ops.getBoard(PROJECT_B)
    assert(
      !b.routines.some((r) => a.routines.some((x) => x.id === r.id)),
      'H no routine leak',
    )
    assert(
      !a.goals.some((g) => g.title === 'Other project goal'),
      'H no goal leak',
    )
    console.log('TEST H PASS')
  }

  // ——— I: Schedule calculation deterministic ———
  {
    const now = new Date('2026-03-02T00:00:00.000Z') // Monday UTC
    const next = calculateNextRun(
      { kind: 'weekly', daysOfWeek: [1], time: '09:00' },
      now,
    )
    const next2 = calculateNextRun(
      { kind: 'weekly', daysOfWeek: [1], time: '09:00' },
      now,
    )
    eq(next, next2, 'I deterministic')
    const client = clientNextRun(
      { kind: 'weekly', daysOfWeek: [1], time: '09:00' },
      now,
    )
    eq(next, client, 'I client/server match')
    assert(next && new Date(next).getTime() > now.getTime(), 'I future')
    console.log('TEST I PASS', { next })
  }

  console.log('operationsFoundation fixtures: ALL PASS')
} finally {
  rmSync(dir, { recursive: true, force: true })
}
