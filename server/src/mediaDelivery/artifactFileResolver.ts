/**
 * Resolve Artifact → local file with ownership + realpath containment.
 * Never accept caller-supplied file paths.
 */

import { createHash } from 'node:crypto'
import { lstat, realpath, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ArtifactService } from '../persistence/artifactService.js'
import type { Artifact } from '../persistence/artifactTypes.js'
import {
  ALLOWED_MEDIA_MIMES,
  DEFAULT_MAX_BYTES,
  createMediaError,
} from './mediaErrors.js'
import type { ResolvedArtifactFile } from './types.js'

function generatedRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url))
  return (
    process.env.AGENT_DECK_GENERATED_DIR ??
    path.resolve(here, '../../data/generated')
  )
}

function mimeFromExt(filePath: string): string | undefined {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.png') return 'image/png'
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.mp4') return 'video/mp4'
  if (ext === '.webm') return 'video/webm'
  return undefined
}

function extractFileRef(art: Artifact): {
  filePath?: string
  publicPath?: string
  mimeType?: string
} {
  const meta = (art.metadata ?? {}) as Record<string, unknown>
  let filePath =
    typeof meta.filePath === 'string' ? meta.filePath : undefined
  let publicPath =
    typeof meta.publicPath === 'string' ? meta.publicPath : undefined
  let mimeType =
    typeof meta.mimeType === 'string' ? meta.mimeType : undefined
  if (art.contentType === 'json') {
    try {
      const parsed = JSON.parse(art.content) as {
        filePath?: string
        publicPath?: string
        mimeType?: string
      }
      filePath = filePath ?? parsed.filePath
      publicPath = publicPath ?? parsed.publicPath
      mimeType = mimeType ?? parsed.mimeType
    } catch {
      // ignore
    }
  }
  return { filePath, publicPath, mimeType }
}

export async function resolveArtifactMediaFile(input: {
  projectId: string
  artifactId: string
  artifacts: ArtifactService
  expectedMimeTypes?: string[]
  maxBytes?: number
}): Promise<ResolvedArtifactFile> {
  const art = await input.artifacts.getArtifact(
    input.projectId,
    input.artifactId,
  )
  if (!art) {
    throw createMediaError({
      category: 'MEDIA_ARTIFACT_NOT_FOUND',
      userMessage: '미디어 Artifact를 찾을 수 없습니다.',
      technicalSummary: `artifact not found: ${input.artifactId}`,
    })
  }
  if (art.projectId !== input.projectId) {
    throw createMediaError({
      category: 'MEDIA_OWNERSHIP',
      userMessage: '다른 프로젝트의 미디어는 사용할 수 없습니다.',
      technicalSummary: 'artifact.projectId mismatch',
    })
  }

  const ref = extractFileRef(art)
  const root = path.resolve(generatedRoot())
  let candidate: string | undefined

  if (ref.filePath) {
    if (
      ref.filePath.includes('..') ||
      ref.filePath.includes('\0') ||
      (path.isAbsolute(ref.filePath) === false &&
        ref.filePath.startsWith('~'))
    ) {
      // relative with .. already blocked; absolute outside root blocked below
    }
    if (ref.filePath.includes('..') || ref.filePath.includes('\0')) {
      throw createMediaError({
        category: 'MEDIA_PATH_VIOLATION',
        userMessage: '미디어 경로가 올바르지 않습니다.',
        technicalSummary: 'path traversal in filePath ref',
      })
    }
    candidate = path.isAbsolute(ref.filePath)
      ? ref.filePath
      : path.resolve(root, ref.filePath)
  } else if (ref.publicPath) {
    if (ref.publicPath.includes('..') || ref.publicPath.includes('\0')) {
      throw createMediaError({
        category: 'MEDIA_PATH_VIOLATION',
        userMessage: '미디어 경로가 올바르지 않습니다.',
        technicalSummary: 'path traversal in publicPath',
      })
    }
    candidate = path.resolve(root, ref.publicPath.replace(/^\/+/, ''))
  } else {
    throw createMediaError({
      category: 'MEDIA_ARTIFACT_NOT_FOUND',
      userMessage: 'Artifact에 미디어 파일 참조가 없습니다.',
      technicalSummary: 'no filePath/publicPath',
    })
  }

  let real: string
  try {
    real = await realpath(candidate)
  } catch {
    throw createMediaError({
      category: 'MEDIA_PATH_VIOLATION',
      userMessage: '미디어 파일을 열 수 없습니다.',
      technicalSummary: `realpath failed: ${candidate}`,
    })
  }

  const rootReal = await realpath(root).catch(() => root)
  if (real !== rootReal && !real.startsWith(rootReal + path.sep)) {
    throw createMediaError({
      category: 'MEDIA_PATH_VIOLATION',
      userMessage: '허용되지 않은 파일 경로입니다.',
      technicalSummary: 'realpath outside generated root',
    })
  }

  // Project isolation: path must include sanitized projectId segment
  const safeProject = input.projectId.replace(/[^a-zA-Z0-9_-]/g, '_')
  if (!real.includes(`${path.sep}${safeProject}${path.sep}`)) {
    throw createMediaError({
      category: 'MEDIA_OWNERSHIP',
      userMessage: '프로젝트 경계 밖의 미디어입니다.',
      technicalSummary: 'projectId not in file path',
    })
  }

  const st = await lstat(real)
  if (!st.isFile() || st.isSymbolicLink()) {
    // After realpath, symlink should be resolved; still reject if somehow link
    throw createMediaError({
      category: 'MEDIA_PATH_VIOLATION',
      userMessage: '일반 파일만 전달할 수 있습니다.',
      technicalSummary: 'not a regular file',
    })
  }

  const mime =
    ref.mimeType ??
    mimeFromExt(real) ??
    'application/octet-stream'
  const allow = input.expectedMimeTypes?.length
    ? input.expectedMimeTypes
    : [...ALLOWED_MEDIA_MIMES]
  if (!allow.includes(mime)) {
    throw createMediaError({
      category: 'MEDIA_UNSUPPORTED_TYPE',
      userMessage: '지원하지 않는 미디어 형식입니다.',
      technicalSummary: `mime=${mime}`,
    })
  }

  const maxBytes = input.maxBytes ?? DEFAULT_MAX_BYTES
  if (st.size > maxBytes) {
    throw createMediaError({
      category: 'MEDIA_TOO_LARGE',
      userMessage: '미디어 파일이 너무 큽니다.',
      technicalSummary: `bytes=${st.size} max=${maxBytes}`,
    })
  }

  const bytes = await readFile(real)
  const contentHash = createHash('sha256').update(bytes).digest('hex')

  return {
    artifactId: art.id,
    projectId: art.projectId,
    absolutePath: real,
    mimeType: mime,
    bytes: st.size,
    version: art.version,
    familyId: art.familyId,
    contentHash,
  }
}

/** Fingerprint for approval binding (version + content hash) */
export function mediaFingerprint(file: {
  artifactId: string
  version: number
  contentHash: string
}): string {
  return `${file.artifactId}@v${file.version}:${file.contentHash.slice(0, 16)}`
}
