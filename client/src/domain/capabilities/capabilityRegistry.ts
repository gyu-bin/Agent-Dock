import type {
  AgentCapability,
  CapabilityDefinition,
} from './capabilityTypes'

/** Stable vocabulary (~22). Do not invent per-agent ad-hoc ids. */
export const CAPABILITY_DEFINITIONS: CapabilityDefinition[] = [
  {
    id: 'project.plan',
    category: 'project',
    risk: 'read',
    requiresApproval: false,
    status: 'active',
    label: '프로젝트 기획',
  },
  {
    id: 'research.web',
    category: 'research',
    risk: 'read',
    requiresApproval: false,
    status: 'active',
    label: '웹 조사',
  },
  {
    id: 'research.analyze',
    category: 'research',
    risk: 'read',
    requiresApproval: false,
    status: 'active',
    label: '조사 분석',
  },
  {
    id: 'research.synthesize',
    category: 'research',
    risk: 'read',
    requiresApproval: false,
    status: 'active',
    label: '조사 종합',
  },
  {
    id: 'code.inspect',
    category: 'code',
    risk: 'read',
    requiresApproval: false,
    status: 'active',
    label: '코드 조사',
  },
  {
    id: 'code.write',
    category: 'code',
    risk: 'write',
    requiresApproval: false,
    status: 'active',
    label: '코드 작성',
  },
  {
    id: 'code.test',
    category: 'code',
    risk: 'write',
    requiresApproval: false,
    status: 'active',
    label: '코드 테스트',
  },
  {
    id: 'code.review',
    category: 'code',
    risk: 'read',
    requiresApproval: false,
    status: 'active',
    label: '코드 리뷰',
  },
  {
    id: 'design.analyze',
    category: 'design',
    risk: 'read',
    requiresApproval: false,
    status: 'active',
    label: '디자인 분석',
  },
  {
    id: 'design.ui',
    category: 'design',
    risk: 'read',
    requiresApproval: false,
    status: 'active',
    label: 'UI 설계',
  },
  {
    id: 'design.asset',
    category: 'design',
    risk: 'write',
    requiresApproval: false,
    status: 'active',
    label: '디자인 에셋',
  },
  {
    id: 'image.generate',
    category: 'creative',
    risk: 'write',
    requiresApproval: false,
    status: 'active',
    label: '이미지 생성',
  },
  {
    id: 'video.generate',
    category: 'creative',
    risk: 'write',
    requiresApproval: false,
    status: 'future',
    label: '영상 생성',
  },
  {
    id: 'qa.test',
    category: 'qa',
    risk: 'read',
    requiresApproval: false,
    status: 'active',
    label: 'QA 테스트',
  },
  {
    id: 'qa.verify',
    category: 'qa',
    risk: 'read',
    requiresApproval: false,
    status: 'active',
    label: 'QA 검증',
  },
  {
    id: 'content.write',
    category: 'content',
    risk: 'read',
    requiresApproval: false,
    status: 'active',
    label: '콘텐츠 작성',
  },
  {
    id: 'marketing.research',
    category: 'marketing',
    risk: 'read',
    requiresApproval: false,
    status: 'active',
    label: '마케팅 조사',
  },
  {
    id: 'marketing.plan',
    category: 'marketing',
    risk: 'read',
    requiresApproval: false,
    status: 'active',
    label: '마케팅 기획',
  },
  {
    id: 'marketing.content',
    category: 'marketing',
    risk: 'read',
    requiresApproval: false,
    status: 'active',
    label: '마케팅 콘텐츠',
  },
  {
    id: 'analytics.read',
    category: 'analytics',
    risk: 'read',
    requiresApproval: false,
    status: 'active',
    label: '분석 조회',
  },
  {
    id: 'social.publish',
    category: 'social',
    risk: 'external',
    requiresApproval: true,
    status: 'active',
    label: '소셜 게시',
  },
  {
    id: 'document.write',
    category: 'document',
    risk: 'read',
    requiresApproval: false,
    status: 'active',
    label: '문서 작성',
  },
]

const BY_ID = new Map(CAPABILITY_DEFINITIONS.map((c) => [c.id, c]))

export function getCapabilityDefinition(
  id: AgentCapability,
): CapabilityDefinition | undefined {
  return BY_ID.get(id)
}

export function listActiveCapabilities(): AgentCapability[] {
  return CAPABILITY_DEFINITIONS.filter((c) => c.status === 'active').map(
    (c) => c.id,
  )
}

export function listFutureCapabilities(): AgentCapability[] {
  return CAPABILITY_DEFINITIONS.filter((c) => c.status === 'future').map(
    (c) => c.id,
  )
}
