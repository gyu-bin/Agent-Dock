/**
 * AttachmentService — stage / bind / resolve / delete.
 */

import path from 'node:path'
import {
  ATTACHMENT_LIMITS,
  DOCUMENT_EXTENSIONS,
  IMAGE_MIMES,
  TEXT_EXTENSIONS,
  createAttachmentError,
  isAttachmentError,
} from './errors.js'
import { classifyUrlAttachment } from './githubParser.js'
import {
  attachmentCapabilityHints,
  formatAttachmentsContextBlock,
  resolveAttachment,
  resolveMany,
  summarizeAttachmentsForPlanner,
  type ResolveOptions,
} from './resolver.js'
import {
  JsonAttachmentRepository,
  attachmentRepository,
} from './repository.js'
import { isSecretFileName, secretFileUserMessage } from './secretGuard.js'
import {
  AttachmentStorage,
  newAttachmentId,
  newStagingId,
  validateLocalFolderPath,
} from './storage.js'
import type {
  FileAttachment,
  GitHubAttachment,
  ImageAttachment,
  LocalFolderAttachment,
  ResolvedAttachment,
  WebUrlAttachment,
  WorkAttachment,
  WorkInput,
} from './types.js'

function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i + 1).toLowerCase() : ''
}

function guessMime(name: string, provided?: string): string {
  if (provided?.trim()) return provided.trim().toLowerCase()
  const ext = extOf(name)
  if (ext === 'png') return 'image/png'
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'gif') return 'image/gif'
  if (ext === 'pdf') return 'application/pdf'
  if (ext === 'json') return 'application/json'
  if (ext === 'md') return 'text/markdown'
  if (ext === 'csv') return 'text/csv'
  if (['ts', 'tsx', 'js', 'jsx', 'css', 'html', 'py', 'txt', 'yaml', 'yml'].includes(ext)) {
    return 'text/plain'
  }
  return 'application/octet-stream'
}

export class AttachmentService {
  constructor(
    private readonly repo: JsonAttachmentRepository = attachmentRepository,
    private readonly storage: AttachmentStorage = new AttachmentStorage(),
  ) {}

  getStorage(): AttachmentStorage {
    return this.storage
  }

  async list(
    projectId: string,
    filter?: { taskId?: string; stagingId?: string; lifecycle?: string },
  ): Promise<WorkAttachment[]> {
    const snap = await this.repo.load(projectId)
    return snap.attachments.filter((a) => {
      if (a.lifecycle === 'deleted') return false
      if (filter?.taskId && a.taskId !== filter.taskId) return false
      if (filter?.stagingId && a.stagingId !== filter.stagingId) return false
      if (filter?.lifecycle && a.lifecycle !== filter.lifecycle) return false
      return true
    })
  }

  async get(
    projectId: string,
    attachmentId: string,
  ): Promise<WorkAttachment | null> {
    const snap = await this.repo.load(projectId)
    const a = snap.attachments.find((x) => x.id === attachmentId) ?? null
    if (!a || a.lifecycle === 'deleted') return null
    if (a.projectId !== projectId) return null
    return a
  }

  async stageFile(input: {
    projectId: string
    stagingId?: string
    name: string
    mimeType?: string
    bytes: Buffer
    source?: WorkAttachment['source']
  }): Promise<WorkAttachment> {
    if (isSecretFileName(input.name)) {
      throw createAttachmentError({
        category: 'ATTACHMENT_SECRET_BLOCKED',
        userMessage: secretFileUserMessage(input.name),
        technicalSummary: `secret name ${input.name}`,
      })
    }
    const stagingId = input.stagingId ?? newStagingId()
    await this.assertStagingBudget(input.projectId, stagingId, input.bytes.length)

    const mime = guessMime(input.name, input.mimeType)
    const ext = extOf(input.name)
    const isImage = IMAGE_MIMES.has(mime) || ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)
    const isText = TEXT_EXTENSIONS.has(ext)
    const isDoc = DOCUMENT_EXTENSIONS.has(ext)

    if (!isImage && !isText && !isDoc) {
      throw createAttachmentError({
        category: 'ATTACHMENT_UNSUPPORTED',
        userMessage: `지원하지 않는 파일 형식입니다: ${input.name}`,
        technicalSummary: `mime=${mime} ext=${ext}`,
      })
    }

    const id = newAttachmentId()
    const written = await this.storage.writeBytes({
      projectId: input.projectId,
      stagingId,
      attachmentId: id,
      bytes: input.bytes,
      ext: isImage
        ? ext || 'png'
        : isDoc
          ? 'pdf'
          : ext || 'txt',
    })

