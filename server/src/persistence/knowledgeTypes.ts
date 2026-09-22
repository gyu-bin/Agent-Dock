/**
 * Project Knowledge — Phase K1 domain types.
 * Artifact = work output; Knowledge = confirmed project reference material.
 */

export type KnowledgeCategory =
  | 'product'
  | 'requirement'
  | 'decision'
  | 'design'
  | 'technical'
  | 'game-design'
  | 'constraint'
  | 'research'
  | 'marketing'
  | 'convention'

export type KnowledgeStatus = 'proposed' | 'confirmed' | 'deprecated'

export interface KnowledgeItem {
  id: string
  /** Groups versions of the same logical knowledge entry */
  familyId: string
  projectId: string
  category: KnowledgeCategory
  title: string
  content: string
  status: KnowledgeStatus
  sourceArtifactIds: string[]
  sourceTaskIds: string[]
  /** W1 web source ids (citations) */
  sourceIds: string[]
  createdBy: string
  version: number
  createdAt: string
  updatedAt: string
  /** Optional note when superseded / conflict-resolved */
  note?: string
  /** Ids of knowledge items this version conflicts with (informational) */
  conflictWithIds?: string[]
}

export interface KnowledgeStoreSnapshot {
  version: 1
  projectId: string
  items: KnowledgeItem[]
}

export interface KnowledgeRepository {
  load(projectId: string): Promise<KnowledgeStoreSnapshot>
  save(snapshot: KnowledgeStoreSnapshot): Promise<void>
  listProjectIds(): Promise<string[]>
  deleteProject(projectId: string): Promise<void>
}

export interface KnowledgeConflictCandidate {
  existing: KnowledgeItem
  reason: string
  score: number
}

export const KNOWLEDGE_CATEGORIES: KnowledgeCategory[] = [
  'product',
  'requirement',
  'decision',
  'design',
  'technical',
  'game-design',
  'constraint',
  'research',
  'marketing',
  'convention',
]
