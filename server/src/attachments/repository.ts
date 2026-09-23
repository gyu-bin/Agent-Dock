import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AttachmentStoreSnapshot, WorkAttachment } from './types.js'

function defaultDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url))
  return (
    process.env.AGENT_DECK_ATTACHMENTS_META_DIR ??
    path.resolve(here, '../../data/attachments-meta')
  )
}

function empty(projectId: string): AttachmentStoreSnapshot {
  return { version: 1, projectId, attachments: [] }
}

function parse(raw: string, projectId: string): AttachmentStoreSnapshot {
  try {
    const obj = JSON.parse(raw) as Partial<AttachmentStoreSnapshot>
    return {
      version: 1,
      projectId,
      attachments: Array.isArray(obj.attachments)
        ? (obj.attachments as WorkAttachment[])
        : [],
    }
  } catch {
    return empty(projectId)
  }
}

export class JsonAttachmentRepository {
  constructor(private readonly dir = defaultDir()) {}

  private filePath(projectId: string): string {
    const safe = projectId.replace(/[^a-zA-Z0-9_-]/g, '_') || 'unknown'
    return path.join(this.dir, `${safe}.json`)
  }

  async load(projectId: string): Promise<AttachmentStoreSnapshot> {
    await mkdir(this.dir, { recursive: true })
    try {
      const raw = await readFile(this.filePath(projectId), 'utf8')
      return parse(raw, projectId)
    } catch {
      return empty(projectId)
    }
  }

  async save(snapshot: AttachmentStoreSnapshot): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    const target = this.filePath(snapshot.projectId)
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`
    await writeFile(tmp, JSON.stringify(snapshot, null, 2), 'utf8')
    await rename(tmp, target)
  }

  async listProjectIds(): Promise<string[]> {
    const { readdir } = await import('node:fs/promises')
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
}

export const attachmentRepository = new JsonAttachmentRepository()
