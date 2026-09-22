import { randomUUID } from 'node:crypto'
import type { KnowledgeRepository } from './knowledgeTypes.js'
import type {
  KnowledgeCategory,
  KnowledgeConflictCandidate,
  KnowledgeItem,
  KnowledgeStatus,
  KnowledgeStoreSnapshot,
} from './knowledgeTypes.js'
import { KNOWLEDGE_CATEGORIES } from './knowledgeTypes.js'

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 2),
  )
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  const union = a.size + b.size - inter
  return union === 0 ? 0 : inter / union
}

/**
 * Deterministic conflict detector — replaceable with AI later.
 * Same category + overlapping title/content tokens.
 */
export function detectKnowledgeConflicts(input: {
  items: KnowledgeItem[]
  category: KnowledgeCategory
  title: string
  content: string
  excludeFamilyId?: string
}): KnowledgeConflictCandidate[] {
  const needle = tokenize(`${input.title} ${input.content}`)
  const out: KnowledgeConflictCandidate[] = []
  const latestByFamily = new Map<string, KnowledgeItem>()
  for (const item of input.items) {
    if (item.status === 'deprecated') continue
    if (input.excludeFamilyId && item.familyId === input.excludeFamilyId) continue
    const prev = latestByFamily.get(item.familyId)
    if (!prev || item.version > prev.version) latestByFamily.set(item.familyId, item)
  }

  for (const existing of latestByFamily.values()) {
    if (existing.category !== input.category) continue
    const score = jaccard(needle, tokenize(`${existing.title} ${existing.content}`))
    const titleHit =
      existing.title.trim().toLowerCase() === input.title.trim().toLowerCase()
    if (titleHit || score >= 0.35) {
      out.push({
        existing,
        reason: titleHit
          ? '동일 제목'
          : `내용 유사도 ${(score * 100).toFixed(0)}%`,
        score: titleHit ? 1 : score,
      })
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 5)
}

export class KnowledgeService {
  constructor(private readonly repo: KnowledgeRepository) {}

  private enqueue<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
    // serialize via repo.save chains by wrapping load+mutate+save
    return fn()
  }

  async getStore(projectId: string): Promise<KnowledgeStoreSnapshot> {
    return this.repo.load(projectId)
  }

  async list(input: {
    projectId: string
    category?: KnowledgeCategory
    status?: KnowledgeStatus
    q?: string
    /** When false, return all versions; default latest per family */
    allVersions?: boolean
  }): Promise<KnowledgeItem[]> {
    const store = await this.repo.load(input.projectId)
    let items = store.items
    if (!input.allVersions) {
      const latest = new Map<string, KnowledgeItem>()
      for (const it of items) {
        const prev = latest.get(it.familyId)
        if (!prev || it.version > prev.version) latest.set(it.familyId, it)
      }
      items = [...latest.values()]
    }
    if (input.category) items = items.filter((i) => i.category === input.category)
    if (input.status) items = items.filter((i) => i.status === input.status)
    if (input.q?.trim()) {
      const q = input.q.trim().toLowerCase()
      items = items.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          i.content.toLowerCase().includes(q),
      )
    }
    return items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async get(projectId: string, id: string): Promise<KnowledgeItem | null> {
    const store = await this.repo.load(projectId)
    return store.items.find((i) => i.id === id) ?? null
  }

  async getVersions(
    projectId: string,
    familyId: string,
  ): Promise<KnowledgeItem[]> {
    const store = await this.repo.load(projectId)
    return store.items
      .filter((i) => i.familyId === familyId)
      .sort((a, b) => a.version - b.version)
  }

  async createProposed(input: {
    projectId: string
    category: KnowledgeCategory
    title: string
    content: string
    createdBy: string
    sourceArtifactIds?: string[]
    sourceTaskIds?: string[]
    sourceIds?: string[]
    familyId?: string
  }): Promise<{ item: KnowledgeItem; conflicts: KnowledgeConflictCandidate[] }> {
    if (!KNOWLEDGE_CATEGORIES.includes(input.category)) {
      throw Object.assign(new Error('Invalid knowledge category'), { status: 400 })
    }
    return this.enqueue(input.projectId, async () => {
      const store = await this.repo.load(input.projectId)
      const now = new Date().toISOString()
      const familyId = input.familyId ?? `kfam_${randomUUID().slice(0, 10)}`
      const prior = store.items.filter((i) => i.familyId === familyId)
      const version =
        prior.length === 0 ? 1 : Math.max(...prior.map((i) => i.version)) + 1

      const conflicts = detectKnowledgeConflicts({
        items: store.items,
        category: input.category,
        title: input.title,
        content: input.content,
        excludeFamilyId: familyId,
      })

      const item: KnowledgeItem = {
        id: `kn_${randomUUID().slice(0, 10)}`,
        familyId,
        projectId: input.projectId,
        category: input.category,
        title: input.title.trim() || 'Untitled',
        content: input.content,
        status: 'proposed',
        sourceArtifactIds: input.sourceArtifactIds ?? [],
        sourceTaskIds: input.sourceTaskIds ?? [],
        sourceIds: input.sourceIds ?? [],
        createdBy: input.createdBy,
        version,
        createdAt: now,
        updatedAt: now,
        conflictWithIds: conflicts.map((c) => c.existing.id),
      }
      store.items.push(item)
      await this.repo.save(store)
      return { item, conflicts }
    })
  }

  async confirm(
    projectId: string,
    id: string,
    opts?: { note?: string },
  ): Promise<KnowledgeItem> {
    return this.mutateStatus(projectId, id, 'confirmed', opts?.note)
  }

  async reject(
    projectId: string,
    id: string,
    opts?: { note?: string },
  ): Promise<KnowledgeItem> {
    return this.mutateStatus(projectId, id, 'deprecated', opts?.note ?? '거절됨')
  }

  async confirmWithEdit(input: {
    projectId: string
    id: string
    title?: string
    content?: string
    category?: KnowledgeCategory
    createdBy: string
    resolveConflicts?: 'keep-existing' | 'use-new' | 'keep-both'
  }): Promise<{ item: KnowledgeItem; conflicts: KnowledgeConflictCandidate[] }> {
    const current = await this.get(input.projectId, input.id)
    if (!current) {
      throw Object.assign(new Error('Knowledge not found'), { status: 404 })
    }
    const store = await this.repo.load(input.projectId)
    const title = input.title?.trim() || current.title
    const content = input.content ?? current.content
    const category = input.category ?? current.category

    const conflicts = detectKnowledgeConflicts({
      items: store.items,
      category,
      title,
      content,
      excludeFamilyId: current.familyId,
    })

    if (conflicts.length > 0 && !input.resolveConflicts) {
      return { item: current, conflicts }
    }

    if (input.resolveConflicts === 'keep-existing') {
      // Deprecate the proposed new item; leave existing confirmed
      await this.reject(input.projectId, input.id, {
        note: '충돌 해결: 기존 유지',
      })
      const rejected = await this.get(input.projectId, input.id)
      return { item: rejected!, conflicts: [] }
    }

    if (input.resolveConflicts === 'use-new') {
      for (const c of conflicts) {
        if (c.existing.status === 'confirmed') {
          await this.mutateStatus(
            input.projectId,
            c.existing.id,
            'deprecated',
            '충돌 해결: 새 내용으로 변경',
          )
        }
      }
    }
    // keep-both: confirm new without touching existing

    // New version in same family with edits, then confirm
    const created = await this.createProposed({
      projectId: input.projectId,
      category,
      title,
      content,
      createdBy: input.createdBy,
      familyId: current.familyId,
      sourceArtifactIds: current.sourceArtifactIds,
      sourceTaskIds: current.sourceTaskIds,
      sourceIds: current.sourceIds,
    })
    // Deprecate the edited-from proposed if different id
    if (created.item.id !== current.id && current.status === 'proposed') {
      await this.reject(input.projectId, current.id, {
        note: '수정 후 확정으로 대체',
      })
    }
    const confirmed = await this.confirm(input.projectId, created.item.id)
    return { item: confirmed, conflicts: [] }
  }

  /**
   * Create next version (proposed) from a confirmed item — never overwrite.
   */
  async createVersion(input: {
    projectId: string
    familyId: string
    title?: string
    content: string
    category?: KnowledgeCategory
    createdBy: string
    sourceArtifactIds?: string[]
    sourceTaskIds?: string[]
    sourceIds?: string[]
  }): Promise<{ item: KnowledgeItem; conflicts: KnowledgeConflictCandidate[] }> {
    const versions = await this.getVersions(input.projectId, input.familyId)
    const latest = versions.at(-1)
    if (!latest) {
      throw Object.assign(new Error('Knowledge family not found'), { status: 404 })
    }
    return this.createProposed({
      projectId: input.projectId,
      familyId: input.familyId,
      category: input.category ?? latest.category,
      title: input.title ?? latest.title,
      content: input.content,
      createdBy: input.createdBy,
      sourceArtifactIds: input.sourceArtifactIds ?? latest.sourceArtifactIds,
      sourceTaskIds: input.sourceTaskIds ?? latest.sourceTaskIds,
      sourceIds: input.sourceIds ?? latest.sourceIds,
    })
  }

  private async mutateStatus(
    projectId: string,
    id: string,
    status: KnowledgeStatus,
    note?: string,
  ): Promise<KnowledgeItem> {
    const store = await this.repo.load(projectId)
    const idx = store.items.findIndex((i) => i.id === id)
    if (idx < 0) {
      throw Object.assign(new Error('Knowledge not found'), { status: 404 })
    }
    const now = new Date().toISOString()
    const updated: KnowledgeItem = {
      ...store.items[idx],
      status,
      note: note ?? store.items[idx].note,
      updatedAt: now,
    }
    store.items[idx] = updated
    await this.repo.save(store)
    return updated
  }

  async previewConflicts(input: {
    projectId: string
    category: KnowledgeCategory
    title: string
    content: string
    excludeFamilyId?: string
  }): Promise<KnowledgeConflictCandidate[]> {
    const store = await this.repo.load(input.projectId)
    return detectKnowledgeConflicts({
      items: store.items,
      category: input.category,
      title: input.title,
      content: input.content,
      excludeFamilyId: input.excludeFamilyId,
    })
  }
}
