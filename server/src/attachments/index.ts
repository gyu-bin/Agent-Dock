export type {
  AttachmentKind,
  AttachmentLifecycle,
  AttachmentSource,
  GitHubKind,
  AttachmentContentKind,
  WorkAttachmentBase,
  ImageAttachment,
  FileAttachment,
  LocalFolderAttachment,
  GitHubAttachment,
  WebUrlAttachment,
  WorkAttachment,
  WorkInput,
  ResolvedAttachment,
  AttachmentStoreSnapshot,
  AttachmentErrorCategory,
  AttachmentError,
} from './types.js'

export {
  createAttachmentError,
  isAttachmentError,
  ATTACHMENT_LIMITS,
  IMAGE_MIMES,
  TEXT_EXTENSIONS,
  DOCUMENT_EXTENSIONS,
} from './errors.js'

export { isSecretFileName, secretFileUserMessage } from './secretGuard.js'
export { assertSafeHttpUrl } from './urlSecurity.js'
export {
  parseGitHubUrl,
  classifyUrlAttachment,
  detectUrlsInText,
  requireGitHubParse,
} from './githubParser.js'
export type { ParsedGitHubUrl } from './githubParser.js'

export {
  AttachmentStorage,
  newAttachmentId,
  newStagingId,
  validateLocalFolderPath,
} from './storage.js'

export {
  JsonAttachmentRepository,
  attachmentRepository,
} from './repository.js'

export {
  resolveAttachment,
  resolveMany,
  formatAttachmentsContextBlock,
  attachmentCapabilityHints,
  summarizeAttachmentsForPlanner,
} from './resolver.js'
export type { ResolveOptions } from './resolver.js'

export {
  AttachmentService,
  createAttachmentService,
} from './service.js'
