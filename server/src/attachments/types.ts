/**
 * Work Input / Attachment domain types.
 * Binary never embedded in Task / work-state JSON.
 */

export type AttachmentKind =
  | 'image'
  | 'file'
  | 'local-folder'
  | 'github'
  | 'web-url'

export type AttachmentLifecycle =
  | 'staged'
  | 'attached'
  | 'orphaned'
  | 'deleted'

export type AttachmentSource =
  | 'upload'
  | 'clipboard'
  | 'drag-drop'
  | 'path'
  | 'url'
  | 'composer'

export type GitHubKind =
  | 'github-repository'
  | 'github-issue'
  | 'github-pull-request'
  | 'github-file'
  | 'github-directory'
  | 'github-commit'
  | 'github-other'

export type AttachmentContentKind =
  | 'image'
  | 'text'
  | 'document'
  | 'directory'
  | 'github'
  | 'web'

export interface WorkAttachmentBase {
  id: string
  kind: AttachmentKind
  name: string
  source: AttachmentSource
  createdAt: string
  projectId: string
  /** Staging bucket before Task bind */
  stagingId?: string
  taskId?: string
  lifecycle: AttachmentLifecycle
  metadata?: Record<string, unknown>
}

export interface ImageAttachment extends WorkAttachmentBase {
  kind: 'image'
  mimeType: string
  bytes: number
  width?: number
  height?: number
  /** Relative path under attachments root */
  localRef: string
}

export interface FileAttachment extends WorkAttachmentBase {
  kind: 'file'
  mimeType: string
  bytes: number
  extension: string
  localRef: string
}

export interface LocalFolderAttachment extends WorkAttachmentBase {
  kind: 'local-folder'
  path: string
  displayName: string
  access: 'reference'
}

export interface GitHubAttachment extends WorkAttachmentBase {
  kind: 'github'
  url: string
  githubKind: GitHubKind
  owner: string
  repo: string
  number?: number
  ref?: string
  path?: string
}

export interface WebUrlAttachment extends WorkAttachmentBase {
  kind: 'web-url'
  url: string
  title?: string
}

export type WorkAttachment =
  | ImageAttachment
  | FileAttachment
  | LocalFolderAttachment
  | GitHubAttachment
  | WebUrlAttachment

export interface WorkInput {
  text: string
  attachments: WorkAttachment[]
}

export interface ResolvedAttachment {
  id: string
  kind: AttachmentKind
  contentKind: AttachmentContentKind
  contextText?: string
  fileRef?: string
  imageRef?: string
  url?: string
  truncated?: boolean
  /** Vision/multimodal capable — false if provider cannot take image input */
  imageInputSupported?: boolean
  /** Folder is reference/read-only — never writable Codex root */
  readOnly?: boolean
  metadata: Record<string, unknown>
  capabilityHints: string[]
}

export interface AttachmentStoreSnapshot {
  version: 1
  projectId: string
  attachments: WorkAttachment[]
}

export type AttachmentErrorCategory =
  | 'ATTACHMENT_TOO_LARGE'
  | 'ATTACHMENT_UNSUPPORTED'
  | 'ATTACHMENT_NOT_FOUND'
  | 'ATTACHMENT_PATH_VIOLATION'
  | 'ATTACHMENT_READ_FAILED'
  | 'ATTACHMENT_INVALID_URL'
  | 'ATTACHMENT_RESOLUTION_FAILED'
  | 'ATTACHMENT_SECRET_BLOCKED'
  | 'ATTACHMENT_OWNERSHIP'

export interface AttachmentError {
  category: AttachmentErrorCategory
  userMessage: string
  technicalSummary: string
  status: number
}
