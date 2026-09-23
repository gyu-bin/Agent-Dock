/** Project Artifacts + Structured Handoff — F2 domain types */

export type ArtifactType =
  | 'research'
  | 'plan'
  | 'design'
  | 'document'
  | 'code-change'
  | 'review'
  | 'verification'
  | 'report'
  | 'creative-image'
  | 'marketing-performance'
  | 'other'

export type ArtifactContentType = 'markdown' | 'text' | 'json' | 'diff'

/** draft = pending approval; final = approved/reusable; rejected = not confirmed */
export type ArtifactStatus = 'draft' | 'final' | 'rejected'

export interface Artifact {
  id: string
  /** Groups versions of the same logical deliverable */
  familyId: string
  projectId: string
  taskId?: string
  stepId?: string
  agentId?: string
  type: ArtifactType
  title: string
  summary: string
  contentType: ArtifactContentType
  content: string
  version: number
  status: ArtifactStatus
  /** Codex run / metadata refs */
  metadata?: Record<string, unknown>
  /** Optional web sources for research citations (W1) */
  sources?: WebSource[]
  searchedAt?: string
  /** Work attachments that informed this artifact */
  sourceAttachmentIds?: string[]
  createdAt: string
  updatedAt: string
}

export interface WebSource {
  id: string
  title: string
  url: string
  domain: string
  publishedAt?: string
  snippet?: string
  quality?: string
}

export interface AgentHandoff {
  id: string
  projectId: string
  taskId: string
  fromAgentId: string
  toAgentId: string
  fromStepId?: string
  toStepId?: string
  summary: string
  decisions: string[]
  openQuestions: string[]
  risks: string[]
  artifactIds: string[]
  /** Prefer research artifacts over raw search dumps (W1) */
  relevantArtifactIds?: string[]
  relevantSourceIds?: string[]
  /** Work attachments carried across agent handoff */
  relevantAttachmentIds?: string[]
  createdAt: string
}

export interface ProjectContext {
  description?: string
  goals?: string
  constraints?: string
  techStack?: string
  githubUrl?: string
  toolPolicy?: {
    openai?: 'inherit' | 'enabled' | 'disabled'
    codex?: 'inherit' | 'enabled' | 'disabled'
    webSearch?: 'inherit' | 'enabled' | 'disabled'
    image?: 'inherit' | 'enabled' | 'disabled'
    buffer?: 'inherit' | 'enabled' | 'disabled'
  }
}

export interface ArtifactStoreSnapshot {
  version: 1
  projectId: string
  artifacts: Artifact[]
  handoffs: AgentHandoff[]
}

export interface ArtifactRepository {
  load(projectId: string): Promise<ArtifactStoreSnapshot>
  save(snapshot: ArtifactStoreSnapshot): Promise<void>
  listProjectIds(): Promise<string[]>
  deleteProject(projectId: string): Promise<void>
}
