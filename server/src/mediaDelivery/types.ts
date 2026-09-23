/**
 * Media Delivery Foundation — temporary public URLs for social publish.
 * Local server stays 127.0.0.1; no arbitrary file exposure.
 */

export type MediaDeliveryPurpose =
  | 'social-publish'
  | 'preview'
  | 'external-fetch'

export type DeliveredMediaStatus = 'active' | 'expired' | 'revoked'

export type MediaDeliveryProviderId =
  | 'unconfigured'
  | 'fake'
  | 's3-compatible'

export interface MediaDeliveryState {
  provider: MediaDeliveryProviderId
  configured: boolean
  available: boolean
  label: string
  defaultTtlSeconds: number
  /** Never include secrets */
  bucket?: string
  region?: string
}

export interface MediaDeliveryRequest {
  projectId: string
  artifactId: string
  purpose: MediaDeliveryPurpose
  requestedTtlSeconds?: number
  expectedMimeTypes?: string[]
  maxBytes?: number
  /** For idempotent reuse within a publish attempt */
  publishAttemptId?: string
}

export interface DeliveredMedia {
  id: string
  projectId: string
  artifactId: string
  provider: MediaDeliveryProviderId
  /** Transient signed/fake URL — prefer not to persist long-term */
  url: string
  mimeType: string
  bytes: number
  createdAt: string
  expiresAt: string
  status: DeliveredMediaStatus
  remoteKey?: string
  publishAttemptId?: string
}

/** Persisted metadata — URL optional (regenerable from remoteKey for fake) */
export interface MediaDeliveryRecord {
  id: string
  projectId: string
  artifactId: string
  provider: MediaDeliveryProviderId
  remoteKey?: string
  mimeType: string
  bytes: number
  createdAt: string
  expiresAt: string
  status: DeliveredMediaStatus
  publishAttemptId?: string
  /** Only stored for fake/debug; production should omit signed URLs */
  urlHint?: string
}

export interface MediaDeliveryStoreSnapshot {
  version: 1
  projectId: string
  deliveries: MediaDeliveryRecord[]
}

export type MediaErrorCategory =
  | 'MEDIA_NOT_CONFIGURED'
  | 'MEDIA_ARTIFACT_NOT_FOUND'
  | 'MEDIA_OWNERSHIP'
  | 'MEDIA_PATH_VIOLATION'
  | 'MEDIA_UNSUPPORTED_TYPE'
  | 'MEDIA_TOO_LARGE'
  | 'MEDIA_UPLOAD_FAILED'
  | 'MEDIA_SIGN_FAILED'
  | 'MEDIA_REVOKE_FAILED'
  | 'MEDIA_UNKNOWN'

export interface MediaDeliveryError {
  category: MediaErrorCategory
  userMessage: string
  technicalSummary: string
  status: number
  retryable: boolean
  cause?: unknown
}

export interface ResolvedArtifactFile {
  artifactId: string
  projectId: string
  absolutePath: string
  mimeType: string
  bytes: number
  version: number
  familyId: string
  contentHash: string
}

export interface MediaDeliveryProvider {
  getState(): MediaDeliveryState

  prepare(
    request: MediaDeliveryRequest,
    file: ResolvedArtifactFile,
  ): Promise<DeliveredMedia>

  revoke?(deliveryId: string, record: MediaDeliveryRecord): Promise<void>

  deleteRemoteObject?(remoteKey: string): Promise<void>

  /**
   * Re-sign an existing remote object without re-upload.
   * Used for publishAttempt reuse when the object is still valid.
   */
  resign?(
    record: MediaDeliveryRecord,
    ttlSeconds?: number,
  ): Promise<{ url: string; expiresAt: string }>
}
