import type { ArtifactType } from './types'

export const ARTIFACT_TYPE_LABEL: Record<ArtifactType, string> = {
  research: '리서치',
  plan: '기획',
  design: '디자인',
  document: '문서',
  'code-change': '코드 변경',
  review: '리뷰',
  verification: '검증',
  report: '보고서',
  'creative-image': '생성 이미지',
  'marketing-performance': '마케팅 성과',
  other: '기타',
}

export const ARTIFACT_FILTERS: Array<{ id: 'all' | ArtifactType; label: string }> = [
  { id: 'all', label: '전체' },
  { id: 'research', label: '리서치' },
  { id: 'plan', label: '기획' },
  { id: 'design', label: '디자인' },
  { id: 'code-change', label: '개발' },
  { id: 'review', label: '리뷰' },
  { id: 'verification', label: '검증' },
  { id: 'report', label: '보고서' },
]

export function artifactIcon(type: ArtifactType): string {
  switch (type) {
    case 'research':
      return '📄'
    case 'plan':
      return '📋'
    case 'design':
      return '🎨'
    case 'code-change':
      return '💻'
    case 'verification':
      return '🧪'
    case 'review':
      return '🔍'
    case 'report':
      return '📊'
    default:
      return '📎'
  }
}
