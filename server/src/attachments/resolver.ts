/**
 * Resolve attachments into context-ready payloads.
 * Images: imageRef for multimodal-capable providers (never silent ignore).
 * Folders: read-only reference — never Codex writable root.
 */

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  ATTACHMENT_LIMITS,
  DOCUMENT_EXTENSIONS,
  TEXT_EXTENSIONS,
  createAttachmentError,
} from './errors.js'
import type { AttachmentStorage } from './storage.js'
import type {
  ResolvedAttachment,
  WorkAttachment,
} from './types.js'

export interface ResolveOptions {
  /** Whether the current OpenAI/chat provider accepts image inputs */
  visionCapable?: boolean
  maxTextChars?: number
}

export async function resolveAttachment(
  attachment: WorkAttachment,
  storage: AttachmentStorage,
  opts: ResolveOptions = {},
): Promise<ResolvedAttachment> {
  const visionCapable = opts.visionCapable ?? false
  const maxText =
    opts.maxTextChars ?? ATTACHMENT_LIMITS.maxTextContextChars

  switch (attachment.kind) {
    case 'image': {
      const abs = storage.resolveLocalRef(attachment.localRef)
      return {
        id: attachment.id,
        kind: 'image',
        contentKind: 'image',
        imageRef: abs,
        fileRef: abs,
        imageInputSupported: visionCapable,
        contextText: visionCapable
          ? `[Image attachment: ${attachment.name} (${attachment.mimeType}, ${attachment.bytes} bytes) — provided as vision input]`
          : `[Image attachment: ${attachment.name} — current provider does not accept image input; do not invent pixel details]`,
        metadata: {
          mimeType: attachment.mimeType,
          bytes: attachment.bytes,
          width: attachment.width,
          height: attachment.height,
          name: attachment.name,
        },
        capabilityHints: ['design.analyze', 'vision.input'],
      }
    }
    case 'file': {
      const abs = storage.resolveLocalRef(attachment.localRef)
      const ext = attachment.extension.toLowerCase()
      if (TEXT_EXTENSIONS.has(ext)) {
        const raw = await storage.readBytes(attachment.localRef)
        const text = raw.toString('utf8')
        const truncated = text.length > maxText
        const excerpt = truncated ? `${text.slice(0, maxText)}…` : text
        const hints =
          ['ts', 'tsx', 'js', 'jsx', 'py', 'css', 'html'].includes(ext)
            ? ['code.inspect']
            : ['research.analyze']
        return {
          id: attachment.id,
          kind: 'file',
          contentKind: 'text',
          fileRef: abs,
          truncated,
          contextText: `### File: ${attachment.name}\n\`\`\`${ext}\n${excerpt}\n\`\`\``,
          metadata: {
            mimeType: attachment.mimeType,
            bytes: attachment.bytes,
            extension: ext,
            name: attachment.name,
          },
          capabilityHints: hints,
        }
      }
      if (DOCUMENT_EXTENSIONS.has(ext)) {
        // Minimal PDF handling: mark as document reference (no heavy OCR)
        let excerpt = ''
        let truncated = false
        try {
          const buf = await readFile(abs)
          const asText = extractPdfishText(buf)
          if (asText.trim()) {
            truncated = asText.length > ATTACHMENT_LIMITS.maxDocumentExcerptChars
            excerpt = truncated
              ? asText.slice(0, ATTACHMENT_LIMITS.maxDocumentExcerptChars) + '…'
              : asText
          }
        } catch {
          /* document reference only */
        }
        return {
          id: attachment.id,
          kind: 'file',
          contentKind: 'document',
          fileRef: abs,
          truncated,
          contextText: excerpt
            ? `### Document: ${attachment.name}\n${excerpt}`
            : `### Document: ${attachment.name} (PDF reference — text extraction limited; treat as attached document)`,
          metadata: {
            mimeType: attachment.mimeType,
            bytes: attachment.bytes,
            extension: ext,
            name: attachment.name,
          },
          capabilityHints: ['research.analyze', 'document.context'],
        }
      }
      throw createAttachmentError({
        category: 'ATTACHMENT_UNSUPPORTED',
        userMessage: `지원하지 않는 파일 형식입니다: .${ext}`,
        technicalSummary: `ext=${ext}`,
      })
    }
    case 'local-folder':
      return {
        id: attachment.id,
        kind: 'local-folder',
        contentKind: 'directory',
        fileRef: attachment.path,
        readOnly: true,
        contextText: `### Reference folder (READ ONLY — do not modify)\nName: ${attachment.displayName}\nPath: ${attachment.path}\nThis is NOT the writable project target.`,
        metadata: {
          path: attachment.path,
          displayName: attachment.displayName,
          access: 'reference',
        },
        capabilityHints: ['code.inspect'],
      }
    case 'github':
      return {
        id: attachment.id,
        kind: 'github',
        contentKind: 'github',
        url: attachment.url,
        contextText: [
          `### GitHub reference (${attachment.githubKind})`,
          `URL: ${attachment.url}`,
          `Owner/Repo: ${attachment.owner}/${attachment.repo}`,
          attachment.number != null ? `Number: ${attachment.number}` : '',
          attachment.ref ? `Ref: ${attachment.ref}` : '',
          attachment.path ? `Path: ${attachment.path}` : '',
          'This is a remote GitHub reference — not a local project path. Do not treat it as the writable workspace.',
        ]
          .filter(Boolean)
          .join('\n'),
        metadata: {
          githubKind: attachment.githubKind,
          owner: attachment.owner,
          repo: attachment.repo,
          number: attachment.number,
          ref: attachment.ref,
          path: attachment.path,
        },
        capabilityHints:
          attachment.githubKind === 'github-repository' ||
          attachment.githubKind === 'github-file' ||
          attachment.githubKind === 'github-directory'
            ? ['code.inspect']
            : ['research.web'],
      }
    case 'web-url':
      return {
        id: attachment.id,
        kind: 'web-url',
        contentKind: 'web',
        url: attachment.url,
        contextText: `### Web URL\n${attachment.title ? `Title: ${attachment.title}\n` : ''}URL: ${attachment.url}\nUse research.web only if the step capability requires it.`,
        metadata: {
          url: attachment.url,
          title: attachment.title,
        },
        capabilityHints: ['research.web'],
      }
    default: {
      const _exhaustive: never = attachment
      throw createAttachmentError({
        category: 'ATTACHMENT_RESOLUTION_FAILED',
        userMessage: '첨부를 해석할 수 없습니다.',
        technicalSummary: String(_exhaustive),
      })
    }
  }
}

