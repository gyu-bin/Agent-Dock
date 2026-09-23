/**
 * Deterministic GitHub URL classifier.
 */

import type { GitHubKind } from './types.js'
import { assertSafeHttpUrl } from './urlSecurity.js'
import { createAttachmentError } from './errors.js'

export interface ParsedGitHubUrl {
  url: string
  githubKind: GitHubKind
  owner: string
  repo: string
  number?: number
  ref?: string
  path?: string
}

export function parseGitHubUrl(raw: string): ParsedGitHubUrl | null {
  let url: URL
  try {
    url = assertSafeHttpUrl(raw)
  } catch {
    return null
  }
  const host = url.hostname.toLowerCase()
  if (host !== 'github.com' && host !== 'www.github.com') return null

  const parts = url.pathname.split('/').filter(Boolean)
  if (parts.length < 2) return null
  const owner = parts[0]!
  const repo = parts[1]!.replace(/\.git$/i, '')
  const canonical = `https://github.com/${owner}/${repo}`

  if (parts.length === 2) {
    return {
      url: canonical,
      githubKind: 'github-repository',
      owner,
      repo,
    }
  }

  const section = parts[2]!
  if (section === 'issues' && parts[3]) {
    const n = Number(parts[3])
    if (Number.isFinite(n)) {
      return {
        url: `${canonical}/issues/${n}`,
        githubKind: 'github-issue',
        owner,
        repo,
        number: n,
      }
    }
  }
  if ((section === 'pull' || section === 'pulls') && parts[3]) {
    const n = Number(parts[3])
    if (Number.isFinite(n)) {
      return {
        url: `${canonical}/pull/${n}`,
        githubKind: 'github-pull-request',
        owner,
        repo,
        number: n,
      }
    }
  }
  if (section === 'commit' && parts[3]) {
    return {
      url: `${canonical}/commit/${parts[3]}`,
      githubKind: 'github-commit',
      owner,
      repo,
      ref: parts[3],
    }
  }
  if (section === 'blob' && parts.length >= 4) {
    const ref = parts[3]!
    const filePath = parts.slice(4).join('/')
    return {
      url: url.toString().split('?')[0]!,
      githubKind: 'github-file',
      owner,
      repo,
      ref,
      path: filePath || undefined,
    }
  }
  if (section === 'tree' && parts.length >= 4) {
    const ref = parts[3]!
    const dirPath = parts.slice(4).join('/')
    return {
      url: url.toString().split('?')[0]!,
      githubKind: 'github-directory',
      owner,
      repo,
      ref,
      path: dirPath || undefined,
    }
  }

  return {
    url: url.toString().split('?')[0]!,
    githubKind: 'github-other',
    owner,
    repo,
  }
}

export function classifyUrlAttachment(raw: string): {
  kind: 'github' | 'web-url'
  github?: ParsedGitHubUrl
  url: string
} {
  const gh = parseGitHubUrl(raw)
  if (gh) return { kind: 'github', github: gh, url: gh.url }
  const url = assertSafeHttpUrl(raw)
  return { kind: 'web-url', url: url.toString() }
}

/** Detect first http(s) URL in free text (composer helper). */
export function detectUrlsInText(text: string): string[] {
  const re = /https?:\/\/[^\s<>"')\]]+/gi
  const found = text.match(re) ?? []
  return [...new Set(found.map((u) => u.replace(/[.,;:]+$/, '')))]
}

export function requireGitHubParse(raw: string): ParsedGitHubUrl {
  const parsed = parseGitHubUrl(raw)
  if (!parsed) {
    throw createAttachmentError({
      category: 'ATTACHMENT_INVALID_URL',
      userMessage: 'GitHub URL을 해석할 수 없습니다.',
      technicalSummary: 'not a github url',
    })
  }
  return parsed
}