    const now = new Date().toISOString()
    let attachment: WorkAttachment
    if (isImage) {
      const img: ImageAttachment = {
        id,
        kind: 'image',
        name: input.name,
        source: input.source ?? 'upload',
        createdAt: now,
        projectId: input.projectId,
        stagingId,
        lifecycle: 'staged',
        mimeType: mime === 'image/jpg' ? 'image/jpeg' : mime,
        bytes: input.bytes.length,
        localRef: written.localRef,
        metadata: { safeFile: path.basename(written.absolutePath) },
      }
      attachment = img
    } else {
      const file: FileAttachment = {
        id,
        kind: 'file',
        name: input.name,
        source: input.source ?? 'upload',
        createdAt: now,
        projectId: input.projectId,
        stagingId,
        lifecycle: 'staged',
        mimeType: mime,
        bytes: input.bytes.length,
        extension: ext || (isDoc ? 'pdf' : 'txt'),
        localRef: written.localRef,
      }
      attachment = file
    }

    await this.upsert(attachment)
    return attachment
  }

  async stageFolder(input: {
    projectId: string
    stagingId?: string
    path: string
    displayName?: string
    source?: WorkAttachment['source']
  }): Promise<LocalFolderAttachment> {
    const validated = validateLocalFolderPath(input.path)
    const stagingId = input.stagingId ?? newStagingId()
    const id = newAttachmentId()
    const attachment: LocalFolderAttachment = {
      id,
      kind: 'local-folder',
      name: input.displayName ?? validated.displayName,
      source: input.source ?? 'path',
      createdAt: new Date().toISOString(),
      projectId: input.projectId,
      stagingId,
      lifecycle: 'staged',
      path: validated.path,
      displayName: input.displayName ?? validated.displayName,
      access: 'reference',
    }
    await this.upsert(attachment)
    return attachment
  }

  async stageUrl(input: {
    projectId: string
    stagingId?: string
    url: string
    title?: string
    source?: WorkAttachment['source']
  }): Promise<GitHubAttachment | WebUrlAttachment> {
    const classified = classifyUrlAttachment(input.url)
    const stagingId = input.stagingId ?? newStagingId()
    const id = newAttachmentId()
    const now = new Date().toISOString()
    if (classified.kind === 'github' && classified.github) {
      const g = classified.github
      const attachment: GitHubAttachment = {
        id,
        kind: 'github',
        name: `${g.owner}/${g.repo}${g.number != null ? `#${g.number}` : ''}`,
        source: input.source ?? 'url',
        createdAt: now,
        projectId: input.projectId,
        stagingId,
        lifecycle: 'staged',
        url: g.url,
        githubKind: g.githubKind,
        owner: g.owner,
        repo: g.repo,
        number: g.number,
        ref: g.ref,
        path: g.path,
      }
      await this.upsert(attachment)
      return attachment
    }
    const attachment: WebUrlAttachment = {
      id,
      kind: 'web-url',
      name: input.title ?? classified.url,
      source: input.source ?? 'url',
      createdAt: now,
      projectId: input.projectId,
      stagingId,
      lifecycle: 'staged',
      url: classified.url,
      title: input.title,
    }
    await this.upsert(attachment)
    return attachment
  }

  async bindToTask(input: {
    projectId: string
    taskId: string
    attachmentIds: string[]
  }): Promise<WorkAttachment[]> {
    if (input.attachmentIds.length > ATTACHMENT_LIMITS.maxAttachmentsPerRequest) {
      throw createAttachmentError({
        category: 'ATTACHMENT_TOO_LARGE',
        userMessage: `첨부는 요청당 최대 ${ATTACHMENT_LIMITS.maxAttachmentsPerRequest}개입니다.`,
        technicalSummary: 'max attachments',
      })
    }
    const snap = await this.repo.load(input.projectId)
    const out: WorkAttachment[] = []
    for (const id of input.attachmentIds) {
      const a = snap.attachments.find((x) => x.id === id)
      if (!a || a.lifecycle === 'deleted') {
        throw createAttachmentError({
          category: 'ATTACHMENT_NOT_FOUND',
          userMessage: '첨부를 찾을 수 없습니다.',
          technicalSummary: `missing ${id}`,
        })
      }
      if (a.projectId !== input.projectId) {
        throw createAttachmentError({
          category: 'ATTACHMENT_OWNERSHIP',
          userMessage: '다른 프로젝트의 첨부입니다.',
          technicalSummary: 'ownership',
        })
      }
      a.taskId = input.taskId
      a.lifecycle = 'attached'
      out.push(a)
    }
    await this.repo.save(snap)
    return out
  }

  async deleteAttachment(
    projectId: string,
    attachmentId: string,
    opts?: { hard?: boolean },
  ): Promise<void> {
    const snap = await this.repo.load(projectId)
    const a = snap.attachments.find((x) => x.id === attachmentId)
    if (!a || a.projectId !== projectId) {
      throw createAttachmentError({
        category: 'ATTACHMENT_NOT_FOUND',
        userMessage: '첨부를 찾을 수 없습니다.',
        technicalSummary: 'not found',
        status: 404,
      })
    }
    // Attached (task-bound) — soft delete by default to preserve provenance
    if (a.lifecycle === 'attached' && !opts?.hard) {
      a.lifecycle = 'orphaned'
      await this.repo.save(snap)
      return
    }
    if (a.kind === 'image' || a.kind === 'file') {
      await this.storage.removeAttachmentDir(
        projectId,
        { stagingId: a.stagingId, taskId: a.taskId },
        a.id,
      )
    }
    a.lifecycle = 'deleted'
    await this.repo.save(snap)
  }

  async resolve(
    projectId: string,
    attachmentId: string,
    opts?: ResolveOptions,
  ): Promise<ResolvedAttachment> {
    const a = await this.get(projectId, attachmentId)
    if (!a) {
      throw createAttachmentError({
        category: 'ATTACHMENT_NOT_FOUND',
        userMessage: '첨부를 찾을 수 없습니다.',
        technicalSummary: 'not found',
        status: 404,
      })
    }
    if (a.projectId !== projectId) {
      throw createAttachmentError({
        category: 'ATTACHMENT_OWNERSHIP',
        userMessage: '다른 프로젝트의 첨부입니다.',
        technicalSummary: 'ownership',
      })
    }
    return resolveAttachment(a, this.storage, opts)
  }

  async resolveForTask(
    projectId: string,
    taskId: string,
    opts?: ResolveOptions,
  ): Promise<ResolvedAttachment[]> {
    const list = await this.list(projectId, { taskId })
    return resolveMany(list, this.storage, opts)
  }

  async buildWorkInput(
    projectId: string,
    text: string,
    attachmentIds: string[],
  ): Promise<WorkInput> {
    const attachments: WorkAttachment[] = []
    for (const id of attachmentIds) {
      const a = await this.get(projectId, id)
      if (!a) {
        throw createAttachmentError({
          category: 'ATTACHMENT_NOT_FOUND',
          userMessage: '첨부를 찾을 수 없습니다.',
          technicalSummary: id,
        })
      }
      attachments.push(a)
    }
    return { text, attachments }
  }

  plannerHint(attachments: WorkAttachment[]): string {
    return summarizeAttachmentsForPlanner(attachments)
  }

  capabilityHints(attachments: WorkAttachment[]): string[] {
    return attachmentCapabilityHints(attachments)
  }

  formatContext(resolved: ResolvedAttachment[]): string {
    return formatAttachmentsContextBlock(resolved)
  }

  /** Reference folder paths — never include in Codex writable roots. */
  referenceFolderPaths(attachments: WorkAttachment[]): string[] {
    return attachments
      .filter((a): a is LocalFolderAttachment => a.kind === 'local-folder')
      .map((a) => a.path)
  }

  private async upsert(attachment: WorkAttachment): Promise<void> {
    const snap = await this.repo.load(attachment.projectId)
    const idx = snap.attachments.findIndex((a) => a.id === attachment.id)
    if (idx >= 0) snap.attachments[idx] = attachment
    else snap.attachments.unshift(attachment)
    await this.repo.save(snap)
  }

  private async assertStagingBudget(
    projectId: string,
    stagingId: string,
    addBytes: number,
  ): Promise<void> {
    const list = await this.list(projectId, { stagingId })
    let total = addBytes
    for (const a of list) {
      if (a.kind === 'image' || a.kind === 'file') total += a.bytes
    }
    if (total > ATTACHMENT_LIMITS.maxTotalStagingBytes) {
      throw createAttachmentError({
        category: 'ATTACHMENT_TOO_LARGE',
        userMessage: '스테이징 용량 한도를 초과했습니다.',
        technicalSummary: `total=${total}`,
      })
    }
    const count = list.length + 1
    if (count > ATTACHMENT_LIMITS.maxAttachmentsPerRequest) {
      throw createAttachmentError({
        category: 'ATTACHMENT_TOO_LARGE',
        userMessage: `첨부는 요청당 최대 ${ATTACHMENT_LIMITS.maxAttachmentsPerRequest}개입니다.`,
        technicalSummary: 'count',
      })
    }
  }
}

export function createAttachmentService(deps?: {
  repo?: JsonAttachmentRepository
  storage?: AttachmentStorage
}): AttachmentService {
  return new AttachmentService(
    deps?.repo ?? attachmentRepository,
    deps?.storage ?? new AttachmentStorage(),
  )
}

export { isAttachmentError }