export async function resolveMany(
  attachments: WorkAttachment[],
  storage: AttachmentStorage,
  opts?: ResolveOptions,
): Promise<ResolvedAttachment[]> {
  const out: ResolvedAttachment[] = []
  for (const a of attachments) {
    out.push(await resolveAttachment(a, storage, opts))
  }
  return out
}

export function formatAttachmentsContextBlock(
  resolved: ResolvedAttachment[],
  maxChars = 16_000,
): string {
  if (resolved.length === 0) return ''
  const parts = resolved.map((r) => r.contextText ?? `[${r.kind}:${r.id}]`)
  let body = parts.join('\n\n')
  if (body.length > maxChars) {
    body = body.slice(0, maxChars - 1) + '…'
  }
  return body
}

/** Best-effort extract printable text from PDF bytes without OCR. */
function extractPdfishText(buf: Buffer): string {
  const raw = buf.toString('latin1')
  const chunks: string[] = []
  const re = /\((?:\\.|[^\\)]){3,}\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw)) && chunks.join('').length < 20_000) {
    const inner = m[0]
      .slice(1, -1)
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '')
      .replace(/\\t/g, '\t')
      .replace(/\\\(/g, '(')
      .replace(/\\\)/g, ')')
      .replace(/\\\\/g, '\\')
    if (/[A-Za-z가-힣]{3,}/.test(inner)) chunks.push(inner)
  }
  return chunks.join(' ').replace(/\s+/g, ' ').trim()
}

export function attachmentCapabilityHints(
  attachments: WorkAttachment[],
): string[] {
  const set = new Set<string>()
  for (const a of attachments) {
    if (a.kind === 'image') {
      set.add('design.analyze')
      set.add('vision.input')
    } else if (a.kind === 'file') {
      const ext = a.extension.toLowerCase()
      if (['ts', 'tsx', 'js', 'jsx', 'py'].includes(ext)) set.add('code.inspect')
      else if (ext === 'pdf') set.add('research.analyze')
      else set.add('research.analyze')
    } else if (a.kind === 'local-folder') set.add('code.inspect')
    else if (a.kind === 'github') {
      if (
        a.githubKind === 'github-repository' ||
        a.githubKind === 'github-file' ||
        a.githubKind === 'github-directory'
      ) {
        set.add('code.inspect')
      } else set.add('research.web')
    } else if (a.kind === 'web-url') set.add('research.web')
  }
  return [...set]
}

export function summarizeAttachmentsForPlanner(
  attachments: WorkAttachment[],
): string {
  if (attachments.length === 0) return ''
  const counts = {
    images: attachments.filter((a) => a.kind === 'image').length,
    files: attachments.filter((a) => a.kind === 'file').length,
    folders: attachments.filter((a) => a.kind === 'local-folder').length,
    github: attachments.filter((a) => a.kind === 'github').length,
    web: attachments.filter((a) => a.kind === 'web-url').length,
  }
  const bits: string[] = []
  if (counts.images) bits.push(`${counts.images} image(s)`)
  if (counts.files) bits.push(`${counts.files} file(s)`)
  if (counts.folders) bits.push(`${counts.folders} folder reference(s)`)
  if (counts.github) bits.push(`${counts.github} github reference(s)`)
  if (counts.web) bits.push(`${counts.web} web url(s)`)
  return `Attachments present: ${bits.join(', ')}.`
}
