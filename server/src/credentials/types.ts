/**
 * Credential storage — tokens NEVER enter projects/marketing/social/artifact JSON
 * or frontend responses. File-backed now; Keychain-swappable later.
 */

export type CredentialProviderId = 'threads' | 'instagram' | 'x' | 'youtube'

export interface CredentialSecret {
  accessToken: string
  /** Present when long-lived / refreshable */
  refreshToken?: string
  tokenType?: string
  scopes?: string[]
  expiresAt?: string
  /** Earliest safe refresh time (e.g. long-lived must be ≥24h old) */
  refreshAfter?: string
}

/** Non-secret metadata safe for Settings / connector state */
export interface CredentialPublicMeta {
  provider: CredentialProviderId
  /** Isolation key — typically 'global' or projectId */
  accountKey: string
  profileId?: string
  username?: string
  connectedAt?: string
  updatedAt: string
  status: 'connected' | 'expired' | 'error' | 'disconnected'
  lastError?: string
}

export interface StoredCredential {
  meta: CredentialPublicMeta
  secret: CredentialSecret
}

export interface CredentialRepository {
  get(
    provider: CredentialProviderId,
    accountKey: string,
  ): Promise<StoredCredential | null>

  /** Returns meta only — never secrets */
  getMeta(
    provider: CredentialProviderId,
    accountKey: string,
  ): Promise<CredentialPublicMeta | null>

  save(credential: StoredCredential): Promise<void>

  delete(
    provider: CredentialProviderId,
    accountKey: string,
  ): Promise<void>

  listMeta(provider?: CredentialProviderId): Promise<CredentialPublicMeta[]>
}
