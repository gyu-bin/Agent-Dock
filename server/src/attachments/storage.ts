/**
 * Attachment file storage — safe paths, no original filename as path segment.
 */

import { mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import {
  existsSync,
  statSync,
  realpathSync,
  accessSync,
  constants,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { createAttachmentError } from './errors.js'
import { ATTACHMENT_LIMITS } from './errors.js'

function defaultRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url))
  return (
    process.env.AGENT_DECK_ATTACHMENTS_DIR ??
    path.resolve(here, '../../data/attachments')
  )
}

function safeId(id: string): string {
  const cleaned = id.replace(/[^a-zA-Z0-9_-]/g, '_')
  if (!cleaned) {
    throw createAttachmentError({
      category: 'ATTACHMENT_PATH_VIOLATION',
      userMessage: '잘못된 첨부 ID입니다.',
      technicalSummary: 'empty id',
    })
  }
  return cleaned
}

export function newAttachmentId(): string {
  return `att_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`
}

export function newStagingId(): string {
  return `stg_${Date.now().toString(36)}_${randomBytes(3).toString('hex')}`
}

export class AttachmentStorage {
  constructor(private readonly root = defaultRoot()) {}

  getRoot(): string {
    return this.root
  }

  stagingDir(projectId: string, stagingId: string): string {
    return path.join(
      this.root,
      safeId(projectId),
      'staging',
      safeId(stagingId),
    )
  }

  taskDir(projectId: string, taskId: string): string {
    return path.join(this.root, safeId(projectId), 'tasks', safeId(taskId))
  }

  attachmentDir(
    projectId: string,
    scope: { stagingId?: string; taskId?: string },
    attachmentId: string,
  ): string {
    const base = scope.taskId
      ? this.taskDir(projectId, scope.taskId)
      : this.stagingDir(projectId, scope.stagingId ?? 'orphan')
    return path.join(base, safeId(attachmentId))
  }

  assertInsideRoot(absPath: string): void {
    const resolved = path.resolve(absPath)
    const root = path.resolve(this.root)
    if (!resolved.startsWith(root + path.sep) && resolved !== root) {
      throw createAttachmentError({
        category: 'ATTACHMENT_PATH_VIOLATION',
        userMessage: '첨부 저장 경로가 올바르지 않습니다.',
        technicalSummary: 'path escape blocked',
      })
    }
  }

  async writeBytes(input: {
    projectId: string
    stagingId?: string
    taskId?: string
    attachmentId: string
    bytes: Buffer
    ext: string
  }): Promise<{ absolutePath: string; localRef: string }> {
    if (input.bytes.length > ATTACHMENT_LIMITS.maxSingleFileBytes) {
      throw createAttachmentError({
        category: 'ATTACHMENT_TOO_LARGE',
        userMessage: `파일이 너무 큽니다. 최대 ${Math.round(ATTACHMENT_LIMITS.maxSingleFileBytes / (1024 * 1024))}MB까지 가능합니다.`,
        technicalSummary: `bytes=${input.bytes.length}`,
      })
    }
    const dir = this.attachmentDir(
      input.projectId,
      { stagingId: input.stagingId, taskId: input.taskId },
      input.attachmentId,
    )
    this.assertInsideRoot(dir)
    await mkdir(dir, { recursive: true })
    const safeExt = (input.ext.replace(/[^a-z0-9]/gi, '') || 'bin').slice(0, 12)
    const fileName = `content.${safeExt}`
    const absolutePath = path.join(dir, fileName)
    this.assertInsideRoot(absolutePath)
    await writeFile(absolutePath, input.bytes)
    const localRef = path.relative(this.root, absolutePath)
    return { absolutePath, localRef }
  }

  resolveLocalRef(localRef: string): string {
    const abs = path.resolve(this.root, localRef)
    this.assertInsideRoot(abs)
    return abs
  }

  async readBytes(localRef: string): Promise<Buffer> {
    try {
      return await readFile(this.resolveLocalRef(localRef))
    } catch (err) {
      throw createAttachmentError({
        category: 'ATTACHMENT_READ_FAILED',
        userMessage: '첨부 파일을 읽을 수 없습니다.',
        technicalSummary: err instanceof Error ? err.message : String(err),
      })
    }
  }

  async removeAttachmentDir(
    projectId: string,
    scope: { stagingId?: string; taskId?: string },
    attachmentId: string,
  ): Promise<void> {
    const dir = this.attachmentDir(projectId, scope, attachmentId)
    this.assertInsideRoot(dir)
    await rm(dir, { recursive: true, force: true })
  }
}

/** Validate local folder reference — exists, directory, readable. No write grant. */
export function validateLocalFolderPath(rawPath: string): {
  path: string
  displayName: string
} {
  const trimmed = rawPath.trim()
  if (!trimmed) {
    throw createAttachmentError({
      category: 'ATTACHMENT_PATH_VIOLATION',
      userMessage: '폴더 경로가 비어 있습니다.',
      technicalSummary: 'empty path',
    })
  }
  if (trimmed.includes('\0')) {
    throw createAttachmentError({
      category: 'ATTACHMENT_PATH_VIOLATION',
      userMessage: '잘못된 폴더 경로입니다.',
      technicalSummary: 'null byte',
    })
  }
  let real: string
  try {
    if (!existsSync(trimmed)) {
      throw createAttachmentError({
        category: 'ATTACHMENT_NOT_FOUND',
        userMessage: '폴더를 찾을 수 없습니다.',
        technicalSummary: 'not exists',
      })
    }
    real = realpathSync(trimmed)
    const st = statSync(real)
    if (!st.isDirectory()) {
      throw createAttachmentError({
        category: 'ATTACHMENT_PATH_VIOLATION',
        userMessage: '디렉터리가 아닙니다.',
        technicalSummary: 'not directory',
      })
    }
  } catch (err) {
    if (err && typeof err === 'object' && 'category' in err) throw err
    throw createAttachmentError({
      category: 'ATTACHMENT_PATH_VIOLATION',
      userMessage: '폴더 경로를 확인할 수 없습니다.',
      technicalSummary: err instanceof Error ? err.message : String(err),
    })
  }
  try {
    accessSync(real, constants.R_OK)
  } catch {
    throw createAttachmentError({
      category: 'ATTACHMENT_READ_FAILED',
      userMessage: '폴더를 읽을 수 없습니다.',
      technicalSummary: 'not readable',
    })
  }
  return {
    path: real,
    displayName: path.basename(real),
  }
}
