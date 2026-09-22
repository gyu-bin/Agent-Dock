/**
 * Codex 502 Hardening — disposable-repo stress (INSPECT×N, IMPLEMENT, REVIEW, VERIFY).
 *
 * Usage (server on :8787, Codex available):
 *   node --import tsx tools/codex-502-stress.mts
 */
import { mkdir, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const API = process.env.AGENT_DECK_API ?? 'http://127.0.0.1:8787'
const TIMEOUT = Number(process.env.CODEX_STRESS_TIMEOUT_MS ?? 240_000)
const INSPECT_N = Number(process.env.CODEX_STRESS_INSPECT_N ?? 5)

type RunBody = {
  run?: {
    id: string
    mode: string
    status: string
    startedAt?: string
    completedAt?: string
    durationMs?: number
    exitCode?: number | null
    timedOut?: boolean
    cancelled?: boolean
    errorCategory?: string
    stderrSummary?: string
    attempt?: number
    retries?: number
    error?: string
    userMessageKo?: string
    changedFiles?: string[]
  }
  output?: string
  error?: string
  code?: string
  userMessageKo?: string
}

type Outcome = {
  name: string
  ok: boolean
  status: number
  category?: string
  durationMs?: number
  retries?: number
  detail?: string
}

const outcomes: Outcome[] = []

function log(o: Outcome) {
  outcomes.push(o)
  console.log(
    `${o.ok ? 'PASS' : 'FAIL'}  ${o.name}  http=${o.status}` +
      (o.category ? ` cat=${o.category}` : '') +
      (o.durationMs != null ? ` ${o.durationMs}ms` : '') +
      (o.retries ? ` retries=${o.retries}` : '') +
      (o.detail ? ` — ${o.detail}` : ''),
  )
}

async function api(
  method: string,
  urlPath: string,
  body?: unknown,
): Promise<{ status: number; json: RunBody }> {
  const res = await fetch(`${API}${urlPath}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = (await res.json().catch(() => ({}))) as RunBody
  return { status: res.status, json }
}

async function runCodex(input: {
  runId: string
  mode: 'inspect' | 'implement' | 'review' | 'verify'
  projectPath: string
  userRequest: string
  stepTask: string
  previousResult?: string
  agentId?: string
}): Promise<{ status: number; json: RunBody }> {
  return api('POST', '/api/codex/run', {
    runId: input.runId,
    taskId: 'stress_task',
    stepId: `step_${input.mode}`,
    agentId: input.agentId ?? 'fullstack-developer',
    mode: input.mode,
    projectPath: input.projectPath,
    userRequest: input.userRequest,
    stepTask: input.stepTask,
    previousResult: input.previousResult,
    timeoutMs: TIMEOUT,
  })
}

function assertDiagnostics(run: RunBody['run'], label: string): string[] {
  const missing: string[] = []
  if (!run) {
    missing.push('run missing')
    return missing
  }
  if (!run.id) missing.push('runId')
  if (!run.mode) missing.push('mode')
  if (!run.startedAt) missing.push('startedAt')
  if (run.durationMs == null && run.status !== 'running') missing.push('durationMs')
  // exitCode may be null on spawn failure — still recorded
  if (!('exitCode' in run) && run.status !== 'completed') {
    // completed success always has exitCode 0 now
  }
  if (run.status === 'failed' || run.status === 'cancelled') {
    if (!run.errorCategory) missing.push('errorCategory')
  }
  if (missing.length) {
    console.warn(`[diag] ${label} missing: ${missing.join(', ')}`, {
      id: run.id,
      mode: run.mode,
      status: run.status,
      durationMs: run.durationMs,
      exitCode: run.exitCode,
      timedOut: run.timedOut,
      cancelled: run.cancelled,
      errorCategory: run.errorCategory,
      stderrSummary: run.stderrSummary?.slice(0, 80),
    })
  }
  return missing
}

async function main() {
  const health = await api('GET', '/api/health')
  if (health.status !== 200) {
    console.error('Server not healthy on', API)
    process.exit(1)
  }
  const codexStatus = await api('GET', '/api/codex/status')
  const available = (codexStatus.json as { available?: boolean }).available
  if (!available) {
    console.error('Codex unavailable — abort stress')
    process.exit(1)
  }

  const work = path.join(ROOT, '.tmp', `codex-502-stress-${Date.now().toString(36)}`)
  await mkdir(work, { recursive: true })
  await writeFile(
    path.join(work, 'package.json'),
    JSON.stringify(
      {
        name: 'codex-502-stress',
        private: true,
        type: 'module',
        scripts: {
          typecheck: 'node ./typecheck.mjs',
          lint: 'node -e "process.exit(0)"',
          test: 'node -e "process.exit(0)"',
          build: 'node -e "process.exit(0)"',
        },
      },
      null,
      2,
    ),
  )
  await writeFile(
    path.join(work, 'typecheck.mjs'),
    `import { readFileSync } from 'node:fs'
const raw = readFileSync(new URL('./hello.js', import.meta.url), 'utf8')
if (!raw.includes('hello')) {
  console.error('typecheck: hello.js missing greeting')
  process.exit(1)
}
console.log('typecheck ok')
`,
  )
  await writeFile(
    path.join(work, 'hello.js'),
    `export function greet(name) {\n  return 'hi ' + name\n}\n`,
  )
  await writeFile(
    path.join(work, 'README.md'),
    '# disposable stress fixture\n',
  )

  console.log(`\nWorkdir: ${work}`)
  console.log(`INSPECT × ${INSPECT_N}\n`)

  // --- INSPECT repeats ---
  for (let i = 1; i <= INSPECT_N; i++) {
    const { status, json } = await runCodex({
      runId: `stress_inspect_${i}`,
      mode: 'inspect',
      projectPath: work,
      userRequest: 'Summarize this tiny repo structure and files.',
      stepTask: 'INSPECT: list files and stack briefly in Korean.',
      agentId: 'code-reviewer',
    })
    const run = json.run
    assertDiagnostics(run, `inspect_${i}`)
    const ok = status === 200 && run?.status === 'completed'
    log({
      name: `INSPECT#${i}`,
      ok,
      status,
      category: run?.errorCategory,
      durationMs: run?.durationMs,
      retries: run?.retries,
      detail: ok
        ? undefined
        : json.userMessageKo || json.error || run?.error,
    })
  }

  // --- IMPLEMENT ---
  const impl = await runCodex({
    runId: `stress_implement_1`,
    mode: 'implement',
    projectPath: work,
    userRequest:
      'Change greet() in hello.js so it returns "hello " + name (exactly). Do not touch other files.',
    stepTask: 'IMPLEMENT: update hello.js greet to use hello prefix.',
    agentId: 'fullstack-developer',
  })
  assertDiagnostics(impl.json.run, 'implement')
  const implOk =
    impl.status === 200 && impl.json.run?.status === 'completed'
  log({
    name: 'IMPLEMENT',
    ok: implOk,
    status: impl.status,
    category: impl.json.run?.errorCategory,
    durationMs: impl.json.run?.durationMs,
    retries: impl.json.run?.retries,
    detail: implOk
      ? `changed=${(impl.json.run?.changedFiles ?? []).join(',')}`
      : impl.json.userMessageKo || impl.json.error,
  })

  // --- REVIEW ---
  const review = await runCodex({
    runId: `stress_review_1`,
    mode: 'review',
    projectPath: work,
    userRequest: 'Review the recent hello.js change for correctness.',
    stepTask: 'REVIEW: check greet() change.',
    previousResult: impl.json.output?.slice(0, 2000),
    agentId: 'code-reviewer',
  })
  assertDiagnostics(review.json.run, 'review')
  const reviewOk =
    review.status === 200 && review.json.run?.status === 'completed'
  log({
    name: 'REVIEW',
    ok: reviewOk,
    status: review.status,
    category: review.json.run?.errorCategory,
    durationMs: review.json.run?.durationMs,
    retries: review.json.run?.retries,
    detail: reviewOk
      ? undefined
      : review.json.userMessageKo || review.json.error,
  })

  // --- VERIFY ---
  const verify = await runCodex({
    runId: `stress_verify_1`,
    mode: 'verify',
    projectPath: work,
    userRequest: 'Run allowlisted verification.',
    stepTask: 'VERIFY: typecheck/lint/test/build',
    agentId: 'qa-engineer',
  })
  assertDiagnostics(verify.json.run, 'verify')
  const verifyOk =
    verify.status === 200 && verify.json.run?.status === 'completed'
  log({
    name: 'VERIFY',
    ok: verifyOk,
    status: verify.status,
    category: verify.json.run?.errorCategory,
    durationMs: verify.json.run?.durationMs,
    detail: verifyOk
      ? undefined
      : verify.json.userMessageKo || verify.json.error,
  })

  // --- invalid path classification ---
  const bad = await runCodex({
    runId: `stress_badpath`,
    mode: 'inspect',
    projectPath: '/nonexistent/agent-deck-path-xyz',
    userRequest: 'x',
    stepTask: 'should fail INVALID_PATH',
  })
  const badCat = bad.json.run?.errorCategory || bad.json.code
  log({
    name: 'INVALID_PATH',
    ok: bad.status === 400 && badCat === 'INVALID_PATH',
    status: bad.status,
    category: String(badCat),
    detail: bad.json.userMessageKo || bad.json.error,
  })

  const pass = outcomes.filter((o) => o.ok).length
  const fail = outcomes.filter((o) => !o.ok).length
  console.log('\n========== SUMMARY ==========')
  console.log(`total=${outcomes.length} pass=${pass} fail=${fail}`)
  for (const o of outcomes) {
    console.log(
      `  ${o.ok ? '✓' : '✗'} ${o.name}${o.category ? ` [${o.category}]` : ''}`,
    )
  }

  // Keep workdir for inspection; uncomment to clean:
  // await rm(work, { recursive: true, force: true })
  void rm

  process.exit(fail > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
