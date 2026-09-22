import { randomUUID } from 'node:crypto'
import type { ArtifactRepository } from './artifactTypes.js'
import type {
  AgentHandoff,
  Artifact,
  ArtifactContentType,
  ArtifactStatus,
  ArtifactStoreSnapshot,
  ArtifactType,
} from './artifactTypes.js'

export class ArtifactService {
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly repo: ArtifactRepository) {}

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn)
    this.queue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  async getStore(projectId: string): Promise<ArtifactStoreSnapshot> {
    return this.enqueue(() => this.repo.load(projectId))
  }

  async listArtifacts(
    projectId: string,
    opts?: { taskId?: string; type?: ArtifactType; latestOnly?: boolean },
  ): Promise<Artifact[]> {
    const store = await this.getStore(projectId)
    let list = store.artifacts.filter((a) => a.status !== 'rejected')
    if (opts?.taskId) list = list.filter((a) => a.taskId === opts.taskId)
    if (opts?.type) list = list.filter((a) => a.type === opts.type)
    if (opts?.latestOnly !== false) {
      const byFamily = new Map<string, Artifact>()
      for (const a of list) {
        const prev = byFamily.get(a.familyId)
        if (!prev || a.version > prev.version) byFamily.set(a.familyId, a)
      }
      list = [...byFamily.values()]
    }
    return list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async getArtifact(
    projectId: string,
    artifactId: string,
  ): Promise<Artifact | null> {
    const store = await this.getStore(projectId)
    return store.artifacts.find((a) => a.id === artifactId) ?? null
  }

  async getVersions(
    projectId: string,
    familyId: string,
  ): Promise<Artifact[]> {
    const store = await this.getStore(projectId)
    return store.artifacts
      .filter((a) => a.familyId === familyId)
      .sort((a, b) => a.version - b.version)
  }

  async createArtifact(input: {
    projectId: string
    taskId?: string
    stepId?: string
    agentId?: string
    type: ArtifactType
    title: string
    summary: string
    contentType?: ArtifactContentType
    content: string
    status?: ArtifactStatus
    familyId?: string
    metadata?: Record<string, unknown>
    sources?: Artifact['sources']
    searchedAt?: string
  }): Promise<Artifact> {
    return this.enqueue(async () => {
      const store = await this.repo.load(input.projectId)
      const now = new Date().toISOString()
      const familyId = input.familyId ?? `fam_${randomUUID().slice(0, 10)}`
      const prior = store.artifacts.filter((a) => a.familyId === familyId)
      const version =
        prior.length === 0
          ? 1
          : Math.max(...prior.map((a) => a.version)) + 1

      const artifact: Artifact = {
        id: `art_${randomUUID().slice(0, 10)}`,
        familyId,
        projectId: input.projectId,
        taskId: input.taskId,
        stepId: input.stepId,
        agentId: input.agentId,
        type: input.type,
        title: input.title.trim() || 'Untitled',
        summary: input.summary.slice(0, 500),
        contentType: input.contentType ?? 'markdown',
        content: input.content,
        version,
        status: input.status ?? 'final',
        metadata: input.metadata,
        sources: input.sources,
        searchedAt: input.searchedAt,
        createdAt: now,
        updatedAt: now,
      }
      store.artifacts.push(artifact)
      await this.repo.save(store)
      return artifact
    })
  }

  /** Create next version of an existing family (keeps v1..n). */
  async createVersion(
    projectId: string,
    familyId: string,
    patch: {
      title?: string
      summary?: string
      content: string
      contentType?: ArtifactContentType
      agentId?: string
      taskId?: string
      stepId?: string
      status?: ArtifactStatus
      metadata?: Record<string, unknown>
    },
  ): Promise<Artifact> {
    const versions = await this.getVersions(projectId, familyId)
    const latest = versions.at(-1)
    if (!latest) {
      throw Object.assign(new Error('Artifact family not found'), { status: 404 })
    }
    return this.createArtifact({
      projectId,
      familyId,
      type: latest.type,
      title: patch.title ?? latest.title,
      summary: patch.summary ?? latest.summary,
      content: patch.content,
      contentType: patch.contentType ?? latest.contentType,
      agentId: patch.agentId ?? latest.agentId,
      taskId: patch.taskId ?? latest.taskId,
      stepId: patch.stepId,
      status: patch.status ?? 'final',
      metadata: { ...latest.metadata, ...patch.metadata },
    })
  }

  async updateStatus(
    projectId: string,
    artifactId: string,
    status: ArtifactStatus,
  ): Promise<Artifact> {
    return this.enqueue(async () => {
      const store = await this.repo.load(projectId)
      const idx = store.artifacts.findIndex((a) => a.id === artifactId)
      if (idx < 0) {
        throw Object.assign(new Error('Artifact not found'), { status: 404 })
      }
      const now = new Date().toISOString()
      store.artifacts[idx] = {
        ...store.artifacts[idx],
        status,
        updatedAt: now,
      }
      await this.repo.save(store)
      return store.artifacts[idx]
    })
  }

  async createHandoff(
    input: Omit<AgentHandoff, 'id' | 'createdAt'> & { id?: string },
  ): Promise<AgentHandoff> {
    return this.enqueue(async () => {
      const store = await this.repo.load(input.projectId)
      const handoff: AgentHandoff = {
        id: input.id ?? `ho_${randomUUID().slice(0, 10)}`,
        projectId: input.projectId,
        taskId: input.taskId,
        fromAgentId: input.fromAgentId,
        toAgentId: input.toAgentId,
        fromStepId: input.fromStepId,
        toStepId: input.toStepId,
        summary: input.summary.slice(0, 1200),
        decisions: input.decisions.slice(0, 12),
        openQuestions: input.openQuestions.slice(0, 12),
        risks: input.risks.slice(0, 12),
        artifactIds: input.artifactIds,
        relevantArtifactIds: input.relevantArtifactIds,
        relevantSourceIds: input.relevantSourceIds,
        createdAt: new Date().toISOString(),
      }
      store.handoffs.push(handoff)
      await this.repo.save(store)
      return handoff
    })
  }

  async listHandoffs(
    projectId: string,
    opts?: { taskId?: string },
  ): Promise<AgentHandoff[]> {
    const store = await this.getStore(projectId)
    let list = store.handoffs
    if (opts?.taskId) list = list.filter((h) => h.taskId === opts.taskId)
    return list.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  async deleteProject(projectId: string): Promise<void> {
    return this.enqueue(() => this.repo.deleteProject(projectId))
  }
}
