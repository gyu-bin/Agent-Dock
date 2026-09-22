import type { KnowledgeCategory, KnowledgeStatus } from './types'

export const KNOWLEDGE_CATEGORY_LABEL: Record<KnowledgeCategory, string> = {
  product: '제품',
  requirement: '요구사항',
  decision: '결정',
  design: '디자인',
  technical: '기술',
  'game-design': '게임 디자인',
  constraint: '제약',
  research: '리서치',
  marketing: '마케팅',
  convention: '컨벤션',
}

export const KNOWLEDGE_STATUS_LABEL: Record<KnowledgeStatus, string> = {
  proposed: '제안',
  confirmed: '확정',
  deprecated: '폐기',
}

export const KNOWLEDGE_CATEGORY_FILTERS: Array<
  { id: 'all' | KnowledgeCategory; label: string }
> = [
  { id: 'all', label: '전체' },
  ...Object.entries(KNOWLEDGE_CATEGORY_LABEL).map(([id, label]) => ({
    id: id as KnowledgeCategory,
    label,
  })),
]

export const KNOWLEDGE_STATUS_FILTERS: Array<
  { id: 'all' | KnowledgeStatus; label: string }
> = [
  { id: 'all', label: '모든 상태' },
  { id: 'proposed', label: '제안' },
  { id: 'confirmed', label: '확정' },
  { id: 'deprecated', label: '폐기' },
]
