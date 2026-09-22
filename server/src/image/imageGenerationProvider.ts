/**
 * ImageGenerationProvider implementations.
 * OPENAI_API_KEY never logged or returned.
 */

import { createImageError, classifyImageHttpError } from './imageErrors.js'
import {
  getImageModelFast,
  getImageModelQuality,
  mapAspectRatioToSize,
  resolveImageModel,
} from './imageConfig.js'
import { ImageStorage, newImageId } from './imageStorage.js'
import type {
  ImageEditRequest,
  ImageGenerationProvider,
  ImageGenerationRequest,
  ImageGenerationResult,
  ImageProviderState,
} from './types.js'

/** Minimal 1x1 PNG (fixture only). */
export const FIXTURE_PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

export class UnconfiguredImageProvider implements ImageGenerationProvider {
  getState(): ImageProviderState {
    return {
      configured: false,
      available: false,
      label: 'OpenAI Image · Not configured',
      fastModel: getImageModelFast(),
      qualityModel: getImageModelQuality(),
      providerName: 'none',
    }
  }

  async generate(): Promise<ImageGenerationResult> {
    throw createImageError({
      category: 'IMAGE_NOT_CONFIGURED',
      userMessage:
        '이미지 생성 도구가 연결되지 않았습니다. OPENAI_API_KEY를 설정하세요.',
      technicalSummary: 'OPENAI_API_KEY missing',
      status: 503,
      retryable: false,
    })
  }
}

/**
 * Fake provider for fixtures/tests only.
 * Never auto-selected when production provider is unavailable.
 */
export class FakeImageGenerationProvider implements ImageGenerationProvider {
  constructor(private readonly storage: ImageStorage) {}

  getState(): ImageProviderState {
    return {
      configured: true,
      available: true,
      label: 'Fake Image · Fixture',
      fastModel: getImageModelFast(),
      qualityModel: getImageModelQuality(),
      providerName: 'fake',
    }
  }

  async generate(
    request: ImageGenerationRequest,
  ): Promise<ImageGenerationResult> {
    if (request.prompt.includes('__FORCE_FAIL__')) {
      throw createImageError({
        category: 'IMAGE_UPSTREAM',
        userMessage: '이미지 생성에 실패했습니다 (fixture).',
        technicalSummary: 'forced fixture failure',
        status: 502,
        retryable: true,
      })
    }
    const id = newImageId()
    const mapped = mapAspectRatioToSize(
      request.size?.includes('x') ? undefined : request.size,
    )
    // If request.size is like 1024x1024 use it
    let width = mapped.width
    let height = mapped.height
    if (request.size && /^\d+x\d+$/.test(request.size)) {
      const [w, h] = request.size.split('x').map(Number)
      width = w || width
      height = h || height
    }
    const { filePath, publicPath } = await this.storage.writeImage({
      projectId: request.projectId,
      imageId: id,
      bytes: FIXTURE_PNG_1X1,
      ext: 'png',
    })
    return {
      id,
      model: resolveImageModel(request.modelProfile ?? 'fast'),
      mimeType: 'image/png',
      width,
      height,
      filePath,
      publicPath,
      revisedPrompt: request.prompt.slice(0, 200),
      createdAt: new Date().toISOString(),
    }
  }
}

export class OpenAIImageProvider implements ImageGenerationProvider {
  private readonly apiKey: string
  private readonly baseUrl: string

  constructor(
    apiKey: string,
    private readonly storage: ImageStorage,
  ) {
    this.apiKey = apiKey
    this.baseUrl =
      process.env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1'
  }

  getState(): ImageProviderState {
    return {
      configured: true,
      available: true,
      label: 'OpenAI Image · Configured',
      fastModel: getImageModelFast(),
      qualityModel: getImageModelQuality(),
      providerName: 'openai',
    }
  }

  async generate(
    request: ImageGenerationRequest,
  ): Promise<ImageGenerationResult> {
    const model = resolveImageModel(request.modelProfile ?? 'fast')
    const size =
      request.size && /^\d+x\d+$/.test(request.size)
        ? request.size
        : mapAspectRatioToSize().size
    const [width, height] = size.split('x').map(Number)

    const body: Record<string, unknown> = {
      model,
      prompt: request.prompt,
      n: 1,
      size,
      quality: request.quality ?? 'auto',
      output_format: 'png',
    }
    if (request.background) {
      body.background = request.background
    }

    const res = await fetch(`${this.baseUrl}/images/generations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    const rawText = await res.text()
    if (!res.ok) {
      throw classifyImageHttpError(res.status, rawText)
    }

    let data: {
      data?: Array<{ b64_json?: string; revised_prompt?: string }>
      usage?: { input_tokens?: number; output_tokens?: number }
    }
    try {
      data = JSON.parse(rawText) as typeof data
    } catch {
      throw createImageError({
        category: 'IMAGE_UPSTREAM',
        userMessage: '이미지 생성 응답을 해석할 수 없습니다.',
        technicalSummary: 'invalid JSON response',
        status: 502,
        retryable: true,
      })
    }

    const b64 = data.data?.[0]?.b64_json
    if (!b64) {
      throw createImageError({
        category: 'IMAGE_UPSTREAM',
        userMessage: '이미지 데이터가 비어 있습니다.',
        technicalSummary: 'missing b64_json',
        status: 502,
        retryable: true,
      })
    }

    const id = newImageId()
    const bytes = Buffer.from(b64, 'base64')
    const { filePath, publicPath } = await this.storage.writeImage({
      projectId: request.projectId,
      imageId: id,
      bytes,
      ext: 'png',
    })

    return {
      id,
      model,
      mimeType: 'image/png',
      width,
      height,
      filePath,
      publicPath,
      revisedPrompt: data.data?.[0]?.revised_prompt,
      usage: {
        inputTokens: data.usage?.input_tokens,
        outputTokens: data.usage?.output_tokens,
      },
      createdAt: new Date().toISOString(),
    }
  }

  async edit(_request: ImageEditRequest): Promise<ImageGenerationResult> {
    throw createImageError({
      category: 'IMAGE_INVALID_REQUEST',
      userMessage: '이미지 편집은 아직 지원되지 않습니다.',
      technicalSummary: 'edit not implemented this phase',
      status: 501,
      retryable: false,
    })
  }
}

/**
 * Production factory — Fake is NEVER used as automatic fallback.
 */
export function createImageGenerationProvider(
  storage: ImageStorage = new ImageStorage(),
): ImageGenerationProvider {
  const key = process.env.OPENAI_API_KEY?.trim()
  if (key) return new OpenAIImageProvider(key, storage)
  return new UnconfiguredImageProvider()
}
