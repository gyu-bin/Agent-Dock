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
    const attempt = async () => {
      for (let retries = 0; ; retries++) {
        try { return await fn() }
        catch (error) {
          if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'PROJECT_CAS_CONFLICT' || retries >= 4) throw error
        }
      }
    }
    const run = this.queue.then(attempt, attempt)
    this.queue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  /** Call only after the API verifies that the authenticated account is the single allowlisted owner. */
  async claimLegacy(ownerId: string): Promise<ProjectStoreSnapshot> {
    if (!ownerId) throw Object.assign(new Error('An authenticated project owner is required.'), { status: 401 })
    return this.enqueue(async () => {
      const snap = this.normalize(await this.repo.load())
      let changed = false
      snap.projects = snap.projects.map((project) => {
        if (project.ownerId) return project
        changed = true
        return { ...project, ownerId, updatedAt: new Date().toISOString() }
      })
      if (changed) {
        snap.revision = (snap.revision ?? 0) + 1
        await this.repo.save(snap)
      }
      return snap
    })
  }

  async getSnapshot(): Promise<ProjectStoreSnapshot> {
    return this.enqueue(async () => this.normalize(await this.repo.load()))
  }

  private normalize(snap: ProjectStoreSnapshot): ProjectStoreSnapshot {
    return {
      version: 5,
      revision: snap.revision ?? 0,
      activeProjectId: snap.activeProjectId,
      projects: (snap.projects ?? []).map(p => ({ ...p, sourceType: p.sourceType ?? (p.repository ? 'github' : 'local') })),
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
    sourceType?: 'local' | 'github'
    repository?: StoredProject['repository']
    ownerId?: string
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
        sourceType: input.sourceType ?? (input.repository ? 'github' : 'local'),
        repository: input.repository,
        ownerId: input.ownerId,
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
   * Delete one finished task with its steps and runs. In-flight tasks must be
   * cancelled first so a live execution never loses its records mid-run.
   */
  async removeTask(projectId: string, taskId: string): Promise<ProjectStoreSnapshot> {
    return this.enqueue(async () => {
      const snap = this.normalize(await this.repo.load())
      const task = snap.tasks.find((t) => t.id === taskId && t.projectId === projectId)
      if (!task) throw Object.assign(new Error('작업을 찾을 수 없습니다.'), { status: 404, code: 'TASK_NOT_FOUND' })
      const terminal = ['completed', 'failed', 'cancelled', 'rejected', 'interrupted']
      if (!terminal.includes(task.status)) {
        throw Object.assign(new Error('진행 중인 작업은 먼저 중단한 뒤 삭제할 수 있습니다.'), { status: 409, code: 'TASK_NOT_TERMINAL' })
      }
      snap.tasks = snap.tasks.filter((t) => t.id !== taskId)
      snap.pipelineSteps = snap.pipelineSteps.filter((s) => s.taskId !== taskId)
      snap.agentRuns = snap.agentRuns.filter((r) => r.taskId !== taskId)
      snap.codexRuns = (snap.codexRuns ?? []).filter((r) => r.taskId !== taskId)
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
    ownerId?: string
  }): Promise<ProjectStoreSnapshot> {
    return this.enqueue(async () => {
      const snap = this.normalize(await this.repo.load())
      this.assertRevision(snap, input.expectedRevision)
      const scopedIds = this.applyWorkState(snap, input)
      for (const t of snap.tasks) {
        if (scopedIds && !scopedIds.has(t.id)) continue
        if (t.status === 'running' || t.status === 'verifying') {
          t.status = 'interrupted'
          t.updatedAt = new Date().toISOString()
        }
      }
      for (const s of snap.pipelineSteps) {
        if (scopedIds && !scopedIds.has(s.taskId)) continue
        if (s.status === 'running' || s.status === 'reviewing') {
          s.status = 'waiting'
        }
      }
      for (const r of snap.agentRuns) {
        if (scopedIds && !scopedIds.has(r.taskId)) continue
        if (r.status === 'running') {
          r.status = 'failed'
          r.error = r.error ?? 'Interrupted — not completed'
          r.completedAt = new Date().toISOString()
        }
      }
      for (const r of snap.codexRuns ?? []) {
        if (scopedIds && !scopedIds.has(r.taskId)) continue
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
    ownerId?: string
  }): Promise<ProjectStoreSnapshot> {
    return this.enqueue(async () => {
      const snap = this.normalize(await this.repo.load())
      this.assertRevision(snap, input.expectedRevision)
      this.applyWorkState(snap, input)
      snap.revision = (snap.revision ?? 0) + 1
      await this.repo.save(snap)
      return snap
    })
  }

  private applyWorkState(snap: ProjectStoreSnapshot, input: {
    tasks: StoredTask[]; pipelineSteps: StoredPipelineStep[]; agentRuns?: StoredAgentRun[]; codexRuns?: StoredCodexRun[]; ownerId?: string
  }): Set<string> | undefined {
    if (!input.ownerId) {
      snap.tasks = input.tasks
      snap.pipelineSteps = input.pipelineSteps
      if (input.agentRuns) snap.agentRuns = input.agentRuns
      if (input.codexRuns) snap.codexRuns = input.codexRuns
      return undefined
    }
    const ownedProjects = new Set(snap.projects.filter((project) => project.ownerId === input.ownerId).map((project) => project.id))
    const otherTasks = snap.tasks.filter((task) => !ownedProjects.has(task.projectId))
    const otherIds = new Set(otherTasks.map((task) => task.id))
    const incomingIds = new Set(input.tasks.map((task) => task?.id))
    const deny = () => { throw Object.assign(new Error('Work state must belong to your projects.'), { status: 403, code: 'PROJECT_ACCESS_DENIED' }) }
    if (input.tasks.some((task) => !task || typeof task.id !== 'string' || !ownedProjects.has(task.projectId) || otherIds.has(task.id))) deny()
    if ([...input.pipelineSteps, ...(input.agentRuns ?? []), ...(input.codexRuns ?? [])].some((item) => !item || typeof item.id !== 'string' || !incomingIds.has(item.taskId))) deny()
    // Record IDs also cannot collide with another owner's step or run.
    for (const [existing, incoming] of [
      [snap.pipelineSteps, input.pipelineSteps], [snap.agentRuns, input.agentRuns ?? []], [snap.codexRuns ?? [], input.codexRuns ?? []],
    ] as const) {
      const protectedIds = new Set(existing.filter((item) => otherIds.has(item.taskId)).map((item) => item.id))
      if (incoming.some((item) => protectedIds.has(item.id))) deny()
    }
    snap.tasks = [...otherTasks, ...input.tasks]
    snap.pipelineSteps = [...snap.pipelineSteps.filter((item) => otherIds.has(item.taskId)), ...input.pipelineSteps]
    if (input.agentRuns) snap.agentRuns = [...snap.agentRuns.filter((item) => otherIds.has(item.taskId)), ...input.agentRuns]
    if (input.codexRuns) snap.codexRuns = [...(snap.codexRuns ?? []).filter((item) => otherIds.has(item.taskId)), ...input.codexRuns]
    return incomingIds
  }

  /** Append tasks/steps without replacing the whole work-state (scheduler). */
  async appendWork(input: {
    tasks?: StoredTask[]
    pipelineSteps?: StoredPipelineStep[]
  }): Promise<ProjectStoreSnapshot> {
    return this.enqueue(async () => {
      const snap = this.normalize(await this.repo.load())
      if (input.tasks?.length) {
        const existing = new Set(snap.tasks.map((t) => t.id))
        for (const t of input.tasks) {
          if (!existing.has(t.id)) snap.tasks.push(t)
        }
      }
      if (input.pipelineSteps?.length) {
        const existing = new Set(snap.pipelineSteps.map((s) => s.id))
        for (const s of input.pipelineSteps) {
          if (!existing.has(s.id)) snap.pipelineSteps.push(s)
        }
      }
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
