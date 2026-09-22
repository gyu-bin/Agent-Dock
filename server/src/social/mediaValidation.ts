/**
 * Media artifact validation before connector.publish.
 * Platform-specific requirements stay on the Connector.
 */

import type { ArtifactService } from '../persistence/artifactService.js'
import { createSocialError } from './socialErrors.js'

export interface MediaValidationInput {
  projectId: string
  mediaArtifactIds: string[]
  artifacts: ArtifactService
}

export async function validateMediaArtifacts(
  input: MediaValidationInput,
): Promise<void> {
  for (const id of input.mediaArtifactIds) {
    const art = await input.artifacts.getArtifact(input.projectId, id)
    if (!art) {
      throw createSocialError({
        category: 'SOCIAL_MEDIA_INVALID',
        userMessage: '게시용 미디어 Artifact를 찾을 수 없습니다.',
        technicalSummary: `artifact missing: ${id}`,
      })
    }
    if (art.projectId !== input.projectId) {
      throw createSocialError({
        category: 'SOCIAL_OWNERSHIP',
        userMessage: '다른 프로젝트의 미디어는 게시할 수 없습니다.',
        technicalSummary: `ownership mismatch artifact=${id}`,
      })
    }
    // Creative images / design — mime/size live in content JSON or metadata
    const meta = (art.metadata ?? {}) as Record<string, unknown>
    let mime: string | undefined =
      typeof meta.mimeType === 'string' ? meta.mimeType : undefined
    if (!mime && art.contentType === 'json') {
      try {
        const parsed = JSON.parse(art.content) as { mimeType?: string }
        mime = parsed.mimeType
      } catch {
        // ignore
      }
    }
    if (
      art.type === 'creative-image' &&
      mime &&
      !mime.startsWith('image/')
    ) {
      throw createSocialError({
        category: 'SOCIAL_MEDIA_INVALID',
        userMessage: '지원하지 않는 미디어 형식입니다.',
        technicalSummary: `mime=${mime}`,
      })
    }
  }
}
