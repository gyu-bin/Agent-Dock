/**
 * Project-isolated image file storage.
 * Never embed base64 in JSON. Never trust prompt for paths.
 */

import { mkdir, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { createImageError } from './imageErrors.js'

function defaultRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url))
  return (
    process.env.AGENT_DECK_GENERATED_DIR ??
    path.resolve(here, '../../data/generated')
  )
}

function safeProjectId(projectId: string): string {
  const cleaned = projectId.replace(/[^a-zA-Z0-9_-]/g, '_')
  if (!cleaned) throw createImageError({
    category: 'IMAGE_STORAGE_ERROR',
    userMessage: '잘못된 프로젝트 ID입니다.',
    technicalSummary: 'empty projectId after sanitize',
  })
  return cleaned
}

export function newImageId(): string {
  return `img_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`
}

export class ImageStorage {
  constructor(private readonly root = defaultRoot()) {}

  projectImagesDir(projectId: string): string {
    return path.join(this.root, safeProjectId(projectId), 'images')
  }

  filePath(projectId: string, imageId: string, ext = 'png'): string {
    const safeId = imageId.replace(/[^a-zA-Z0-9_-]/g, '_')
    const safeExt = ext.replace(/[^a-z0-9]/gi, '') || 'png'
    return path.join(this.projectImagesDir(projectId), `${safeId}.${safeExt}`)
  }

  /** Relative path under generated root for API serving */
  publicPath(projectId: string, imageId: string, ext = 'png'): string {
    const safeId = imageId.replace(/[^a-zA-Z0-9_-]/g, '_')
    const safeExt = ext.replace(/[^a-z0-9]/gi, '') || 'png'
    return `${safeProjectId(projectId)}/images/${safeId}.${safeExt}`
  }

  assertInsideRoot(absPath: string): void {
    const resolved = path.resolve(absPath)
    const root = path.resolve(this.root)
    if (!resolved.startsWith(root + path.sep) && resolved !== root) {
      throw createImageError({
        category: 'IMAGE_STORAGE_ERROR',
        userMessage: '이미지 저장 경로가 올바르지 않습니다.',
        technicalSummary: 'path escape blocked',
      })
    }
  }

  async writeImage(input: {
    projectId: string
    imageId: string
    bytes: Buffer
    ext?: string
  }): Promise<{ filePath: string; publicPath: string }> {
    try {
      const ext = input.ext ?? 'png'
      const filePath = this.filePath(input.projectId, input.imageId, ext)
      this.assertInsideRoot(filePath)
      await mkdir(path.dirname(filePath), { recursive: true })
      await writeFile(filePath, input.bytes)
      return {
        filePath,
        publicPath: this.publicPath(input.projectId, input.imageId, ext),
      }
    } catch (err) {
      if (err && typeof err === 'object' && 'category' in err) throw err
      throw createImageError({
        category: 'IMAGE_STORAGE_ERROR',
        userMessage: '이미지 파일 저장에 실패했습니다.',
        technicalSummary:
          err instanceof Error ? err.message : 'storage write failed',
        cause: err,
      })
    }
  }

  async readImage(filePath: string): Promise<Buffer> {
    this.assertInsideRoot(filePath)
    return readFile(filePath)
  }

  resolvePublicPath(publicPath: string): string {
    if (
      publicPath.includes('..') ||
      path.isAbsolute(publicPath) ||
      publicPath.includes('\0')
    ) {
      throw createImageError({
        category: 'IMAGE_STORAGE_ERROR',
        userMessage: '이미지 경로가 올바르지 않습니다.',
        technicalSummary: 'path traversal rejected',
      })
    }
    const cleaned = publicPath.replace(/^\/+/, '')
    const abs = path.resolve(this.root, cleaned)
    this.assertInsideRoot(abs)
    return abs
  }
}

export const imageStorage = new ImageStorage()
