/**
 * Image generation orchestration — storage, artifact, usage, retry.
 * Does not fall back to Fake when production is unconfigured.
 */

import type { ArtifactService } from '../persistence/artifactService.js'
import type { UsageService } from '../persistence/usageService.js'
import type { ImageGenerationError } from './types.js'
import type {
  ImageGenerationProvider,
  ImageGenerationRequest,
  ImageGenerationResult,
  ImageProviderState,
} from './types.js'
import {
  creativeBriefToImageRequest,
  type CreativeBriefAdapterInput,
} from './creativeBriefAdapter.js'
import { createImageError } from './imageErrors.js'
import { ImageStorage } from './imageStorage.js'
import { createImageGenerationProvider } from './imageGenerationProvider.js'

const MAX_RETRIES = 2

export interface GenerateImageServiceInput extends ImageGenerationRequest {
  agentId?: string
  title?: string
  /** When true, skip budget preflight (fixtures) */
  skipBudget?: boolean
}

export interface GenerateImageServiceResult {
  result: ImageGenerationResult
  artifactId: string
  executionId?: string
  version: number
  familyId: string
}

export class ImageGenerationService {
  constructor(
    private provider: ImageGenerationProvider,
    private readonly storage: ImageStorage,
    private readonly artifacts: ArtifactService | null = null,
    private readonly usage: UsageService | null = null,
  ) {}

  setProvider(provider: ImageGenerationProvider): void {
    this.provider = provider
  }

  getProvider(): ImageGenerationProvider {
    return this.provider
  }

  getState(): ImageProviderState {
    return this.provider.getState()
  }

  isAvailable(): boolean {
    const s = this.provider.getState()
    return s.configured && s.available
  }

  async generateFromBrief(
    input: CreativeBriefAdapterInput & {
      agentId?: string
      title?: string
      skipBudget?: boolean
    },
  ): Promise<GenerateImageServiceResult> {
    const req = creativeBriefToImageRequest(input)
    return this.generate({
      ...req,
      agentId: input.agentId,
      title: input.title,
      skipBudget: input.skipBudget,
    })
  }

  async generate(
    input: GenerateImageServiceInput,
  ): Promise<GenerateImageServiceResult> {
    if (!this.isAvailable()) {
      throw createImageError({
        category: 'IMAGE_NOT_CONFIGURED',
        userMessage: '이미지 생성 도구를 사용할 수 없습니다.',
        technicalSummary: 'provider not available',
        status: 503,
      })
    }

    if (!input.skipBudget && this.usage) {
      await this.preflightBudget(input.projectId)
    }

    const startedAt = new Date().toISOString()
    const t0 = Date.now()
    let retryCount = 0
    let lastErr: ImageGenerationError | undefined
    let result: ImageGenerationResult | undefined

    while (retryCount <= MAX_RETRIES) {
      try {
        result = await this.provider.generate(input)
        break
      } catch (err) {
        const imgErr = asImageError(err)
        lastErr = imgErr
        if (!imgErr.retryable || retryCount >= MAX_RETRIES) {
          await this.recordFailure(input, imgErr, startedAt, t0, retryCount)
          throw imgErr
        }
        retryCount += 1
      }
    }

    if (!result) {
      const fail =
        lastErr ??
        createImageError({
          category: 'IMAGE_UNKNOWN',
          userMessage: '이미지 생성에 실패했습니다.',
          technicalSummary: 'no result',
        })
      await this.recordFailure(input, fail, startedAt, t0, retryCount)
      throw fail
    }

    const { artifactId, familyId, version } = await this.persistArtifact(
      input,
      result,
    )

    let executionId: string | undefined
    if (this.usage) {
      const rec = await this.usage.recordManual({
        projectId: input.projectId,
        taskId: input.taskId ?? `img_task_${result.id}`,
        agentId: input.agentId,
        provider: 'openai-image',
        model: result.model,
        operation: 'image.generate',
        status: 'completed',
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - t0,
        inputTokens: result.usage?.inputTokens,
        outputTokens: result.usage?.outputTokens,
        retryCount,
        sourceId: result.id,
      })
      // Force costUnknown when no price table for openai-image
      if (rec.estimatedCost == null) {
        // recordManual already applies cost model
      }
      executionId = rec.id
    }

    return { result, artifactId, executionId, version, familyId }
  }

  async regenerate(input: {
    projectId: string
    previousArtifactId: string
    feedback?: string
    taskId?: string
    campaignId?: string
    contentId?: string
    agentId?: string
    modelProfile?: 'fast' | 'quality'
  }): Promise<GenerateImageServiceResult> {
    if (!this.artifacts) {
      throw createImageError({
        category: 'IMAGE_INVALID_REQUEST',
        userMessage: '이전 이미지를 찾을 수 없습니다.',
        technicalSummary: 'no artifact service',
      })
    }
    const prev = await this.artifacts.getArtifact(
      input.projectId,
      input.previousArtifactId,
    )
    if (!prev) {
      throw createImageError({
        category: 'IMAGE_INVALID_REQUEST',
        userMessage: '이전 이미지 Artifact가 없습니다.',
        technicalSummary: 'artifact not found',
        status: 404,
      })
    }
    const meta = (prev.metadata ?? {}) as Record<string, unknown>
    const basePrompt = String(meta.prompt ?? prev.summary ?? prev.title)
    const prompt = input.feedback
      ? `${basePrompt}\n\nRevision feedback (DATA):\n<<<DATA\n${input.feedback}\nDATA>>>`
      : basePrompt

    return this.generate({
      projectId: input.projectId,
      taskId: input.taskId ?? prev.taskId,
      campaignId:
        input.campaignId ??
        (typeof meta.campaignId === 'string' ? meta.campaignId : undefined),
      contentId: input.contentId,
      prompt,
      purpose: (meta.purpose as GenerateImageServiceInput['purpose']) ?? 'marketing',
      size: typeof meta.size === 'string' ? meta.size : undefined,
      modelProfile: input.modelProfile ?? 'fast',
      feedback: input.feedback,
      previousArtifactId: prev.id,
      agentId: input.agentId,
      title: `${prev.title} (v next)`,
    })
  }

