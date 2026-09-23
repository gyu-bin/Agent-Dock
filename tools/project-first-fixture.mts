/**
 * Project-first Consolidation fixtures A–N.
 * Run: node --import tsx tools/project-first-fixture.mts
 * No live providers. Canonical planner + store only.
 */
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  planTask,
  planFingerprint,
  materializeTaskFromPlan,
} from '../client/src/domain/taskPlanning/index.ts'
import { resolveProjectToolPolicy } from '../client/src/domain/projectToolPolicy.ts'
import { MOCK_REGISTRY } from '../client/src/data/mockRegistry.ts'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg)
}

function eq<T>(a: T, b: T, msg: string) {
  assert(a === b, `${msg}: expected ${String(b)}, got ${String(a)}`)
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const results: Record<string, 'PASS' | 'FAIL'> = {}

function pass(id: string) {
  results[id] = 'PASS'
  console.log(`${id} PASS`)
}

function fail(id: string, err: unknown) {
  results[id] = 'FAIL'
  console.error(`${id} FAIL`, err)
}

try {
  // A — Project Control Center surface exists (ProjectsPage title string)
  {
    const src = readFileSync(
      path.join(root, 'client/src/pages/ProjectsPage.tsx'),
      'utf8',
    )
    assert(src.includes('Project Control Center'), 'A PCC title')
    assert(src.includes('AiChatPanel'), 'A composer embedded')
    assert(src.includes("['work', '작업 요청']") || src.includes("'work'"), 'A work tab')
    pass('A')
  }

  // B — Home vs Project nav (Sidebar no longer primary tasks/documents)
  {
    const side = readFileSync(
      path.join(root, 'client/src/layout/Sidebar.tsx'),
      'utf8',
    )
    assert(side.includes("id: 'home'"), 'B home')
    assert(side.includes("id: 'projects'"), 'B projects')
    assert(!side.includes("id: 'tasks'"), 'B tasks demoted')
    assert(!side.includes("id: 'documents'"), 'B documents demoted')
    assert(side.includes("id: 'approvals'"), 'B approvals kept')
    pass('B')
  }

  // C — Project Header fields in source
  {
    const src = readFileSync(
      path.join(root, 'client/src/pages/ProjectsPage.tsx'),
      'utf8',
    )
    assert(src.includes('Path:'), 'C path')
    assert(src.includes('GitHub:'), 'C github')
    assert(src.includes('selected.status'), 'C stage/status')
    pass('C')
  }

  // D — Work Composer attachment kinds still in AiChatPanel
  {
    const src = readFileSync(
      path.join(root, 'client/src/panels/AiChatPanel.tsx'),
      'utf8',
    )
    assert(src.includes('stageAttachmentFile'), 'D file/image')
    assert(src.includes('stageAttachmentFolder'), 'D folder')
    assert(src.includes('stageAttachmentUrl'), 'D url/github')
    assert(src.includes('embedded'), 'D embedded prop')
    assert(src.includes('planFingerprint'), 'D fingerprint on start')
    pass('D')
  }

  // E — Preview SoT = planTask fingerprint matches materialize path
  {
    const team = MOCK_REGISTRY.slice(0, 8)
    const project = {
      id: 'proj_pf_a',
      type: 'mobile-app' as const,
      name: 'Fixture App',
    }
    const request = '이 프로젝트 전체 구조 점검해줘.'
    const previewPlan = planTask({
      project,
      request,
      source: { type: 'user' },
      team,
      registry: MOCK_REGISTRY,
      executionMode: 'MOCK',
    })
    const commitPlan = planTask({
      project,
      request,
      source: { type: 'user' },
      preferredTemplateId: previewPlan.workflowTemplateId,
      team,
      registry: MOCK_REGISTRY,
      executionMode: 'MOCK',
    })
    eq(
      planFingerprint(previewPlan),
      planFingerprint(commitPlan),
      'E fingerprint match',
    )
    const { task, steps } = materializeTaskFromPlan({
      plan: commitPlan,
      taskId: 'task_pf_1',
      projectId: project.id,
      title: request,
      description: request,
      now: new Date().toISOString(),
      priority: 'normal',
      executionMode: 'MOCK',
    })
    assert(task.id === 'task_pf_1', 'E task')
    assert(steps.length === commitPlan.steps.length, 'E steps')
    pass('E')
  }

  // F — Tool policy precedence
  {
    const r = resolveProjectToolPolicy({
      global: {
        openai: true,
        codex: true,
        webSearch: false,
        image: true,
        buffer: false,
      },
      project: {
        buffer: 'enabled',
        image: 'disabled',
      },
      taskRequires: { webSearch: true },
    })
    eq(r.openai.effective, 'enabled', 'F openai')
    eq(r.image.effective, 'disabled', 'F image override')
    eq(r.buffer.effective, 'enabled', 'F buffer override')
    eq(r.buffer.source, 'project', 'F buffer source')
    eq(r.webSearch.effective, 'disabled', 'F webSearch still unavailable')
    eq(r.webSearch.source, 'task', 'F task req source')
    pass('F')
  }

  // G — ProjectContext toolPolicy + githubUrl types
  {
    const types = readFileSync(
      path.join(root, 'client/src/domain/types.ts'),
      'utf8',
    )
    assert(types.includes('githubUrl?:'), 'G githubUrl')
    assert(types.includes('ProjectToolPolicy'), 'G toolPolicy type')
    assert(types.includes('planFingerprint?:'), 'G workProposal fingerprint')
    pass('G')
  }

  // H — Marketing / Buffer / Distribution still wired in PCC
  {
    const src = readFileSync(
      path.join(root, 'client/src/pages/ProjectsPage.tsx'),
      'utf8',
    )
    assert(src.includes('publishToBuffer'), 'H buffer')
    assert(src.includes('Marketing Package'), 'H package')
    assert(src.includes('distributionProvider'), 'H dist')
    pass('H')
  }

  // I — Goals create/pause/complete UI + API client
  {
    const src = readFileSync(
      path.join(root, 'client/src/pages/ProjectsPage.tsx'),
      'utf8',
    )
    const api = readFileSync(
      path.join(root, 'client/src/api/client.ts'),
      'utf8',
    )
    assert(src.includes('createProjectGoal'), 'I create')
    assert(src.includes('patchProjectGoal'), 'I patch')
    assert(api.includes('export async function patchProjectGoal'), 'I api')
    pass('I')
  }

  // J — Tools tab runtime availability
  {
    const src = readFileSync(
      path.join(root, 'client/src/pages/ProjectsPage.tsx'),
      'utf8',
    )
    assert(src.includes("['tools', '도구']") || src.includes("'tools'"), 'J tab')
    assert(src.includes('resolveProjectToolPolicy'), 'J resolve')
    assert(src.includes('fetchBufferStatus'), 'J buffer status')
    pass('J')
  }

  // K — product-status + README
  {
    assert(
      existsSync(path.join(root, 'docs/product-status.md')),
      'K product-status',
    )
    const readme = readFileSync(path.join(root, 'README.md'), 'utf8')
    assert(readme.includes('Project Control Center'), 'K README PCC')
    pass('K')
  }

  // L — proposeWorkFromChat uses planTask (store)
  {
    const store = readFileSync(
      path.join(root, 'client/src/store/useDeckStore.ts'),
      'utf8',
    )
    assert(store.includes('proposeWorkFromChat:'), 'L fn')
    const idx = store.indexOf('proposeWorkFromChat: (text, opts)')
    assert(idx >= 0, 'L propose impl')
    const chunk = store.slice(idx, idx + 2500)
    assert(chunk.includes('planTask({'), 'L planTask in propose')
    assert(chunk.includes('planFingerprint'), 'L fingerprint stored')
    assert(!/selectWorkflowTemplate\s*\(/.test(chunk), 'L no direct selector')
    pass('L')
  }

  // M — taskRouter not imported by client runtime (compat only)
  {
    const store = readFileSync(
      path.join(root, 'client/src/store/useDeckStore.ts'),
      'utf8',
    )
    assert(!store.includes("from '../domain/taskRouter'"), 'M no store router')
    const panel = readFileSync(
      path.join(root, 'client/src/panels/AiChatPanel.tsx'),
      'utf8',
    )
    assert(!panel.includes('taskRouter'), 'M no panel router')
    pass('M')
  }

  // N — Empty / unavailable messaging present
  {
    const src = readFileSync(
      path.join(root, 'client/src/pages/ProjectsPage.tsx'),
      'utf8',
    )
    assert(src.includes('Buffer unavailable'), 'N buffer msg')
    assert(src.includes('Image unavailable'), 'N image msg')
    assert(src.includes('Provider unavailable'), 'N provider msg')
    assert(src.includes('아직 프로젝트가 없습니다'), 'N empty project')
    pass('N')
  }

  const failed = Object.entries(results).filter(([, v]) => v === 'FAIL')
  console.log('\nproject-first fixtures:', results)
  if (failed.length) {
    process.exitCode = 1
  } else {
    console.log('ALL PASS A–N')
  }
} catch (err) {
  console.error('FATAL', err)
  process.exitCode = 1
}
