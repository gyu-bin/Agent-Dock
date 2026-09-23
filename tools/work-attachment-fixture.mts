/**
 * Work Input & Attachment fixtures A–N.
 * Run: node --import tsx tools/work-attachment-fixture.mts
 * No live OpenAI / SNS / R2 calls.
 */
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  existsSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  createAttachmentService,
  JsonAttachmentRepository,
  AttachmentStorage,
  parseGitHubUrl,
  classifyUrlAttachment,
  assertSafeHttpUrl,
  isSecretFileName,
  isAttachmentError,
  ATTACHMENT_LIMITS,
} from '../server/src/attachments/index.ts'
import { FIXTURE_PNG_1X1 } from '../server/src/image/index.ts'
import {
  buildAgentContext,
  assembleUserPrompt,
} from '../server/src/ai/contextBuilder.ts'
import { buildHandoffFromOutput } from '../server/src/ai/artifactHeuristics.ts'
import { ArtifactService } from '../server/src/persistence/artifactService.ts'
import { JsonArtifactRepository } from '../server/src/persistence/artifactRepository.ts'
import {
  isReferenceOnlyFolder,
  assertReferenceFoldersNotWritableTarget,
} from '../server/src/codex/pathSandbox.ts'
import { planTask } from '../client/src/domain/taskPlanning/canonicalTaskPlanner.ts'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg)
}

function eq<T>(a: T, b: T, msg: string) {
  assert(a === b, `${msg}: expected ${String(b)}, got ${String(a)}`)
}

const dir = mkdtempSync(path.join(tmpdir(), 'ad-att-'))
const filesDir = path.join(dir, 'files')
const metaDir = path.join(dir, 'meta')
const artifactsDir = path.join(dir, 'artifacts')
const refFolder = path.join(dir, 'reference-app')
mkdirSync(filesDir, { recursive: true })
mkdirSync(refFolder, { recursive: true })
writeFileSync(path.join(refFolder, 'readme.txt'), 'reference only')

const PROJECT_A = 'proj_att_a'
const PROJECT_B = 'proj_att_b'
const storage = new AttachmentStorage(filesDir)
const repo = new JsonAttachmentRepository(metaDir)
const service = createAttachmentService({ repo, storage })
const artifacts = new ArtifactService(new JsonArtifactRepository(artifactsDir))

