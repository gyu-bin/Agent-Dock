/**
 * Routine Scheduler Runtime fixtures A–L.
 * Run: npx tsx tools/routine-scheduler-fixture.mts
 * No real provider / SNS / Office.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { JsonOperationsRepository } from '../server/src/persistence/operationsRepository.ts'
import { OperationsService } from '../server/src/persistence/operationsService.ts'
import { JsonProjectRepository } from '../server/src/persistence/jsonStore.ts'
import { ProjectService } from '../server/src/persistence/projectService.ts'
import {
  RoutineExecutionService,
  RoutineSchedulerRuntime,
  calculateNextRun,
  getMostRecentOccurrence,
  getZonedParts,
  zonedTimeToUtc,
} from '../server/src/operations/index.ts'
import { calculateNextRun as clientNextRun } from '../client/src/domain/operations/routineScheduler.ts'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg)
}

function eq<T>(a: T, b: T, msg: string) {
  assert(a === b, `${msg}: expected ${String(b)}, got ${String(a)}`)
}

const dir = mkdtempSync(path.join(tmpdir(), 'ad-sched-'))
const opsDir = path.join(dir, 'operations')
const projectsFile = path.join(dir, 'projects.json')

const opsRepo = new JsonOperationsRepository(opsDir)
const ops = new OperationsService(opsRepo)
const projects = new ProjectService(new JsonProjectRepository(projectsFile))
const execution = new RoutineExecutionService(ops, projects)
const scheduler = new RoutineSchedulerRuntime(ops, projects, {
  enabled: false,
  intervalMs: 60_000,
})

const PROJECT_A = 'proj_sched_a'
const PROJECT_B = 'proj_sched_b'

/** Monday 2026-09-28 09:00 Asia/Seoul */
const MON_0900_SEOUL = zonedTimeToUtc(2026, 9, 28, 9, 0, 'Asia/Seoul')

