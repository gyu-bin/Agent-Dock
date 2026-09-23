/**
 * Client-side GitHub URL classifier (mirrors server — deterministic).
 */

export type GitHubKind =
  | 'github-repository'
  | 'github-issue'
  | 'github-pull-request'
  | 'github-file'
  | 'github-directory'
  | 'github-commit'
  | 'github-other'

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
    url = new URL(raw.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  const host = url.hostname.toLowerCase()
  if (host !== 'github.com' && host !== 'www.github.com') return null
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts.length < 2) return null
  const owner = parts[0]!
  const repo = parts[1]!.replace(/\.git$/i, '')
  const canonical = `https://github.com/${owner}/${repo}`
  if (parts.length === 2) {
    return { url: canonical, githubKind: 'github-repository', owner, repo }
  }
  const section = parts[2]!
  if (section === 'issues' && parts[3] && Number.isFinite(Number(parts[3]))) {
    return {
      url: `${canonical}/issues/${parts[3]}`,
      githubKind: 'github-issue',
      owner,
      repo,
      number: Number(parts[3]),
    }
  }
  if (
    (section === 'pull' || section === 'pulls') &&
    parts[3] &&
    Number.isFinite(Number(parts[3]))
  ) {
    return {
      url: `${canonical}/pull/${parts[3]}`,
      githubKind: 'github-pull-request',
      owner,
      repo,
      number: Number(parts[3]),
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
    return {
      url: url.toString().split('?')[0]!,
      githubKind: 'github-file',
      owner,
      repo,
      ref: parts[3],
      path: parts.slice(4).join('/') || undefined,
    }
  }
  if (section === 'tree' && parts.length >= 4) {
    return {
      url: url.toString().split('?')[0]!,
      githubKind: 'github-directory',
      owner,
      repo,
      ref: parts[3],
      path: parts.slice(4).join('/') || undefined,
    }
  }
  return {
    url: url.toString().split('?')[0]!,
    githubKind: 'github-other',
    owner,
    repo,
  }
}

export function isBlockedUrlScheme(raw: string): boolean {
  try {
    const u = new URL(raw.trim())
    return u.protocol !== 'http:' && u.protocol !== 'https:'
  } catch {
    return true
  }
}
