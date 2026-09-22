import { mkdir, readFile, writeFile, rename, readdir, unlink } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  ArtifactRepository,
  ArtifactStoreSnapshot,
} from './artifactTypes.js'
import { atomicWriteJson } from './atomicWrite.js'

function defaultDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url))
  return (
    process.env.AGENT_DECK_ARTIFACTS_DIR ??
    path.resolve(here, '../../data/artifacts')
  )
}

function empty(projectId: string): ArtifactStoreSnapshot {
  return {
    version: 1,
    projectId,
    artifacts: [],
    handoffs: [],
  }
}

function migrate(projectId: string, raw: unknown): ArtifactStoreSnapshot {
  if (!raw || typeof raw !== 'object') return empty(projectId)
  const obj = raw as Record<string, unknown>
  return {
    version: 1,
    projectId,
    artifacts: Array.isArray(obj.artifacts)
      ? (obj.artifacts as ArtifactStoreSnapshot['artifacts'])
      : [],
    handoffs: Array.isArray(obj.handoffs)
      ? (obj.handoffs as ArtifactStoreSnapshot['handoffs'])
      : [],
  }
}

/**
 * JSON-per-project artifact store.
 * Swap later for SQLite by implementing ArtifactRepository.
 */
export class JsonArtifactRepository implements ArtifactRepository {
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

  async load(projectId: string): Promise<ArtifactStoreSnapshot> {
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

  async save(snapshot: ArtifactStoreSnapshot): Promise<void> {
    return this.enqueue(snapshot.projectId, async () => {
      await mkdir(this.dir, { recursive: true })
      const file = this.fileFor(snapshot.projectId)
      const payload: ArtifactStoreSnapshot = {
        version: 1,
        projectId: snapshot.projectId,
        artifacts: snapshot.artifacts,
        handoffs: snapshot.handoffs,
      }
      await atomicWriteJson(file, payload)
    })
  }

  async listProjectIds(): Promise<string[]> {
    try {
      const entries = await readdir(this.dir)
      return entries
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.replace(/\.json$/, ''))
    } catch {
      return []
    }
  }

  async deleteProject(projectId: string): Promise<void> {
    return this.enqueue(projectId, async () => {
      try {
        await unlink(this.fileFor(projectId))
      } catch (err) {
        const code =
          err && typeof err === 'object' && 'code' in err
            ? (err as { code?: string }).code
            : ''
        if (code !== 'ENOENT') throw err
      }
    })
  }
}

export const artifactRepository = new JsonArtifactRepository()
