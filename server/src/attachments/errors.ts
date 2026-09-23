import type { AttachmentError, AttachmentErrorCategory } from './types.js'

export function createAttachmentError(input: {
  category: AttachmentErrorCategory
  userMessage: string
  technicalSummary: string
  status?: number
}): AttachmentError {
  return {
    category: input.category,
    userMessage: input.userMessage,
    technicalSummary: input.technicalSummary.slice(0, 240),
    status: input.status ?? defaultStatus(input.category),
  }
}

function defaultStatus(c: AttachmentErrorCategory): number {
  switch (c) {
    case 'ATTACHMENT_NOT_FOUND':
      return 404
    case 'ATTACHMENT_TOO_LARGE':
    case 'ATTACHMENT_UNSUPPORTED':
    case 'ATTACHMENT_PATH_VIOLATION':
    case 'ATTACHMENT_INVALID_URL':
    case 'ATTACHMENT_SECRET_BLOCKED':
    case 'ATTACHMENT_OWNERSHIP':
      return 400
    default:
      return 500
  }
}

export function isAttachmentError(err: unknown): err is AttachmentError {
  return Boolean(err && typeof err === 'object' && 'category' in err)
}

export const ATTACHMENT_LIMITS = {
  maxAttachmentsPerRequest: 12,
  maxSingleFileBytes: 8 * 1024 * 1024,
  maxTotalStagingBytes: 32 * 1024 * 1024,
  maxTextContextChars: 12_000,
  maxDocumentExcerptChars: 8_000,
} as const

export const IMAGE_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
])

export const TEXT_EXTENSIONS = new Set([
  'md',
  'txt',
  'json',
  'csv',
  'js',
  'jsx',
  'ts',
  'tsx',
  'css',
  'html',
  'htm',
  'py',
  'yaml',
  'yml',
  'toml',
  'rs',
  'go',
  'java',
  'kt',
  'swift',
  'c',
  'cpp',
  'h',
  'hpp',
  'sh',
  'sql',
])

export const DOCUMENT_EXTENSIONS = new Set(['pdf'])
