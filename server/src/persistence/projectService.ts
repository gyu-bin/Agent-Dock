import { randomUUID } from 'node:crypto'
import type {
  ProjectRepository,
  ProjectStoreSnapshot,
  StoredProject,
  StoredTask,
  StoredPipelineStep,
  StoredAgentRun,
  StoredCodexRun,
  ProjectType,
  ProjectStatus,
} from './types.js'
import { hardenError } from '../runtime/hardenErrors.js'

export class ProjectService {
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly repo: ProjectRepository) {}

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn)
    this.queue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  async getSnapshot(): Promise<ProjectStoreSnapshot> {
    return this.enqueue(async () => this.normalize(await this.repo.load()))
  }

  private normalize(snap: ProjectStoreSnapshot): ProjectStoreSnapshot {
    return {
      version: 5,
      revision: snap.revision ?? 0,
      activeProjectId: snap.activeProjectId,
      projects: snap.projects ?? [],
      tasks: snap.tasks ?? [],
      pipelineSteps: snap.pipelineSteps ?? [],
      agentRuns: snap.agentRuns ?? [],
      codexRuns: snap.codexRuns ?? [],
    }
  }

  async setActive(projectId: string | null): Promise<ProjectStoreSnapshot> {
    return this.enqueue(async () => {
      const snap = this.normalize(await this.repo.load())
      if (projectId && !snap.projects.some((p) => p.id === projectId)) {
        throw Object.assign(new Error('Project not found'), { status: 404 })
      }
      snap.activeProjectId = projectId
      snap.revision = (snap.revision ?? 0) + 1
      await this.repo.save(snap)
      return snap
    })
  }

  async create(input: {
    name: string
    type: ProjectType
    path?: string
    agentIds?: string[]
    status?: ProjectStatus
  }): Promise<ProjectStoreSnapshot> {
    return this.enqueue(async () => {
      const snap = this.normalize(await this.repo.load())
      const now = new Date().toISOString()
      const project: StoredProject = {
        id: `proj_${randomUUID().slice(0, 8)}`,
        name: input.name,
        type: input.type,
        path: input.path,
        status: input.status ?? 'active',
        agentIds: input.agentIds ?? [],
        createdAt: now,
        updatedAt: now,
      }
      snap.projects.push(project)
      snap.activeProjectId = project.id
      snap.revision = (snap.revision ?? 0) + 1
      await this.repo.save(snap)
      return snap
    })
  }

  async update(
    id: string,
    patch: Partial<
      Pick<StoredProject, 'name' | 'type' | 'path' | 'status' | 'agentIds' | 'context'>
    >,
  ): Promise<ProjectStoreSnapshot> {
    return this.enqueue(async () => {
      const snap = this.normalize(await this.repo.load())
      const idx = snap.projects.findIndex((p) => p.id === id)
      if (idx < 0) {
        throw Object.assign(new Error('Project not found'), { status: 404 })
      }
      const prev = snap.projects[idx]!
      snap.projects[idx] = {
        ...prev,
        ...patch,
        updatedAt: new Date().toISOString(),
      }
      snap.revision = (snap.revision ?? 0) + 1
      await this.repo.save(snap)
      return snap
    })
  }

  async setTeam(id: string, agentIds: string[]): Promise<ProjectStoreSnapshot> {
    return this.update(id, { agentIds })
  }

  async remove(id: string): Promise<ProjectStoreSnapshot> {
    return this.enqueue(async () => {
      const snap = this.normalize(await this.repo.load())
      snap.projects = snap.projects.filter((p) => p.id !== id)
      snap.tasks = snap.tasks.filter((t) => t.projectId !== id)
      const taskIds = new Set(snap.tasks.map((t) => t.id))
      snap.pipelineSteps = snap.pipelineSteps.filter((s) =>
        taskIds.has(s.taskId),
      )
      snap.agentRuns = snap.agentRuns.filter((r) => taskIds.has(r.taskId))
      snap.codexRuns = (snap.codexRuns ?? []).filter((r) =>
        taskIds.has(r.taskId),
      )
      if (snap.activeProjectId === id) {
        snap.activeProjectId = snap.projects[0]?.id ?? null
      }
      snap.revision = (snap.revision ?? 0) + 1
      await this.repo.save(snap)
      return snap
    })
  }

  /**
   * Recover interrupted work after refresh/restart.
   * Never marks running work as completed.
   */
  async replaceWorkState(input: {
    tasks: StoredTask[]
    pipelineSteps: StoredPipelineStep[]
    agentRuns?: StoredAgentRun[]
    codexRuns?: StoredCodexRun[]
    expectedRevision?: number
  }): Promise<ProjectStoreSnapshot> {
    return this.enqueue(async () => {
      const snap = this.normalize(await this.repo.load())
      this.assertRevision(snap, input.expectedRevision)
      snap.tasks = input.tasks
      snap.pipelineSteps = input.pipelineSteps
      if (input.agentRuns) snap.agentRuns = input.agentRuns
      if (input.codexRuns) snap.codexRuns = input.codexRuns
      for (const t of snap.tasks) {
        if (t.status === 'running' || t.status === 'verifying') {
          t.status = 'interrupted'
          t.updatedAt = new Date().toISOString()
        }
      }
      for (const s of snap.pipelineSteps) {
        if (s.status === 'running' || s.status === 'reviewing') {
          s.status = 'waiting'
        }
      }
      for (const r of snap.agentRuns) {
        if (r.status === 'running') {
          r.status = 'failed'
          r.error = r.error ?? 'Interrupted — not completed'
          r.completedAt = new Date().toISOString()
        }
      }
      for (const r of snap.codexRuns ?? []) {
        if (r.status === 'running' || r.status === 'queued') {
          r.status = 'cancelled'
          r.error = r.error ?? 'Interrupted — process must be cancelled'
          r.completedAt = new Date().toISOString()
        }
      }
      snap.revision = (snap.revision ?? 0) + 1
      await this.repo.save(snap)
      return snap
    })
  }

  async saveWorkState(input: {
    tasks: StoredTask[]
    pipelineSteps: StoredPipelineStep[]
    agentRuns?: StoredAgentRun[]
    codexRuns?: StoredCodexRun[]
    expectedRevision?: number
  }): Promise<ProjectStoreSnapshot> {
    return this.enqueue(async () => {
      const snap = this.normalize(await this.repo.load())
      this.assertRevision(snap, input.expectedRevision)
      snap.tasks = input.tasks
      snap.pipelineSteps = input.pipelineSteps
      if (input.agentRuns) snap.agentRuns = input.agentRuns
      if (input.codexRuns) snap.codexRuns = input.codexRuns
      snap.revision = (snap.revision ?? 0) + 1
      await this.repo.save(snap)
      return snap
    })
  }

  private assertRevision(
    snap: ProjectStoreSnapshot,
    expected?: number,
  ): void {
    if (expected == null) return
    if (expected !== (snap.revision ?? 0)) {
      throw hardenError(
        'PERSISTENCE_CONFLICT',
        `expectedRevision=${expected} current=${snap.revision ?? 0}`,
      )
    }
  }
}
