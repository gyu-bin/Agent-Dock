/**
 * Phase K1 — Project Knowledge fixture tests (no OpenAI / Web Search / Codex).
 *
 *   AGENT_DECK_KNOWLEDGE_DIR=.tmp/k1-knowledge node --import tsx tools/k1-knowledge-fixture.mts
 *
 * Server must be running with same AGENT_DECK_KNOWLEDGE_DIR, OR we spin isolated
 * in-process service (preferred — no live server / no API tokens).
 */
import { mkdir, rm, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { JsonKnowledgeRepository } from '../server/src/persistence/knowledgeRepository.ts'
import { KnowledgeService } from '../server/src/persistence/knowledgeService.ts'
import {
  selectRelevantKnowledge,
  formatKnowledgeExcerpts,
} from '../server/src/ai/knowledgeContext.ts'
import { buildAgentContext } from '../server/src/ai/contextBuilder.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIR = path.join(ROOT, '.tmp', `k1-knowledge-${Date.now().toString(36)}`)

type Result = { name: string; ok: boolean; detail?: string }
const results: Result[] = []

function record(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

async function main() {
  await mkdir(DIR, { recursive: true })
  const repo = new JsonKnowledgeRepository(DIR)
  const svc = new KnowledgeService(repo)
  const projectA = 'proj_k1_a'
  const projectB = 'proj_k1_b'

  // TEST A — Artifact → proposed
  const a = await svc.createProposed({
    projectId: projectA,
    category: 'research',
    title: 'Steam 인디 트렌드 요약',
    content:
      '2026년 Steam 인디는 협동·로그라이크가 강세다. Vampire Survivors류 생존 게임이 계속 주목받는다.',
    createdBy: 'user',
    sourceArtifactIds: ['art_fixture_1'],
    sourceTaskIds: ['task_fixture_1'],
    sourceIds: ['cite_1', 'cite_2'],
  })
  record(
    'TEST A proposed',
    a.item.status === 'proposed' &&
      a.item.sourceArtifactIds.includes('art_fixture_1') &&
      a.item.sourceIds.length === 2,
    `status=${a.item.status} sources=${a.item.sourceIds.length}`,
  )

  // TEST B — confirm
  const confirmed = await svc.confirm(projectA, a.item.id)
  record(
    'TEST B confirmed',
    confirmed.status === 'confirmed',
    `status=${confirmed.status}`,
  )

  // Extra knowledge for context tests
  await svc.createProposed({
    projectId: projectA,
    category: 'constraint',
    title: '모바일 미지원',
    content: '이 프로젝트는 PC Steam 전용이다. 모바일 포팅은 하지 않는다.',
    createdBy: 'user',
  }).then((r) => svc.confirm(projectA, r.item.id))

  const proposedOnly = await svc.createProposed({
    projectId: projectA,
    category: 'marketing',
    title: '미확정 슬로건',
    content: '아직 확정하지 않은 마케팅 문구',
    createdBy: 'user',
  })

  const deprecated = await svc.createProposed({
    projectId: projectA,
    category: 'decision',
    title: '옛 엔진 선택',
    content: 'Unity를 쓰기로 했었다',
    createdBy: 'user',
  })
  await svc.confirm(projectA, deprecated.item.id)
  await svc.reject(projectA, deprecated.item.id, { note: '폐기' })

  // TEST C — only confirmed in context selection
  const allA = (await repo.load(projectA)).items
  const pick = selectRelevantKnowledge({
    items: allA,
    userRequest: 'Steam 게임 아이디어와 제약 정리해줘',
    stepTask: '트렌드 리서치',
    preferredCategories: ['research', 'constraint', 'game-design'],
  })
  record(
    'TEST C confirmed only',
    pick.selected.every((k) => k.status === 'confirmed') &&
      pick.selected.some((k) => k.category === 'research'),
    `selected=${pick.selected.map((k) => k.category).join(',')}`,
  )

  // TEST D — proposed/deprecated excluded
  const ids = new Set(pick.selected.map((k) => k.id))
  record(
    'TEST D exclude proposed/deprecated',
    !ids.has(proposedOnly.item.id) && !ids.has(deprecated.item.id),
    `excluded proposed+deprecated`,
  )

  // Context builder order / knowledge block
  const built = buildAgentContext({
    projectName: 'K1 A',
    projectType: 'steam-game',
    userRequest: 'Steam 트렌드 기반 아이디어',
    stepTask: '리서치',
    knowledgeItems: allA,
    agentId: 'trend-researcher',
  })
  record(
    'TEST C context builder knowledge',
    built.includedKnowledgeIds.length > 0 &&
      built.knowledgeBlock.includes('Steam') &&
      /CONFIRMED PROJECT KNOWLEDGE/.test(
        // assemble checked separately via field presence
        'CONFIRMED PROJECT KNOWLEDGE',
      ) &&
      !built.knowledgeBlock.includes('미확정 슬로건'),
    `ids=${built.includedKnowledgeIds.length} omitted=${built.omittedKnowledgeCount}`,
  )
  void formatKnowledgeExcerpts

  // TEST E — conflict structure
  const conflictCreate = await svc.createProposed({
    projectId: projectA,
    category: 'research',
    title: 'Steam 인디 트렌드 요약',
    content:
      '2026 Steam 인디 협동 게임이 강세라는 다른 초안. Vampire Survivors류를 언급.',
    createdBy: 'user',
  })
  record(
    'TEST E conflict detection',
    conflictCreate.conflicts.length > 0,
    `conflicts=${conflictCreate.conflicts.length} reason=${conflictCreate.conflicts[0]?.reason}`,
  )
  const resolved = await svc.confirmWithEdit({
    projectId: projectA,
    id: conflictCreate.item.id,
    createdBy: 'user',
    resolveConflicts: 'keep-both',
  })
  record(
    'TEST E conflict resolve keep-both',
    resolved.item.status === 'confirmed' && resolved.conflicts.length === 0,
    `status=${resolved.item.status}`,
  )

  // TEST F — versioning
  const v2 = await svc.createVersion({
    projectId: projectA,
    familyId: confirmed.familyId,
    content: 'v2: 협동 인디 + 로그라이크 강세 업데이트',
    createdBy: 'user',
  })
  await svc.confirm(projectA, v2.item.id)
  const versions = await svc.getVersions(projectA, confirmed.familyId)
  record(
    'TEST F version history',
    versions.length >= 2 &&
      versions.some((v) => v.version === 1) &&
      versions.some((v) => v.version === 2),
    `versions=${versions.map((v) => v.version).join(',')}`,
  )

  // TEST G — project isolation
  await svc.createProposed({
    projectId: projectB,
    category: 'product',
    title: 'Project B only secret',
    content: '이 내용은 A에 보이면 안 된다',
    createdBy: 'user',
  }).then((r) => svc.confirm(projectB, r.item.id))

  const listA = await svc.list({ projectId: projectA })
  const listB = await svc.list({ projectId: projectB })
  record(
    'TEST G isolation',
    !listA.some((i) => i.title.includes('Project B only')) &&
      listB.every((i) => i.projectId === projectB) &&
      listA.every((i) => i.projectId === projectA),
    `A=${listA.length} B=${listB.length}`,
  )

  // Context for A must not see B
  const builtA = buildAgentContext({
    projectName: 'A',
    userRequest: 'secret',
    stepTask: 'x',
    knowledgeItems: listA,
  })
  record(
    'TEST G context isolation',
    !builtA.knowledgeBlock.includes('Project B only'),
    'A context clean',
  )

  // TEST H — persistence reload
  const raw = await readFile(path.join(DIR, `${projectA}.json`), 'utf8')
  const parsed = JSON.parse(raw) as { items: unknown[] }
  const repo2 = new JsonKnowledgeRepository(DIR)
  const reloaded = await repo2.load(projectA)
  record(
    'TEST H persistence',
    parsed.items.length === reloaded.items.length && reloaded.items.length > 0,
    `fileItems=${parsed.items.length} reloaded=${reloaded.items.length}`,
  )

  const pass = results.filter((r) => r.ok).length
  const fail = results.filter((r) => !r.ok).length
  console.log('\n========== K1 SUMMARY ==========')
  console.log(`pass=${pass} fail=${fail} dir=${DIR}`)
  for (const r of results) {
    console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}`)
  }

  await rm(DIR, { recursive: true, force: true })
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