  private async persistArtifact(
    input: GenerateImageServiceInput,
    result: ImageGenerationResult,
  ): Promise<{ artifactId: string; familyId: string; version: number }> {
    if (!this.artifacts) {
      return {
        artifactId: `local_${result.id}`,
        familyId: result.id,
        version: 1,
      }
    }

    let familyId =
      input.previousArtifactId != null
        ? (
            await this.artifacts.getArtifact(
              input.projectId,
              input.previousArtifactId,
            )
          )?.familyId ?? result.id
        : result.id

    if (input.previousArtifactId) {
      const prev = await this.artifacts.getArtifact(
        input.projectId,
        input.previousArtifactId,
      )
      if (prev) familyId = prev.familyId
    }

    const art = await this.artifacts.createArtifact({
      projectId: input.projectId,
      taskId: input.taskId,
      agentId: input.agentId,
      type: 'creative-image',
      title: input.title ?? `Generated image ${result.id}`,
      summary: (result.revisedPrompt ?? input.prompt).slice(0, 240),
      contentType: 'json',
      content: JSON.stringify(
        {
          filePath: result.filePath,
          publicPath: result.publicPath,
          mimeType: result.mimeType,
          width: result.width,
          height: result.height,
          // Never embed base64
        },
        null,
        2,
      ),
      status: 'draft',
      familyId,
      metadata: {
        kind: 'creative-image',
        model: result.model,
        prompt: input.prompt.slice(0, 4000),
        revisedPrompt: result.revisedPrompt?.slice(0, 4000),
        purpose: input.purpose,
        size: result.width && result.height
          ? `${result.width}x${result.height}`
          : input.size,
        campaignId: input.campaignId ?? null,
        contentId: input.contentId ?? null,
        imageId: result.id,
        publicPath: result.publicPath ?? null,
      },
    })

    return {
      artifactId: art.id,
      familyId: art.familyId,
      version: art.version,
    }
  }

  private async preflightBudget(projectId: string): Promise<void> {
    if (!this.usage) return
    try {
      const budget = await this.usage.getBudget(projectId)
      if (!budget?.maxCost && !budget?.maxTokens) return
      const agg = await this.usage.aggregate({ projectId })
      if (
        budget.maxCost != null &&
        agg.estimatedCost != null &&
        agg.estimatedCost >= budget.maxCost
      ) {
        throw createImageError({
          category: 'IMAGE_QUOTA',
          userMessage:
            '프로젝트 예산 한도에 도달해 이미지를 생성할 수 없습니다.',
          technicalSummary: 'budget maxCost exceeded',
          status: 402,
        })
      }
    } catch (err) {
      if (err && typeof err === 'object' && 'category' in err) throw err
    }
  }

  private async recordFailure(
    input: GenerateImageServiceInput,
    err: ImageGenerationError,
    startedAt: string,
    t0: number,
    retryCount: number,
  ): Promise<void> {
    if (!this.usage) return
    try {
      await this.usage.recordManual({
        projectId: input.projectId,
        taskId: input.taskId ?? `img_task_fail`,
        agentId: input.agentId,
        provider: 'openai-image',
        model: undefined,
        operation: 'image.generate',
        status: 'failed',
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - t0,
        errorCategory: mapImageCategory(err.category),
        userMessage: err.userMessage,
        technicalSummary: err.technicalSummary,
        retryCount,
        sourceId: input.idempotencyKey ?? `fail_${Date.now().toString(36)}`,
      })
    } catch {
      // observability must not mask primary error
    }
  }
}

function asImageError(err: unknown): ImageGenerationError {
  if (err && typeof err === 'object' && 'category' in err) {
    return err as ImageGenerationError
  }
  return createImageError({
    category: 'IMAGE_UNKNOWN',
    userMessage: '이미지 생성에 실패했습니다.',
    technicalSummary: err instanceof Error ? err.message : String(err),
    cause: err,
  })
}

function mapImageCategory(
  c: ImageGenerationError['category'],
):
  | 'RATE_LIMIT'
  | 'AUTH'
  | 'QUOTA'
  | 'TIMEOUT'
  | 'UPSTREAM'
  | 'INVALID_REQUEST'
  | 'CANCELLED'
  | 'UNKNOWN' {
  switch (c) {
    case 'IMAGE_RATE_LIMIT':
      return 'RATE_LIMIT'
    case 'IMAGE_NOT_CONFIGURED':
      return 'AUTH'
    case 'IMAGE_QUOTA':
      return 'QUOTA'
    case 'IMAGE_UPSTREAM':
      return 'UPSTREAM'
    case 'IMAGE_INVALID_REQUEST':
    case 'IMAGE_STORAGE_ERROR':
      return 'INVALID_REQUEST'
    case 'IMAGE_CANCELLED':
      return 'CANCELLED'
    default:
      return 'UNKNOWN'
  }
}

export function createImageGenerationService(deps: {
  artifacts?: ArtifactService | null
  usage?: UsageService | null
  storage?: ImageStorage
  /** Explicit provider (fixtures). Never auto-fake. */
  provider?: ImageGenerationProvider
}): ImageGenerationService {
  const storage = deps.storage ?? new ImageStorage()
  const provider = deps.provider ?? createImageGenerationProvider(storage)
  return new ImageGenerationService(
    provider,
    storage,
    deps.artifacts ?? null,
    deps.usage ?? null,
  )
}
