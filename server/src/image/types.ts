/** Image generation domain types */

export type ImageModelProfile = 'fast' | 'quality'

export type ImagePurpose =
  | 'marketing'
  | 'product'
  | 'social'
  | 'illustration'
  | 'asset'
  | 'custom'

export type ImageBackground = 'auto' | 'opaque' | 'transparent'

export interface ImageProviderState {
  configured: boolean
  available: boolean
  label: string
  fastModel: string
  qualityModel: string
  providerName: 'openai' | 'fake' | 'none'
}

export interface ImageGenerationRequest {
  projectId: string
  taskId?: string
  campaignId?: string
  contentId?: string
  prompt: string
  purpose: ImagePurpose
  size?: string
  quality?: 'auto' | 'low' | 'medium' | 'high'
  background?: ImageBackground
  modelProfile?: ImageModelProfile
  /** Idempotency key to avoid duplicate side effects on retry */
  idempotencyKey?: string
  /** Feedback for regenerate */
  feedback?: string
  previousArtifactId?: string
}

export interface ImageEditRequest {
  projectId: string
  taskId?: string
  campaignId?: string
  prompt: string
  sourceFilePath: string
  modelProfile?: ImageModelProfile
  background?: ImageBackground
  size?: string
}

export interface ImageGenerationResult {
  id: string
  model: string
  mimeType: string
  width?: number
  height?: number
  filePath: string
  /** Relative path safe for serving under /api/... */
  publicPath?: string
  revisedPrompt?: string
  usage?: {
    inputTokens?: number
    outputTokens?: number
  }
  createdAt: string
}

export type ImageErrorCategory =
  | 'IMAGE_NOT_CONFIGURED'
  | 'IMAGE_RATE_LIMIT'
  | 'IMAGE_QUOTA'
  | 'IMAGE_UPSTREAM'
  | 'IMAGE_INVALID_REQUEST'
  | 'IMAGE_STORAGE_ERROR'
  | 'IMAGE_CANCELLED'
  | 'IMAGE_UNKNOWN'

export interface ImageGenerationError extends Error {
  category: ImageErrorCategory
  userMessage: string
  technicalSummary: string
  status?: number
  retryable?: boolean
}

export interface ImageGenerationProvider {
  getState(): ImageProviderState
  generate(request: ImageGenerationRequest): Promise<ImageGenerationResult>
  edit?(request: ImageEditRequest): Promise<ImageGenerationResult>
}