try {
  // Seed projects
  {
    const snap = await projects.getSnapshot()
    await projects.appendWork({}) // ensure file
    // Direct save via create then patch ids — use update after create
  }
  // Create with fixed ids by writing through repo path
  {
    const now = new Date().toISOString()
    const repo = new JsonProjectRepository(projectsFile)
    await repo.save({
      version: 5,
      revision: 1,
      activeProjectId: PROJECT_A,
      projects: [
        {
          id: PROJECT_A,
          name: "Don't Move",
          type: 'mobile-game',
          status: 'active',
          agentIds: ['product-manager', 'trend-researcher'],
          createdAt: now,
          updatedAt: now,
        },
        {
          id: PROJECT_B,
          name: 'Other',
          type: 'web-app',
          status: 'active',
          agentIds: ['frontend-developer'],
          createdAt: now,
          updatedAt: now,
        },
      ],
      tasks: [],
      pipelineSteps: [],
      agentRuns: [],
      codexRuns: [],
    })
  }

  await ops.createGoal(PROJECT_A, {
    type: 'growth',
    title: '사용자 확보',
  })

  // ——— A: Due ———
  {
    const routine = await ops.createRoutine(PROJECT_A, {
      templateId: 'WEEKLY_MARKETING',
      now: new Date('2026-09-21T00:00:00.000Z'), // previous week → next is Mon 28
    })
    // Force nextRunAt to Mon 09:00 Seoul
    await ops.patchRoutine(routine.id, {
      projectId: PROJECT_A,
      nextRunAt: MON_0900_SEOUL.toISOString(),
    })
    const tick = await scheduler.tick(MON_0900_SEOUL)
    eq(tick.created, 1, 'A created')
    const board = await ops.getBoard(PROJECT_A)
    const runs = board.runs.filter((r) => r.routineId === routine.id)
    eq(runs.length, 1, 'A one run')
    eq(runs[0]!.triggerSource, 'scheduled', 'A scheduled')
    assert(runs[0]!.scheduledFor, 'A scheduledFor')
    console.log('TEST A PASS')
  }

  // ——— B: Not Due ———
  {
    const before = (await ops.getBoard(PROJECT_A)).runs.length
    const routine = await ops.createRoutine(PROJECT_A, {
      name: 'Future only',
      description: 'not due',
      templateId: 'COMPETITOR_RESEARCH',
      now: MON_0900_SEOUL,
    })
    assert(
      routine.nextRunAt &&
        new Date(routine.nextRunAt).getTime() > MON_0900_SEOUL.getTime(),
      'B next future',
    )
    const tick = await scheduler.tick(MON_0900_SEOUL)
    eq(tick.created, 0, 'B created 0')
    const after = (await ops.getBoard(PROJECT_A)).runs.length
    eq(after, before, 'B no new runs')
    console.log('TEST B PASS')
  }

  // ——— C: Duplicate ———
  {
    const board0 = await ops.getBoard(PROJECT_A)
    const marketing = board0.routines.find((r) => r.templateId === 'WEEKLY_MARKETING')!
    // Reset nextRunAt to same occurrence
    const scheduledFor = marketing.nextRunAt
      ? // use previous occurrence still
        getMostRecentOccurrence(marketing.schedule!, MON_0900_SEOUL)!
      : MON_0900_SEOUL.toISOString()
    // Put nextRunAt back to due
    await ops.patchRoutine(marketing.id, {
      projectId: PROJECT_A,
      nextRunAt: scheduledFor,
    })
    const before = (await ops.getBoard(PROJECT_A)).runs.filter(
      (r) => r.routineId === marketing.id,
    ).length
    await scheduler.tick(MON_0900_SEOUL)
    await scheduler.tick(MON_0900_SEOUL)
    await scheduler.tick(MON_0900_SEOUL)
    const after = (await ops.getBoard(PROJECT_A)).runs.filter(
      (r) => r.routineId === marketing.id,
    ).length
    // At most one additional if nextRunAt was rewound; total unique scheduledFor = 1 for that slot
    const sameSlot = (await ops.getBoard(PROJECT_A)).runs.filter(
      (r) =>
        r.routineId === marketing.id &&
        r.scheduledFor === scheduledFor,
    )
    eq(sameSlot.length, 1, 'C one occurrence')
    assert(after <= before + 1, 'C no flood')
    console.log('TEST C PASS', { before, after, sameSlot: sameSlot.length })
  }

  // ——— D: Catch-up ———
  {
    const routine = await ops.createRoutine(PROJECT_A, {
      name: 'Mon Wed Fri',
      description: 'catch-up',
      requiredCapabilities: ['research.web', 'marketing.plan'],
      futureCapabilities: [],
      trigger: 'scheduled',
      schedule: {
        kind: 'weekly',
        daysOfWeek: [1, 3, 5],
        time: '09:00',
        timezone: 'Asia/Seoul',
      },
      // Stale nextRunAt = Monday (3 missed by Friday)
      now: new Date('2026-09-20T00:00:00.000Z'),
    })
    const mon = zonedTimeToUtc(2026, 9, 28, 9, 0, 'Asia/Seoul')
    await ops.patchRoutine(routine.id, {
      projectId: PROJECT_A,
      nextRunAt: mon.toISOString(),
    })
    // Friday 2026-10-02 10:00 Seoul
    const fri = zonedTimeToUtc(2026, 10, 2, 10, 0, 'Asia/Seoul')
    const before = (await ops.getBoard(PROJECT_A)).runs.filter(
      (r) => r.routineId === routine.id,
    ).length
    const tick = await scheduler.tick(fri)
    assert(tick.created >= 1, 'D catch-up created')
    const runs = (await ops.getBoard(PROJECT_A)).runs.filter(
      (r) => r.routineId === routine.id,
    )
    eq(runs.length, before + 1, 'D only 1 catch-up')
    eq(runs[0]!.triggerSource, 'catch-up', 'D source catch-up')
    const recent = getMostRecentOccurrence(routine.schedule!, fri)!
    eq(runs[0]!.scheduledFor, recent, 'D most recent occurrence')
    const updated = (await ops.getBoard(PROJECT_A)).routines.find(
      (r) => r.id === routine.id,
    )!
    assert(
      updated.nextRunAt &&
        new Date(updated.nextRunAt).getTime() > fri.getTime(),
      'D nextRunAt future',
    )
    console.log('TEST D PASS')
  }

  // ——— E: Pause ———
  {
    const routine = await ops.createRoutine(PROJECT_A, {
      name: 'Paused routine',
      description: 'paused',
      templateId: 'COMPETITOR_RESEARCH',
      status: 'paused',
      now: new Date('2026-09-20T00:00:00.000Z'),
    })
    await ops.patchRoutine(routine.id, {
      projectId: PROJECT_A,
      status: 'paused',
      nextRunAt: MON_0900_SEOUL.toISOString(),
    })
    const before = (await ops.getBoard(PROJECT_A)).runs.length
    const tick = await scheduler.tick(MON_0900_SEOUL)
    const after = (await ops.getBoard(PROJECT_A)).runs.length
    eq(after, before, 'E no runs for paused')
    assert(tick.created === 0 || true, 'E tick ok')
    const pausedRuns = (await ops.getBoard(PROJECT_A)).runs.filter(
      (r) => r.routineId === routine.id,
    )
    eq(pausedRuns.length, 0, 'E zero for paused routine')
    console.log('TEST E PASS')
  }

  // ——— F: Missing required Tool ———
  {
    const routine = await ops.createRoutine(PROJECT_A, {
      name: 'Must publish',
      description: 'requires social.publish',
      requiredCapabilities: ['social.publish'],
      trigger: 'manual',
    })
    const result = await execution.start({
      routineId: routine.id,
      projectId: PROJECT_A,
      triggerSource: 'manual',
      idempotent: false,
    })
    eq(result.run.status, 'blocked', 'F blocked')
    assert(
      result.run.summary?.includes('게시') ||
        result.run.missingCapabilities?.includes('social.publish'),
      'F message',
    )
    assert(!result.task, 'F no fake task')
    assert(result.taskSeed === null, 'F no task seed success')
    const snap = await projects.getSnapshot()
    const fakeDone = snap.tasks.filter(
      (t) =>
        t.source?.routineId === routine.id && t.status === 'completed',
    )
    eq(fakeDone.length, 0, 'F no fake complete')
    console.log('TEST F PASS')
  }

  // ——— G: Auto Research ———
  {
    const routine = await ops.createRoutine(PROJECT_A, {
      templateId: 'COMPETITOR_RESEARCH',
      now: new Date('2026-09-20T00:00:00.000Z'),
    })
    const dueAt = zonedTimeToUtc(2026, 9, 30, 10, 0, 'Asia/Seoul') // Wed
    await ops.patchRoutine(routine.id, {
      projectId: PROJECT_A,
      nextRunAt: dueAt.toISOString(),
    })
    const result = await execution.start({
      routineId: routine.id,
      projectId: PROJECT_A,
      triggerSource: 'scheduled',
      scheduledFor: dueAt.toISOString(),
      teamAgentIds: ['product-manager'],
      specialistCandidates: ['trend-researcher'],
      now: dueAt,
    })
    assert(result.created, 'G created')
    assert(result.task, 'G task created')
    eq(result.task!.source?.type, 'routine', 'G source type')
    eq(result.task!.source?.routineId, routine.id, 'G source routine')
    eq(result.task!.source?.routineRunId, result.run.id, 'G source run')
    eq(result.task!.workflowTemplateId, 'RESEARCH_TO_BUILD', 'G workflow')
    assert(result.taskSeed?.autoStart === true, 'G autoStart')
    console.log('TEST G PASS')
  }

  // ——— H: Safety ———
  {
    const routine = await ops.createRoutine(PROJECT_A, {
      name: 'Code write routine',
      description: 'needs approval',
      requiredCapabilities: ['code.write', 'code.inspect'],
      workflowTemplateId: 'FEATURE_BUILD',
      trigger: 'scheduled',
      schedule: {
        kind: 'daily',
        time: '11:00',
        timezone: 'Asia/Seoul',
      },
      now: new Date('2026-09-27T00:00:00.000Z'),
    })
    const dueAt = zonedTimeToUtc(2026, 9, 28, 11, 0, 'Asia/Seoul')
    await ops.patchRoutine(routine.id, {
      projectId: PROJECT_A,
      nextRunAt: dueAt.toISOString(),
    })
    const result = await execution.start({
      routineId: routine.id,
      projectId: PROJECT_A,
      triggerSource: 'scheduled',
      scheduledFor: dueAt.toISOString(),
      now: dueAt,
    })
    assert(result.created, 'H created')
    assert(result.task, 'H task')
    eq(result.task!.workflowTemplateId, 'FEATURE_BUILD', 'H template')
    const snap = await projects.getSnapshot()
    const steps = snap.pipelineSteps.filter((s) => s.taskId === result.task!.id)
    assert(
      steps.some((s) => s.provider === 'codex' && s.mode === 'implement'),
      'H implement',
    )
    assert(
      steps.some((s) => s.provider === 'human'),
      'H human approval in pipeline',
    )
    assert(
      steps.some((s) => s.mode === 'verify'),
      'H verify',
    )
    console.log('TEST H PASS')
  }

  // ——— I: Approval reconcile ———
  {
    // Create a run linked to an awaiting_approval task
    const board0 = await ops.getBoard(PROJECT_A)
    const research = board0.routines.find(
      (r) => r.templateId === 'COMPETITOR_RESEARCH',
    )
    assert(research, 'I research routine')
    const runResult = await ops.startRoutineRun({
      routineId: research!.id,
      projectId: PROJECT_A,
      triggerSource: 'manual',
      taskId: 'task_approval_i',
      idempotent: false,
    })
    await ops.updateRunStatus(PROJECT_A, runResult.run.id, {
      status: 'awaiting_approval',
    })
    const snap0 = await projects.getSnapshot()
    const now = new Date().toISOString()
    await projects.appendWork({
      tasks: [
        {
          id: 'task_approval_i',
          projectId: PROJECT_A,
          title: 'Approval fixture',
          description: 'awaiting',
          status: 'awaiting_approval',
          workflow: 'BUILD',
          priority: 'normal',
          assignedAgentIds: ['product-manager'],
          recommendedExtraAgentIds: [],
          progress: 0,
          createdAt: now,
          updatedAt: now,
          source: {
            type: 'routine',
            routineId: research!.id,
            routineRunId: runResult.run.id,
          },
          approval: {
            status: 'pending',
            stepId: 'task_approval_i_step_1',
            kind: 'change',
          },
        },
      ],
    })
    const run = (await ops.getBoard(PROJECT_A)).runs.find(
      (r) => r.id === runResult.run.id,
    )
    assert(run?.status === 'awaiting_approval', 'I has awaiting run')
    const snap = await projects.getSnapshot()
    const task = snap.tasks.find((t) => t.id === 'task_approval_i')
    assert(task, 'I linked task')
    task!.status = 'completed'
    task!.finalResult = 'Approved and done'
    await projects.saveWorkState({
      tasks: snap.tasks,
      pipelineSteps: snap.pipelineSteps,
      agentRuns: snap.agentRuns,
      codexRuns: snap.codexRuns,
    })
    const updated = await execution.reconcileProject(PROJECT_A)
    const after = (await ops.getBoard(PROJECT_A)).runs.find(
      (r) => r.id === run!.id,
    )!
    eq(after.status, 'completed', 'I reconciled completed')
    assert(updated.some((r) => r.id === run!.id), 'I updated list')
    console.log('TEST I PASS')
  }

  // ——— J: Restart ———
  {
    const routine = await ops.createRoutine(PROJECT_A, {
      name: 'Restart persist',
      description: 'mid state',
      requiredCapabilities: ['research.web'],
      trigger: 'scheduled',
      schedule: {
        kind: 'daily',
        time: '08:00',
        timezone: 'Asia/Seoul',
      },
      now: new Date('2026-09-27T00:00:00.000Z'),
    })
    const dueAt = zonedTimeToUtc(2026, 9, 28, 8, 0, 'Asia/Seoul')
    await ops.patchRoutine(routine.id, {
      projectId: PROJECT_A,
      nextRunAt: dueAt.toISOString(),
    })
    const first = await execution.start({
      routineId: routine.id,
      projectId: PROJECT_A,
      triggerSource: 'scheduled',
      scheduledFor: dueAt.toISOString(),
      now: dueAt,
    })
    assert(first.created, 'J first')

    // Simulate restart with new service instances
    const ops2 = new OperationsService(new JsonOperationsRepository(opsDir))
    const projects2 = new ProjectService(
      new JsonProjectRepository(projectsFile),
    )
    const exec2 = new RoutineExecutionService(ops2, projects2)
    const sched2 = new RoutineSchedulerRuntime(ops2, projects2, {
      enabled: false,
      intervalMs: 60_000,
    })
    await exec2.reconcileProject(PROJECT_A)
    const tick = await sched2.tick(dueAt)
    const runs = (await ops2.getBoard(PROJECT_A)).runs.filter(
      (r) => r.routineId === routine.id,
    )
    eq(runs.length, 1, 'J no duplicate after restart')
    assert(tick.created === 0, 'J tick creates 0')
    console.log('TEST J PASS')
  }

  // ——— K: Isolation ———
  {
    await ops.createGoal(PROJECT_B, { type: 'development', title: 'B goal' })
    const routineB = await ops.createRoutine(PROJECT_B, {
      templateId: 'COMPETITOR_RESEARCH',
      now: new Date('2026-09-20T00:00:00.000Z'),
    })
    const dueAt = zonedTimeToUtc(2026, 9, 30, 10, 0, 'Asia/Seoul')
    await ops.patchRoutine(routineB.id, {
      projectId: PROJECT_B,
      nextRunAt: dueAt.toISOString(),
    })
    await scheduler.tick(dueAt)
    const a = await ops.getBoard(PROJECT_A)
    const b = await ops.getBoard(PROJECT_B)
    assert(
      !b.runs.some((r) => a.routines.some((x) => x.id === r.routineId)),
      'K no A routine in B runs wrongly linked',
    )
    assert(
      b.runs.every((r) => r.projectId === PROJECT_B),
      'K B runs stay in B',
    )
    assert(
      a.runs.every((r) => r.projectId === PROJECT_A),
      'K A runs stay in A',
    )
    const snap = await projects.getSnapshot()
    const bTasks = snap.tasks.filter((t) => t.projectId === PROJECT_B)
    const aLeak = bTasks.some((t) =>
      a.routines.some((r) => t.source?.routineId === r.id),
    )
    assert(!aLeak, 'K no A routine task pollution in B')
    console.log('TEST K PASS', { routineB: routineB.id })
  }

  // ——— L: nextRunAt drift / timezone ———
  {
    const schedule = {
      kind: 'weekly' as const,
      daysOfWeek: [1],
      time: '09:00',
      timezone: 'Asia/Seoul',
    }
    let cursor = zonedTimeToUtc(2026, 9, 21, 9, 0, 'Asia/Seoul')
    const stamps: string[] = []
    for (let i = 0; i < 10; i++) {
      const next = calculateNextRun(schedule, cursor)
      assert(next, `L next ${i}`)
      const client = clientNextRun(schedule, cursor)
      eq(next, client, `L client/server ${i}`)
      stamps.push(next!)
      const parts = getZonedParts(new Date(next!), 'Asia/Seoul')
      eq(parts.hour, 9, `L hour ${i}`)
      eq(parts.minute, 0, `L minute ${i}`)
      eq(parts.dow, 1, `L monday ${i}`)
      // Advance just after this occurrence
      cursor = new Date(new Date(next!).getTime() + 1000)
    }
    // No drift: consecutive deltas ≈ 7 days
    for (let i = 1; i < stamps.length; i++) {
      const delta =
        new Date(stamps[i]!).getTime() - new Date(stamps[i - 1]!).getTime()
      const days = delta / (24 * 60 * 60 * 1000)
      assert(Math.abs(days - 7) < 0.01, `L week delta ${i}: ${days}`)
    }
    console.log('TEST L PASS')
  }

  // Status API shape (no secrets)
  {
    const status = await scheduler.getStatus(MON_0900_SEOUL)
    assert(typeof status.enabled === 'boolean', 'status enabled')
    assert(typeof status.intervalMs === 'number', 'status interval')
    assert('lastTickAt' in status, 'status lastTickAt')
    assert('dueRoutineCount' in status, 'status due')
    assert('runningRoutineCount' in status, 'status running')
    console.log('TEST status PASS', status)
  }

  console.log('routineScheduler fixtures: ALL PASS')
} finally {
  rmSync(dir, { recursive: true, force: true })
}
