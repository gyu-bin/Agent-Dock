/**
 * Phase W1 E2E — Web Search + Sources + Research Artifacts
 *
 * Usage (server on :8787 with OPENAI_API_KEY):
 *   node --import tsx tools/w1-websearch-e2e.mts
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const API = process.env.AGENT_DECK_API ?? 'http://127.0.0.1:8787'

type Result = { name: string; ok: boolean; detail?: string }
const results: Result[] = []

function record(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

async function api<T>(
  method: string,
  urlPath: string,
  body?: unknown,
): Promise<{ status: number; json: T }> {
  const res = await fetch(`${API}${urlPath}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = (await res.json().catch(() => ({}))) as T
  return { status: res.status, json }
}

async function main() {
  const health = await api<{ ok?: boolean }>('GET', '/api/health')
  if (health.status !== 200) {
    console.error('Server not healthy')
    process.exit(1)
  }

  const status = await api<{ available: boolean; label: string }>(
    'GET',
    '/api/search/status',
  )
  record(
    'search status',
    status.status === 200 && status.json.available === true,
    status.json.label,
  )

  // TEST C — requiresWebSearch false for code review
  const c = await api<{ requiresWebSearch: boolean }>('POST', '/api/search/requires', {
    agentId: 'code-reviewer',
    userRequest: '현재 프로젝트 코드 리뷰해줘',
    stepLabel: '코드 리뷰',
  })
  record(
    'TEST C requires=false',
    c.json.requiresWebSearch === false,
    `requires=${c.json.requiresWebSearch}`,
  )

  // TEST A — real web search
  const taskA = `w1_steam_${Date.now().toString(36)}`
  console.log('\n--- TEST A: real Steam search ---')
  const searchA = await api<{
    skipped?: boolean
    session?: {
      queries: string[]
      sources: Array<{ id: string; url: string; title: string; domain: string }>
      searchedAt: string
    }
    sources?: Array<{ id: string; url: string }>
    plan?: { queries: string[] }
    error?: string
    code?: string
  }>('POST', '/api/search/execute', {
    taskId: taskA,
    userRequest: '2026년 최근 Steam 인디게임 트렌드를 조사해줘',
    stepTask: '트렌드 리서치',
    agentId: 'trend-researcher',
  })

  const sourcesA = searchA.json.sources ?? searchA.json.session?.sources ?? []
  const queriesA =
    searchA.json.plan?.queries ?? searchA.json.session?.queries ?? []
  const realSearchOk =
    searchA.status === 200 &&
    sourcesA.length > 0 &&
    sourcesA.every((s) => /^https?:\/\//i.test(s.url))

  record(
    'TEST A real search',
    realSearchOk,
    realSearchOk
      ? `queries=${queriesA.length} sources=${sourcesA.length}`
      : searchA.json.error ?? `http=${searchA.status} sources=${sourcesA.length}`,
  )

  let tokensIn = 0
  let tokensOut = 0

  if (realSearchOk) {
    // Agent analysis with sources → artifact (may fail if chat quota exhausted)
    const snap = await api<{
      projects: Array<{ id: string; name: string }>
      activeProjectId: string | null
    }>('GET', '/api/projects')
    let projectId = snap.json.activeProjectId ?? snap.json.projects[0]?.id
    if (!projectId) {
      const created = await api<{ project: { id: string } }>('POST', '/api/projects', {
        name: 'W1 E2E',
        type: 'steam-game',
      })
      projectId = created.json.project.id
    }

    const step = await api<{
      output: string
      usage?: { inputTokens?: number; outputTokens?: number }
      webSearch?: { skipped: boolean; sources: unknown[] }
      error?: string
      code?: string
    }>('POST', '/api/ai/run-step', {
      agentId: 'trend-researcher',
      stepTask: '트렌드 리서치',
      userRequest: '2026년 최근 Steam 인디게임 트렌드를 조사해줘',
      projectId,
      taskId: taskA,
      stepId: 'step_research',
      requiresWebSearch: true,
      role: 'researcher',
    })

    tokensIn += step.json.usage?.inputTokens ?? 0
    tokensOut += step.json.usage?.outputTokens ?? 0

    let researchContent = step.json.output
    if (step.status === 200 && researchContent) {
      const hasCitation =
        /\[\d+\]/.test(researchContent) || /Sources|출처/i.test(researchContent)
      const sourcesOnly = /sources-only|출처만으로/i.test(
        step.json.usage?.model === 'sources-only-fallback'
          ? 'sources-only'
          : researchContent,
      )
      record(
        'TEST A agent+citation',
        hasCitation,
        `citation=${hasCitation} sourcesOnly=${sourcesOnly || step.json.usage?.model === 'sources-only-fallback'} skipped=${step.json.webSearch?.skipped} outChars=${researchContent.length}`,
      )
    } else {
      // Chat quota may be exhausted — still produce research artifact from real sources
      researchContent = [
        '## 요약',
        'OpenAI chat quota로 Agent 분석 호출이 실패하여, 실제 웹 검색 출처만 Artifact에 보존합니다.',
        '',
        '## 핵심 발견',
        sourcesA
          .slice(0, 5)
          .map((s, i) => `- 출처 [${i + 1}] ${(s as { title?: string }).title ?? s.url}`)
          .join('\n'),
        '',
        '## 근거',
        '아래 Sources는 WebSearchProvider가 반환한 URL만 포함합니다.',
        '',
        '## 불확실한 부분',
        'Agent LLM 분석이 없어 해석은 보류합니다.',
        '',
        '## Sources',
        ...sourcesA.map(
          (s, i) =>
            `[${i + 1}] ${(s as { title?: string }).title ?? s.url} — ${s.url}`,
        ),
      ].join('\n')
      record(
        'TEST A agent+citation',
        false,
        `chat failed — ${step.json.error ?? step.status}; artifact uses real sources only`,
      )
    }

    const art = await api<{ artifact: { id: string; sources?: unknown[]; searchedAt?: string } }>(
      'POST',
      `/api/projects/${projectId}/artifacts`,
      {
        type: 'research',
        title: 'Steam 인디 트렌드 리서치',
        summary: researchContent.slice(0, 200),
        content: researchContent,
        contentType: 'markdown',
        taskId: taskA,
        agentId: 'trend-researcher',
        sources: searchA.json.session?.sources ?? sourcesA,
        searchedAt: searchA.json.session?.searchedAt,
      },
    )
    record(
      'TEST A artifact sources',
      art.status === 201 && (art.json.artifact.sources?.length ?? 0) > 0,
      `sources=${art.json.artifact.sources?.length ?? 0}`,
    )

    const detail = await api<{ artifact: { sources?: unknown[] } }>(
      'GET',
      `/api/projects/${projectId}/artifacts/${art.json.artifact.id}`,
    )
    record(
      'TEST E persistence',
      (detail.json.artifact.sources?.length ?? 0) > 0,
      `sources=${detail.json.artifact.sources?.length ?? 0}`,
    )

    const hist = await api<{ queryCount: number; sourceCount: number }>(
      'GET',
      `/api/search/history/${taskA}`,
    )
    record(
      'TEST A history',
      hist.json.queryCount > 0 && hist.json.sourceCount > 0,
      `q=${hist.json.queryCount} s=${hist.json.sourceCount}`,
    )

    const again = await api<{ session?: { sources: unknown[] } }>(
      'POST',
      '/api/search/execute',
      {
        taskId: taskA,
        userRequest: '2026년 최근 Steam 인디게임 트렌드를 조사해줘',
        stepTask: '트렌드 리서치',
        agentId: 'trend-researcher',
      },
    )
    record(
      'TEST A cache reuse path',
      again.status === 200,
      `http=${again.status}`,
    )
  }

  // TEST B — GAME_IDEA skip second search when research exists
  // (unit-level via requires endpoint with skipBecausePriorResearch)
  const b = await api<{ requiresWebSearch: boolean }>('POST', '/api/search/requires', {
    agentId: 'game-designer',
    role: 'game-designer',
    userRequest: '최근 Steam 시장을 조사해서 게임 아이디어를 제안해줘',
    stepLabel: '게임 디자인',
    skipBecausePriorResearch: true,
  })
  record(
    'TEST B no duplicate search',
    b.json.requiresWebSearch === false,
    `requires=${b.json.requiresWebSearch}`,
  )

  // TEST D — failure fixture
  console.log('\n--- TEST D: force fail ---')
  const fail = await api<{ error?: string; code?: string }>(
    'POST',
    '/api/search/execute',
    { userRequest: 'anything', taskId: 'fail_test', forceFail: true },
  )
  record(
    'TEST D failure',
    fail.status >= 400 &&
      (fail.json.code === 'WEB_SEARCH_FAILED' ||
        /웹 검색 실패/.test(fail.json.error ?? '')),
    fail.json.error ?? fail.json.code,
  )

  const noSearchReq = await api<{ requiresWebSearch: boolean }>(
    'POST',
    '/api/search/requires',
    {
      agentId: 'code-reviewer',
      userRequest: '현재 프로젝트 코드 리뷰해줘',
      requiresWebSearch: false,
    },
  )
  record(
    'TEST D no-fake-search',
    noSearchReq.json.requiresWebSearch === false,
    `requires=${noSearchReq.json.requiresWebSearch}`,
  )

  const outDir = path.join(ROOT, '.tmp')
  await mkdir(outDir, { recursive: true })
  await writeFile(
    path.join(outDir, 'w1-e2e-summary.json'),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        results,
        tokens: { input: tokensIn, output: tokensOut },
        testA: {
          queries: queriesA.length,
          sources: sourcesA.length,
          sampleUrls: sourcesA.slice(0, 3).map((s) => s.url),
        },
      },
      null,
      2,
    ),
  )

  const pass = results.filter((r) => r.ok).length
  const failCount = results.filter((r) => !r.ok).length
  console.log('\n========== W1 SUMMARY ==========')
  console.log(`pass=${pass} fail=${failCount}`)
  console.log(`tokens in=${tokensIn} out=${tokensOut}`)
  for (const r of results) {
    console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}${r.detail ? ` — ${r.detail}` : ''}`)
  }
  process.exit(failCount > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
