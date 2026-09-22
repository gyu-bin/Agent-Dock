import { mkdir, readFile, readdir, unlink } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { atomicWriteJson } from '../persistence/atomicWrite.js'
import type {
  MediaDeliveryRecord,
  MediaDeliveryStoreSnapshot,
} from './types.js'

function defaultDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url))
  return (
    process.env.AGENT_DECK_MEDIA_DELIVERY_DIR ??
    path.resolve(here, '../../data/media-delivery')
  )
}

function empty(projectId: string): MediaDeliveryStoreSnapshot {
  return { version: 1, projectId, deliveries: [] }
}

function migrate(
  projectId: string,
  raw: unknown,
): MediaDeliveryStoreSnapshot {
  if (!raw || typeof raw !== 'object') return empty(projectId)
  const obj = raw as Record<string, unknown>
  return {
    version: 1,
    projectId,
    deliveries: Array.isArray(obj.deliveries)
      ? (obj.deliveries as MediaDeliveryRecord[])
      : [],
  }
}

export class JsonMediaDeliveryRepository {
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

  async load(projectId: string): Promise<MediaDeliveryStoreSnapshot> {
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

  async save(snapshot: MediaDeliveryStoreSnapshot): Promise<void> {
    await this.enqueue(snapshot.projectId, async () => {
      await mkdir(this.dir, { recursive: true })
      // Persist metadata only — omit long-lived signed URL fields when possible
      await atomicWriteJson(this.fileFor(snapshot.projectId), {
        version: 1,
        projectId: snapshot.projectId,
        deliveries: snapshot.deliveries.map((d) => ({
          id: d.id,
          projectId: d.projectId,
          artifactId: d.artifactId,
          provider: d.provider,
          remoteKey: d.remoteKey,
          mimeType: d.mimeType,
          bytes: d.bytes,
          createdAt: d.createdAt,
          expiresAt: d.expiresAt,
          status: d.status,
          publishAttemptId: d.publishAttemptId,
          // fake urlHint only — never persist production signed URLs
          urlHint:
            d.provider === 'fake' ? d.urlHint : undefined,
        })),
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

export const mediaDeliveryRepository = new JsonMediaDeliveryRepository()
