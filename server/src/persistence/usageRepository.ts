import { mkdir, readFile, writeFile, rename, readdir, unlink } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  UsageRepository,
  UsageStoreSnapshot,
} from './usageTypes.js'
import { atomicWriteJson } from './atomicWrite.js'

function defaultDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url))
  return (
    process.env.AGENT_DECK_USAGE_DIR ??
    path.resolve(here, '../../data/usage')
  )
}

function empty(projectId: string): UsageStoreSnapshot {
  return { version: 1, projectId, executions: [] }
}

function migrate(projectId: string, raw: unknown): UsageStoreSnapshot {
  if (!raw || typeof raw !== 'object') return empty(projectId)
  const obj = raw as Record<string, unknown>
  return {
    version: 1,
    projectId,
    executions: Array.isArray(obj.executions)
      ? (obj.executions as UsageStoreSnapshot['executions'])
      : [],
    budget:
      obj.budget && typeof obj.budget === 'object'
        ? (obj.budget as UsageStoreSnapshot['budget'])
        : undefined,
  }
}

/**
 * JSON-per-project usage / execution store.
 * Swap later for SQLite by implementing UsageRepository.
 */
export class JsonUsageRepository implements UsageRepository {
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

  async load(projectId: string): Promise<UsageStoreSnapshot> {
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

  async save(snapshot: UsageStoreSnapshot): Promise<void> {
    await this.enqueue(snapshot.projectId, async () => {
      await mkdir(this.dir, { recursive: true })
      const file = this.fileFor(snapshot.projectId)
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
      const payload: UsageStoreSnapshot = {
        version: 1,
        projectId: snapshot.projectId,
        executions: snapshot.executions,
        budget: snapshot.budget,
      }
      await atomicWriteJson(file, payload)
    })
  }

  async listProjectIds(): Promise<string[]> {
    try {
      await mkdir(this.dir, { recursive: true })
      const names = await readdir(this.dir)
      return names
        .filter((n) => n.endsWith('.json'))
        .map((n) => n.replace(/\.json$/, ''))
    } catch {
      return []
    }
  }

  async deleteProject(projectId: string): Promise<void> {
    await this.enqueue(projectId, async () => {
      try {
        await unlink(this.fileFor(projectId))
      } catch {
        /* ignore missing */
      }
    })
  }
}

export const usageRepository = new JsonUsageRepository()
