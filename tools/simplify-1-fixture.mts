/**
 * Phase Simplify-1 — MVP UX surface fixtures (no live providers).
 *
 *   node --import tsx tools/simplify-1-fixture.mts
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { selectWorkflowTemplate } from '../client/src/domain/templateSelector.ts'
import { previewLabels, resolveTemplateToSteps } from '../client/src/domain/templateSelector.ts'
import {
  approvalKindLabel,
  userFacingErrorMessage,
  userFacingTaskStatus,
} from '../client/src/domain/taskDisplay.ts'
import type { Task } from '../client/src/domain/types.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

type Result = { name: string; ok: boolean; detail?: string }
const results: Result[] = []

function record(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

async function fileContains(rel: string, needles: string[]): Promise<boolean> {
  const raw = await readFile(path.join(ROOT, rel), 'utf8')
  return needles.every((n) => raw.includes(n))
}

async function fileLacks(rel: string, needles: string[]): Promise<boolean> {
  const raw = await readFile(path.join(ROOT, rel), 'utf8')
  return needles.every((n) => !raw.includes(n))
}

async function main() {
  // TEST A — Home NL → Workflow Preview → start path
  {
    const selection = selectWorkflowTemplate({
      request: '로그인 기능 만들어줘',
      projectType: 'web-app',
    })
    const resolved = resolveTemplateToSteps({
      template: selection.template,
      request: '로그인 기능 만들어줘',
      team: [],
      registry: [],
    })
    const preview = previewLabels(resolved.steps)
    const chatHas =
      (await fileContains('client/src/panels/AiChatPanel.tsx', [
        'ad-home-composer',
        'howWeProceed',
        'workflowPreview',
        "t('task.start')",
      ])) &&
      (await fileContains('client/src/layout/TopBar.tsx', [
        'focusNewWork',
        'askWhat',
      ]))
    record(
      'TEST A Home NL → Workflow Preview → start',
      chatHas && preview.length > 0 && Boolean(selection.template.id),
      `template=${selection.template.id} steps=${preview.length}`,
    )
  }

  // TEST B — Plan Approval → Inbox
  {
    const inbox =
      (await fileContains('client/src/pages/ApprovalsPage.tsx', [
        'selectPendingApprovals',
        'TaskDetailPanel',
        'embedded',
      ])) &&
      (await fileContains('client/src/layout/Sidebar.tsx', [
        'approvals',
        'badge',
      ]))
    record(
      'TEST B Plan Approval Inbox',
      inbox && approvalKindLabel('plan') === '계획 승인',
      approvalKindLabel('plan'),
    )
  }

  // TEST C — Change Approval Inbox + Diff
  {
    const ok =
      approvalKindLabel('change') === '변경 승인' &&
      (await fileContains('client/src/panels/TaskDetailPanel.tsx', [
        'Diff 펼치기',
        "t('task.approve')",
      ]))
    record('TEST C Change Approval Diff', ok)
  }

  // TEST D — Complete → Result → Artifacts
  {
    const ok = await fileContains('client/src/panels/TaskDetailPanel.tsx', [
      '작업 완료',
      'viewArtifacts',
      "setNav('documents')",
    ])
    record('TEST D Result Hub Artifacts', ok)
  }

  // TEST E — Knowledge under Project Detail (not top-level nav)
  {
    const ok =
      (await fileContains('client/src/pages/ProjectsPage.tsx', [
        '프로젝트 지식',
        'fetchProjectKnowledge',
      ])) &&
      (await fileLacks('client/src/layout/Sidebar.tsx', [
        "'knowledge'",
        'nav.knowledge',
      ]))
    record('TEST E Knowledge Navigation', ok)
  }

  // TEST F — Advanced / developer settings (Mock gated)
  {
    const ok = await fileContains('client/src/pages/SettingsPage.tsx', [
      '개발자 모드',
      'setDeveloperAllowMock',
      'MOCK',
      '모델 프로필',
    ])
    record('TEST F Advanced settings', ok)
  }

  // TEST G — technical error → Korean + detail
  {
    const msg = userFacingErrorMessage('Codex CLI failed with ECONNRESET')
    const ok =
      msg.includes('Codex') &&
      !msg.toLowerCase().includes('econnreset') &&
      (await fileContains('client/src/panels/TaskDetailPanel.tsx', [
        'userFacingErrorMessage',
        '상세 보기',
      ]))
    record('TEST G Error UX', ok, msg)
  }

  // TEST H — persistence / domain intact (no deletion of harden paths)
  {
    const ok =
      (await fileContains('server/src/runtime/localSession.ts', [
        'requireLocalSession',
      ])) &&
      (await fileContains('server/src/persistence/atomicWrite.ts', [
        'atomicWriteJson',
      ])) &&
      (await fileContains('client/src/components/WorkRequestModal.tsx', [
        'WorkRequestModal',
        '고급 작업 요청',
      ]))
    record('TEST H persistence + WorkRequest isolated', ok)
  }

  // Extra: phase strings gone from primary UI surfaces
  {
    const uiFiles = [
      'client/src/layout/Sidebar.tsx',
      'client/src/panels/AiChatPanel.tsx',
      'client/src/pages/SettingsPage.tsx',
      'client/src/panels/KnowledgeDetailPanel.tsx',
    ]
    let clean = true
    for (const f of uiFiles) {
      if (!(await fileLacks(f, ['(W1)', 'O1 ProjectBudget', 'F1 ', 'F2 ', 'F3 ']))) {
        clean = false
        break
      }
    }
    const status = userFacingTaskStatus(
      { status: 'awaiting_approval', workflow: 'BUILD' } as Task,
      null,
    )
    record(
      'TEST phase strings / display status',
      clean && status === '승인 대기',
      status,
    )
  }

  const failed = results.filter((r) => !r.ok)
  console.log('\n── Simplify-1 fixture summary ──')
  console.log(
    `passed=${results.length - failed.length} failed=${failed.length}`,
  )
  if (failed.length) {
    for (const f of failed) console.log(`  FAIL ${f.name}: ${f.detail ?? ''}`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
