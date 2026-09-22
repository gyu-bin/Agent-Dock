/**
 * Phase O1 — Usage / Cost / Execution Observability fixture tests.
 * No OpenAI / Web Search / Codex live calls.
 *
 *   AGENT_DECK_USAGE_DIR=.tmp/o1-usage node --import tsx tools/o1-usage-fixture.mts
 */
import { mkdir, rm, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { JsonUsageRepository } from '../server/src/persistence/usageRepository.ts'
import { UsageService } from '../server/src/persistence/usageService.ts'
import {
  fromAgentRun,
  fromCodexRun,
  fromWebSearchSession,
} from '../server/src/persistence/executionAdapter.ts'
import { estimateExecutionCost } from '../server/src/persistence/costModel.ts'
import { aggregateExecutions } from '../server/src/persistence/usageAggregation.ts'
import type {
  StoredAgentRun,
  StoredCodexRun,
  StoredWebSearchSession,
} from '../server/src/persistence/types.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIR = path.join(ROOT, '.tmp', `o1-usage-${Date.now().toString(36)}`)

type Result = { name: string; ok: boolean; detail?: string }
const results: Result[] = []

function record(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

function iso(offsetMs = 0) {
  return new Date(Date.now() + offsetMs).toISOString()
}

async function main() {
  await mkdir(DIR, { recursive: true })
  const repo = new JsonUsageRepository(DIR)
  const svc = new UsageService(repo)
  const projectA = 'proj_o1_a'
  const projectB = 'proj_o1_b'
  const taskHybrid = 'task_hybrid_1'
  const taskB = 'task_b_1'

  // TEST A — OpenAI fixture → token aggregation
  const openaiRun: StoredAgentRun = {
    id: 'ar_openai_1',
    taskId: taskHybrid,
    stepId: 'step_1',
    agentId: 'researcher',
    status: 'completed',
    inputSummary: 'fixture openai',
    output: 'ok',
    startedAt: iso(-60_000),
    completedAt: iso(-50_000),
    model: 'gpt-4o-mini',
    inputTokens: 1000,
    outputTokens: 500,
  }
  await svc.upsert(fromAgentRun(projectA, openaiRun))
  const aggA = await svc.aggregate({ projectId: projectA })
  record(
    'TEST A openai tokens',
    aggA.inputTokens === 1000 &&
      aggA.outputTokens === 500 &&
      aggA.totalTokens === 1500 &&
      aggA.openaiCalls === 1 &&
      aggA.estimatedCost != null &&
      !aggA.hasUnknownCost,
    `tokens=${aggA.totalTokens} cost=${aggA.estimatedCost}`,
  )

  // TEST B — Codex fixture → duration/error aggregation
  const codexRun: StoredCodexRun = {
    id: 'cr_1',
    taskId: taskHybrid,
    stepId: 'step_2',
    agentId: 'engineer',
    mode: 'implement',
    projectPath: '/tmp/demo',
    status: 'failed',
    startedAt: iso(-40_000),
    completedAt: iso(-30_000),
    durationMs: 10_000,
    errorCategory: 'UPSTREAM_ERROR',
    userMessageKo: '업스트림 오류',
    retries: 2,
    attempt: 3,
  }
  await svc.upsert(fromCodexRun(projectA, codexRun))
  const aggB = await svc.aggregate({ projectId: projectA })
  record(
    'TEST B codex duration/error',
    aggB.codexRuns === 1 &&
      aggB.failures === 1 &&
      aggB.retries === 2 &&
      aggB.averageDurationMs > 0,
    `codex=${aggB.codexRuns} fail=${aggB.failures} retries=${aggB.retries} avgMs=${aggB.averageDurationMs}`,
  )

  // TEST C — Web Search fixture → search count
  const search: StoredWebSearchSession = {
    id: 'ws_1',
    taskId: taskHybrid,
    stepId: 'step_0',
    agentId: 'researcher',
    queries: ['steam indie trends'],
    sources: [
      {
        id: 's1',
        title: 'Steam',
        url: 'https://store.steampowered.com',
        domain: 'store.steampowered.com',
      },
    ],
    searchedAt: iso(-70_000),
    status: 'ok',
  }
  await svc.upsert(fromWebSearchSession(projectA, search))
  const aggC = await svc.aggregate({ projectId: projectA })
  record(
    'TEST C web search count',
    aggC.webSearches === 1,
    `web=${aggC.webSearches}`,
  )

  // TEST D — Hybrid task sum OpenAI + Codex + Search
  const hybrid = await svc.taskSummary(projectA, taskHybrid)
  record(
    'TEST D hybrid task sum',
    hybrid.openaiCalls === 1 &&
      hybrid.codexRuns === 1 &&
      hybrid.webSearches === 1 &&
      hybrid.calls === 3,
    `calls=${hybrid.calls} oai=${hybrid.openaiCalls} codex=${hybrid.codexRuns} web=${hybrid.webSearches}`,
  )

  // TEST E — Project A/B isolation
  await svc.upsert(
    fromAgentRun(projectB, {
      ...openaiRun,
      id: 'ar_b_1',
      taskId: taskB,
      inputTokens: 50,
      outputTokens: 10,
    }),
  )
  const onlyA = await svc.aggregate({ projectId: projectA })
  const onlyB = await svc.aggregate({ projectId: projectB })
  record(
    'TEST E project isolation',
    onlyA.calls === 3 &&
      onlyB.calls === 1 &&
      onlyB.totalTokens === 60 &&
      onlyA.totalTokens === 1500,
    `A=${onlyA.calls}/${onlyA.totalTokens} B=${onlyB.calls}/${onlyB.totalTokens}`,
  )

  // TEST F — Unknown model price → cost Unknown (no guess)
  const unknownEst = estimateExecutionCost({
    provider: 'openai',
    model: 'totally-unknown-model-xyz',
    inputTokens: 100,
    outputTokens: 50,
  })
  const unknownRec = await svc.recordManual({
    projectId: projectA,
    taskId: taskHybrid,
    agentId: 'researcher',
    provider: 'openai',
    model: 'totally-unknown-model-xyz',
    operation: 'agent.step',
    status: 'completed',
    startedAt: iso(-5_000),
    completedAt: iso(),
    inputTokens: 100,
    outputTokens: 50,
    sourceId: 'unknown_model_1',
  })
  const aggF = await svc.aggregate({ projectId: projectA })
  record(
    'TEST F unknown model cost',
    unknownEst.kind === 'unknown' &&
      unknownRec.costUnknown === true &&
      unknownRec.estimatedCost === undefined &&
      aggF.hasUnknownCost === true &&
      aggF.estimatedCost === null,
    `est=${unknownEst.kind} recUnknown=${unknownRec.costUnknown} aggCost=${aggF.estimatedCost}`,
  )

  // TEST G — Error/Retry aggregation
  record(
    'TEST G error/retry aggregation',
    aggF.failures >= 1 && aggF.retries >= 2,
    `failures=${aggF.failures} retries=${aggF.retries}`,
  )

  // Direct aggregate sanity on filtered failed
  const failedOnly = aggregateExecutions(
    (await svc.list({ projectId: projectA, status: 'failed' })),
  )
  record(
    'TEST G failed filter',
    failedOnly.calls === 1 && failedOnly.failures === 1,
    `failedCalls=${failedOnly.calls}`,
  )

  // TEST H — Persistence reload
  const before = (await repo.load(projectA)).executions.length
  const raw = await readFile(path.join(DIR, `${projectA}.json`), 'utf8')
  const parsed = JSON.parse(raw) as { executions: unknown[] }
  const repo2 = new JsonUsageRepository(DIR)
  const svc2 = new UsageService(repo2)
  const after = (await svc2.list({ projectId: projectA })).length
  record(
    'TEST H persistence',
    before === after && parsed.executions.length === before && before >= 4,
    `fileItems=${parsed.executions.length} reloaded=${after}`,
  )

  // Budget structure (domain only — no blocking)
  const budget = await svc.setBudget(projectA, {
    maxCost: 10,
    maxTokens: 100_000,
    warningThreshold: 0.8,
  })
  const check = await svc.checkBudget(projectA)
  record(
    'TEST budget structure',
    budget.maxCost === 10 &&
      budget.maxTokens === 100_000 &&
      typeof check.warning === 'boolean',
    `maxCost=${budget.maxCost} warning=${check.warning}`,
  )

  console.log('\n========== O1 SUMMARY ==========')
  const pass = results.filter((r) => r.ok).length
  const fail = results.filter((r) => !r.ok).length
  console.log(`pass=${pass} fail=${fail} dir=${DIR}`)
  for (const r of results) {
    console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}`)
  }

  await rm(DIR, { recursive: true, force: true }).catch(() => undefined)
  if (fail > 0) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
