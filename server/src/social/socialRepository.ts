import { mkdir, readFile, readdir, unlink } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { atomicWriteJson } from '../persistence/atomicWrite.js'
import type { SocialStoreSnapshot } from './types.js'

function defaultDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url))
  return (
    process.env.AGENT_DECK_SOCIAL_DIR ??
    path.resolve(here, '../../data/social')
  )
}

function empty(projectId: string): SocialStoreSnapshot {
  return { version: 1, projectId, posts: [], attempts: [], analytics: [] }
}

function migrate(projectId: string, raw: unknown): SocialStoreSnapshot {
  if (!raw || typeof raw !== 'object') return empty(projectId)
  const obj = raw as Record<string, unknown>
  return {
    version: 1,
    projectId,
    posts: Array.isArray(obj.posts) ? (obj.posts as never) : [],
    attempts: Array.isArray(obj.attempts) ? (obj.attempts as never) : [],
    analytics: Array.isArray(obj.analytics) ? (obj.analytics as never) : [],
  }
}

/**
 * Project-isolated social store.
 * Never persists OAuth tokens / credentials.
 */
export class JsonSocialRepository {
  private chains = new Map<string, Promise<void>>()

  constructor(private readonly dir = defaultDir()) {}

  private fileFor(projectId: string): string {
    const safe = projectId.replace(/[^a-zA-Z0-9_-]/g, '_')
    return path.join(this.dir, `${safe}.json`)
  }

  private enqueue(projectId: string, fn: () => Promise<void>): Promise<void> {
    const prev = this.chains.get(projectId) ?? Promise.resolve()
    const next = prev.then(fn, fn)
    this.chains.set(
      projectId,
      next.then(
        () => undefined,
        () => undefined,
      ),
    )
    return next
  }

  async load(projectId: string): Promise<SocialStoreSnapshot> {
    try {
      const raw = await readFile(this.fileFor(projectId), 'utf8')
      return migrate(projectId, JSON.parse(raw))
    } catch (err) {
      const code =
        err && typeof err === 'object' && 'code' in err
          ? (err as { code?: string }).code
          : ''
      if (code === 'ENOENT') return empty(projectId)
      throw err
    }
  }

  async save(snapshot: SocialStoreSnapshot): Promise<void> {
    await this.enqueue(snapshot.projectId, async () => {
      await mkdir(this.dir, { recursive: true })
      // Explicit shape — no credential fields ever
      await atomicWriteJson(this.fileFor(snapshot.projectId), {
        version: 1,
        projectId: snapshot.projectId,
        posts: snapshot.posts,
        attempts: snapshot.attempts,
        analytics: snapshot.analytics,
      })
    })
  }

  async listProjectIds(): Promise<string[]> {
    try {
      await mkdir(this.dir, { recursive: true })
      const files = await readdir(this.dir)
      return files
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.replace(/\.json$/, ''))
    } catch {
      return []
    }
  }

  async deleteProject(projectId: string): Promise<void> {
    try {
      await unlink(this.fileFor(projectId))
    } catch {
      // ignore
    }
  }
}

export const socialRepository = new JsonSocialRepository()
