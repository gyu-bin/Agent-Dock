import { mkdir, readFile, readdir, unlink } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { atomicWriteJson } from './atomicWrite.js'
import type {
  OperationsRepository,
  OperationsStoreSnapshot,
} from './operationsTypes.js'

function defaultDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url))
  return (
    process.env.AGENT_DECK_OPERATIONS_DIR ??
    path.resolve(here, '../../data/operations')
  )
}

function empty(projectId: string): OperationsStoreSnapshot {
  return { version: 1, projectId, goals: [], routines: [], runs: [] }
}

function migrate(projectId: string, raw: unknown): OperationsStoreSnapshot {
  if (!raw || typeof raw !== 'object') return empty(projectId)
  const obj = raw as Record<string, unknown>
  return {
    version: 1,
    projectId,
    goals: Array.isArray(obj.goals) ? (obj.goals as never) : [],
    routines: Array.isArray(obj.routines) ? (obj.routines as never) : [],
    runs: Array.isArray(obj.runs) ? (obj.runs as never) : [],
    stage: typeof obj.stage === 'string' ? (obj.stage as never) : undefined,
  }
}

export class JsonOperationsRepository implements OperationsRepository {
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

  async load(projectId: string): Promise<OperationsStoreSnapshot> {
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

  async save(snapshot: OperationsStoreSnapshot): Promise<void> {
    await this.enqueue(snapshot.projectId, async () => {
      await mkdir(this.dir, { recursive: true })
      await atomicWriteJson(this.fileFor(snapshot.projectId), {
        version: 1,
        projectId: snapshot.projectId,
        goals: snapshot.goals,
        routines: snapshot.routines,
        runs: snapshot.runs,
        stage: snapshot.stage,
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
    } catch (err) {
      const code =
        err && typeof err === 'object' && 'code' in err
          ? (err as { code?: string }).code
          : ''
      if (code !== 'ENOENT') throw err
    }
  }
}

export const operationsRepository = new JsonOperationsRepository()
