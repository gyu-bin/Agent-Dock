import { createHash } from 'node:crypto'
import type { MarketingContent } from '../marketing/marketingTypes.js'
import type { ArtifactService } from '../persistence/artifactService.js'
import {
  mediaFingerprint,
  resolveArtifactMediaFile,
} from '../mediaDelivery/artifactFileResolver.js'

/**
 * Deterministic content hash for publish approval binding.
 * Includes media artifact versions/content fingerprints when available.
 */
export function hashMarketingContent(
  content: Pick<
    MarketingContent,
    | 'id'
    | 'channel'
    | 'type'
    | 'title'
    | 'body'
    | 'hashtags'
    | 'callToAction'
    | 'creativeArtifactIds'
  >,
  mediaFingerprints: string[] = [],
): string {
  const payload = JSON.stringify({
    id: content.id,
    channel: content.channel,
    type: content.type,
    title: content.title ?? '',
    body: content.body,
    hashtags: content.hashtags ?? [],
    callToAction: content.callToAction ?? '',
    creativeArtifactIds: content.creativeArtifactIds ?? [],
    mediaFingerprints,
  })
  return createHash('sha256').update(payload).digest('hex')
}

/** Resolve media fingerprints for approval binding (async). */
export async function collectMediaFingerprints(
  projectId: string,
  artifactIds: string[] | undefined,
  artifacts: ArtifactService | null,
): Promise<string[]> {
  if (!artifactIds?.length || !artifacts) {
    return (artifactIds ?? []).map((id) => `${id}@unknown`)
  }
  const out: string[] = []
  for (const id of artifactIds) {
    try {
      const file = await resolveArtifactMediaFile({
        projectId,
        artifactId: id,
        artifacts,
      })
      out.push(mediaFingerprint(file))
    } catch {
      const art = await artifacts.getArtifact(projectId, id)
      out.push(art ? `${art.id}@v${art.version}:meta` : `${id}@missing`)
    }
  }
  return out
}

export async function hashMarketingContentAsync(
  content: Pick<
    MarketingContent,
    | 'id'
    | 'channel'
    | 'type'
    | 'title'
    | 'body'
    | 'hashtags'
    | 'callToAction'
    | 'creativeArtifactIds'
  >,
  projectId: string,
  artifacts: ArtifactService | null,
): Promise<string> {
  const fps = await collectMediaFingerprints(
    projectId,
    content.creativeArtifactIds,
    artifacts,
  )
  return hashMarketingContent(content, fps)
}

export function publishIdempotencyKey(input: {
  campaignId: string
  contentId: string
  channel: string
}): string {
  return `pub_${input.campaignId}_${input.contentId}_${input.channel}`
}