try {
  // ——— A: Image ———
  {
    const img = await service.stageFile({
      projectId: PROJECT_A,
      name: 'shot-a.png',
      mimeType: 'image/png',
      bytes: FIXTURE_PNG_1X1,
      source: 'upload',
    })
    eq(img.kind, 'image', 'A kind')
    eq(img.lifecycle, 'staged', 'A staged')
    const resolved = await service.resolve(PROJECT_A, img.id, {
      visionCapable: true,
    })
    eq(resolved.contentKind, 'image', 'A content')
    assert(resolved.imageRef && existsSync(resolved.imageRef), 'A imageRef')
    assert(resolved.imageInputSupported === true, 'A vision')
    const taskId = 'task_a'
    await service.bindToTask({
      projectId: PROJECT_A,
      taskId,
      attachmentIds: [img.id],
    })
    const bound = await service.get(PROJECT_A, img.id)
    eq(bound?.lifecycle, 'attached', 'A attached')
    eq(bound?.taskId, taskId, 'A task')
    console.log('TEST A PASS')
  }

  // ——— B: Multiple Images order ———
  {
    const a = await service.stageFile({
      projectId: PROJECT_A,
      stagingId: 'stg_b',
      name: 'first.png',
      bytes: FIXTURE_PNG_1X1,
    })
    const b = await service.stageFile({
      projectId: PROJECT_A,
      stagingId: 'stg_b',
      name: 'second.png',
      bytes: FIXTURE_PNG_1X1,
    })
    const ids = [a.id, b.id]
    await service.bindToTask({
      projectId: PROJECT_A,
      taskId: 'task_b',
      attachmentIds: ids,
    })
    const list = await service.list(PROJECT_A, { taskId: 'task_b' })
    const ordered = ids.map((id) => list.find((x) => x.id === id)!)
    eq(ordered[0]!.name, 'first.png', 'B order1')
    eq(ordered[1]!.name, 'second.png', 'B order2')
    console.log('TEST B PASS')
  }

  // ——— C: PDF/Text excerpt budget ———
  {
    const big = Buffer.from('x'.repeat(ATTACHMENT_LIMITS.maxTextContextChars + 500), 'utf8')
    const doc = await service.stageFile({
      projectId: PROJECT_A,
      name: 'notes.md',
      mimeType: 'text/markdown',
      bytes: big,
    })
    const resolved = await service.resolve(PROJECT_A, doc.id)
    assert(resolved.truncated === true, 'C truncated')
    assert(
      (resolved.contextText?.length ?? 0) <=
        ATTACHMENT_LIMITS.maxTextContextChars + 200,
      'C budget',
    )
    console.log('TEST C PASS')
  }

  // ——— D: Code file hint ———
  {
    const code = await service.stageFile({
      projectId: PROJECT_A,
      name: 'Button.tsx',
      bytes: Buffer.from('export const Button = () => null\n', 'utf8'),
    })
    const resolved = await service.resolve(PROJECT_A, code.id)
    assert(resolved.capabilityHints.includes('code.inspect'), 'D hint')
    console.log('TEST D PASS')
  }

  // ——— E: Folder reference not writable ———
  {
    const folder = await service.stageFolder({
      projectId: PROJECT_A,
      path: refFolder,
    })
    eq(folder.access, 'reference', 'E access')
    const resolved = await service.resolve(PROJECT_A, folder.id)
    assert(resolved.readOnly === true, 'E readonly')
    const projectPath = path.join(dir, 'writable-project')
    mkdirSync(projectPath)
    assert(
      isReferenceOnlyFolder(folder.path, projectPath, [folder.path]),
      'E is reference',
    )
    assert(
      !isReferenceOnlyFolder(projectPath, projectPath, [folder.path]),
      'E project not reference',
    )
    let threw = false
    try {
      assertReferenceFoldersNotWritableTarget(folder.path, [folder.path])
    } catch {
      threw = true
    }
    assert(threw, 'E cannot use reference as writable')
    console.log('TEST E PASS')
  }

  // ——— F: GitHub repo ———
  {
    const p = parseGitHubUrl('https://github.com/foo/bar')
    assert(p?.githubKind === 'github-repository', 'F kind')
    eq(p!.owner, 'foo', 'F owner')
    eq(p!.repo, 'bar', 'F repo')
    const att = await service.stageUrl({
      projectId: PROJECT_A,
      url: 'https://github.com/foo/bar',
    })
    eq(att.kind, 'github', 'F att')
    console.log('TEST F PASS')
  }

  // ——— G: Issue / PR ———
  {
    const issue = parseGitHubUrl('https://github.com/foo/bar/issues/123')
    eq(issue?.githubKind, 'github-issue', 'G issue')
    eq(issue?.number, 123, 'G issue n')
    const pr = parseGitHubUrl('https://github.com/foo/bar/pull/9')
    eq(pr?.githubKind, 'github-pull-request', 'G pr')
    eq(pr?.number, 9, 'G pr n')
    console.log('TEST G PASS')
  }

  // ——— H: Web URL / reject ———
  {
    const web = classifyUrlAttachment('https://example.com/design')
    eq(web.kind, 'web-url', 'H web')
    let bad = false
    try {
      assertSafeHttpUrl('javascript:alert(1)')
    } catch {
      bad = true
    }
    assert(bad, 'H js reject')
    let fileUrl = false
    try {
      assertSafeHttpUrl('file:///etc/passwd')
    } catch {
      fileUrl = true
    }
    assert(fileUrl, 'H file reject')
    console.log('TEST H PASS')
  }

  // ——— I: Secret ———
  {
    assert(isSecretFileName('.env'), 'I .env')
    assert(isSecretFileName('id_rsa'), 'I id_rsa')
    let blocked = false
    try {
      await service.stageFile({
        projectId: PROJECT_A,
        name: '.env',
        bytes: Buffer.from('SECRET=1'),
      })
    } catch (err) {
      blocked =
        isAttachmentError(err) && err.category === 'ATTACHMENT_SECRET_BLOCKED'
    }
    assert(blocked, 'I blocked')
    console.log('TEST I PASS')
  }

  // ——— J: Provenance ———
  {
    const img = await service.stageFile({
      projectId: PROJECT_A,
      name: 'ux.png',
      bytes: FIXTURE_PNG_1X1,
    })
    await service.bindToTask({
      projectId: PROJECT_A,
      taskId: 'task_j',
      attachmentIds: [img.id],
    })
    const art = await artifacts.createArtifact({
      projectId: PROJECT_A,
      taskId: 'task_j',
      type: 'design',
      title: 'UX notes',
      summary: 'from screenshot',
      content: 'analysis',
      sourceAttachmentIds: [img.id],
    })
    assert(art.sourceAttachmentIds?.includes(img.id), 'J provenance')
    console.log('TEST J PASS')
  }

  // ——— K: Handoff ———
  {
    const handoff = buildHandoffFromOutput({
      projectId: PROJECT_A,
      taskId: 'task_k',
      fromAgentId: 'ux-researcher',
      toAgentId: 'frontend-developer',
      output: 'Decided to follow second screenshot.\nRisk: layout shift.',
      artifactIds: [],
      relevantAttachmentIds: ['att_k1', 'att_k2'],
    })
    assert(
      handoff.relevantAttachmentIds?.join(',') === 'att_k1,att_k2',
      'K handoff ids',
    )
    const ctx = buildAgentContext({
      userRequest: 'fix UI',
      stepTask: 'implement',
      handoff: { ...handoff, id: 'h1', createdAt: new Date().toISOString() },
      attachmentsBlock: '### Image att_k1',
      includedAttachmentIds: ['att_k1'],
    })
    const prompt = assembleUserPrompt(ctx)
    assert(prompt.includes('WORK ATTACHMENTS'), 'K attachments block')
    assert(prompt.includes('Relevant attachments'), 'K handoff line')
    console.log('TEST K PASS')
  }

  // ——— L: Project isolation ———
  {
    const img = await service.stageFile({
      projectId: PROJECT_A,
      name: 'iso.png',
      bytes: FIXTURE_PNG_1X1,
    })
    let ownership = false
    try {
      await service.resolve(PROJECT_B, img.id)
    } catch (err) {
      ownership =
        isAttachmentError(err) &&
        (err.category === 'ATTACHMENT_OWNERSHIP' ||
          err.category === 'ATTACHMENT_NOT_FOUND')
    }
    assert(ownership, 'L ownership')
    console.log('TEST L PASS')
  }

  // ——— M: Reload ———
  {
    const img = await service.stageFile({
      projectId: PROJECT_A,
      name: 'persist.png',
      bytes: FIXTURE_PNG_1X1,
    })
    await service.bindToTask({
      projectId: PROJECT_A,
      taskId: 'task_m',
      attachmentIds: [img.id],
    })
    const service2 = createAttachmentService({
      repo: new JsonAttachmentRepository(metaDir),
      storage: new AttachmentStorage(filesDir),
    })
    const reloaded = await service2.get(PROJECT_A, img.id)
    eq(reloaded?.taskId, 'task_m', 'M task')
    eq(reloaded?.lifecycle, 'attached', 'M lifecycle')
    console.log('TEST M PASS')
  }

  // ——— N: Large file ———
  {
    const huge = Buffer.alloc(ATTACHMENT_LIMITS.maxSingleFileBytes + 1, 1)
    let tooLarge = false
    try {
      await service.stageFile({
        projectId: PROJECT_A,
        name: 'huge.png',
        mimeType: 'image/png',
        bytes: huge,
      })
    } catch (err) {
      tooLarge =
        isAttachmentError(err) && err.category === 'ATTACHMENT_TOO_LARGE'
    }
    assert(tooLarge, 'N too large')
    console.log('TEST N PASS')
  }

  // Planner still works with attachment hints (smoke)
  {
    const plan = planTask({
      project: { id: PROJECT_A, type: 'web-app', name: 'A' },
      request: '버튼 고쳐줘',
      source: { type: 'user' },
      team: [],
      registry: [],
      attachmentHints: {
        hasImages: true,
        summary: 'Attachments present: 1 image(s).',
      },
    })
    assert(plan.steps.length >= 0, 'planner ok')
  }

  console.log('workAttachment fixtures: ALL PASS')
} finally {
  rmSync(dir, { recursive: true, force: true })
}
