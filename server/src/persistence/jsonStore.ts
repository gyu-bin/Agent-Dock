import { mkdir, readFile } from '../storage/dataFs.js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ProjectRepository, ProjectStoreSnapshot } from './types.js'
import { atomicWriteJson } from './atomicWrite.js'
import { isCloudRuntime } from '../loadEnv.js'

export class ProjectCasConflict extends Error {
  readonly code = 'PROJECT_CAS_CONFLICT'
  readonly status = 409
  constructor() { super('Project data changed in another server instance. Retry the operation.'); this.name = 'ProjectCasConflict' }
}

const EMPTY: ProjectStoreSnapshot = {
  version: 5,
  revision: 0,
  activeProjectId: null,
  projects: [],
  tasks: [],
  pipelineSteps: [],
  agentRuns: [],
  codexRuns: [],
}

function defaultDataPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url))
  return (
    process.env.AGENT_DECK_DATA_FILE ??
    path.resolve(here, '../../data/projects.json')
  )
}

function migrate(raw: unknown): ProjectStoreSnapshot {
  if (!raw || typeof raw !== 'object') return structuredClone(EMPTY)
  const obj = raw as Record<string, unknown>
  const projects = Array.isArray(obj.projects) ? obj.projects : []
  return {
    version: 5,
    revision:
      typeof obj.revision === 'number' && Number.isFinite(obj.revision)
        ? Math.max(0, Math.floor(obj.revision))
        : 0,
    activeProjectId:
      typeof obj.activeProjectId === 'string' || obj.activeProjectId === null
        ? (obj.activeProjectId as string | null)
        : null,
    projects: projects as ProjectStoreSnapshot['projects'],
    tasks: Array.isArray(obj.tasks)
      ? (obj.tasks as ProjectStoreSnapshot['tasks'])
      : [],
    pipelineSteps: Array.isArray(obj.pipelineSteps)
      ? (obj.pipelineSteps as ProjectStoreSnapshot['pipelineSteps'])
      : [],
    agentRuns: Array.isArray(obj.agentRuns)
      ? (obj.agentRuns as ProjectStoreSnapshot['agentRuns'])
      : [],
    codexRuns: Array.isArray(obj.codexRuns)
      ? (obj.codexRuns as ProjectStoreSnapshot['codexRuns'])
      : [],
  }
}

/** Recover first complete JSON object if file was corrupted by concurrent writes. */
function parseJsonLenient(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    const start = raw.indexOf('{')
    if (start < 0) throw new Error('Invalid projects.json')
    let depth = 0
    let inStr = false
    let esc = false
    for (let i = start; i < raw.length; i++) {
      const ch = raw[i]
      if (inStr) {
        if (esc) esc = false
        else if (ch === '\\') esc = true
        else if (ch === '"') inStr = false
        continue
      }
      if (ch === '"') inStr = true
      else if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) return JSON.parse(raw.slice(start, i + 1))
      }
    }
    throw new Error('Unclosed JSON in projects.json')
  }
}

export class JsonProjectRepository implements ProjectRepository {
  private writeChain: Promise<void> = Promise.resolve()

  constructor(private readonly filePath = defaultDataPath()) {}

  async load(): Promise<ProjectStoreSnapshot> {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      return migrate(parseJsonLenient(raw))
    } catch (err) {
      const code =
        err && typeof err === 'object' && 'code' in err
          ? (err as { code?: string }).code
          : ''
      if (code === 'ENOENT') return structuredClone(EMPTY)
      throw err
    }
  }

  async save(snapshot: ProjectStoreSnapshot): Promise<void> {
    const run = async () => {
      const payload: ProjectStoreSnapshot = {
        version: 5,
        revision: snapshot.revision ?? 0,
        activeProjectId: snapshot.activeProjectId,
        projects: snapshot.projects,
        tasks: snapshot.tasks,
        pipelineSteps: snapshot.pipelineSteps,
        agentRuns: snapshot.agentRuns ?? [],
        codexRuns: snapshot.codexRuns ?? [],
      }
      if (isCloudRuntime()) await this.saveCloud(payload)
      else await atomicWriteJson(this.filePath, payload)
    }
    this.writeChain = this.writeChain.then(run, run)
    return this.writeChain
  }

  private async saveCloud(payload: ProjectStoreSnapshot): Promise<void> {
    const base = process.env.SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    const root = path.resolve(process.env.AGENT_DECK_CLOUD_ROOT ?? '/tmp/agent-deck')
    const relative = path.relative(root, path.resolve(this.filePath)).split(path.sep).join('/')
    if (!base || !key || relative !== 'projects.json') throw Object.assign(new Error('Supabase project storage is required with its canonical projects.json path.'), { code: 'PROJECT_STORAGE_NOT_CONFIGURED', status: 503 })
    const headers: Record<string, string> = { apikey: key, 'Content-Type': 'application/json' }
    if (!key.startsWith('sb_')) headers.Authorization = `Bearer ${key}`
    let committed: unknown
    try {
      const response = await fetch(`${base.replace(/\/$/, '')}/rest/v1/rpc/project_snapshot_compare_and_set`, {
        method: 'POST', headers,
        body: JSON.stringify({ p_expected_revision: Math.max(0, (payload.revision ?? 0) - 1), p_content: JSON.stringify(payload) }),
        signal: AbortSignal.timeout(10000),
      })
      if (!response.ok) throw new Error('Project RPC unavailable')
      committed = await response.json()
      if (typeof committed !== 'boolean') throw new Error('Invalid project RPC response')
    } catch {
      throw Object.assign(new Error('Supabase project persistence or its CAS migration is unavailable.'), { code: 'PROJECT_STORAGE_UNAVAILABLE', status: 503 })
    }
    if (committed !== true) throw new ProjectCasConflict()
  }
}

export const projectRepository = new JsonProjectRepository()
