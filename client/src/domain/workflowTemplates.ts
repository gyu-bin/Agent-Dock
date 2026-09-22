import type {
  ArtifactType,
  CodexMode,
  ProjectType,
  StepProvider,
  WorkflowKind,
} from './types'

/** Approval policy for a template step */
export type ApprovalPolicy =
  | 'none'
  | 'plan'
  | 'change'
  | 'auto-if-no-changes'

/** Role keys — not concrete agent ids */
export type WorkflowRoleKey =
  | 'researcher'
  | 'product'
  | 'ux'
  | 'ui'
  | 'game-designer'
  | 'engineer'
  | 'frontend'
  | 'reviewer'
  | 'reality'
  | 'planner'
  | 'analyst'
  | 'human'
  | 'marketing'
  | 'content'

export interface WorkflowTemplateStep {
  key: string
  /** User-facing Korean step name */
  label: string
  role: WorkflowRoleKey
  provider: StepProvider
  mode?: CodexMode
  required: boolean
  /** Skip this step for tiny / low-scope requests when false-required */
  skipIfSmall?: boolean
  /** W1 — run web search before this OpenAI step */
  requiresWebSearch?: boolean
  outputArtifactType?: ArtifactType
  approvalPolicy: ApprovalPolicy
  /** Artifact types this step prefers as input (hints for context) */
  inputArtifactTypes?: ArtifactType[]
}

export interface WorkflowTemplate {
  id: string
  version: number
  name: string
  /** Korean display name */
  nameKo: string
  description: string
  /** Intent keywords / phrases for deterministic matching */
  intents: string[]
  supportedProjectTypes: Array<ProjectType | '*'>
  /** Maps to existing WorkflowKind for compatibility */
  workflowKind: WorkflowKind
  steps: WorkflowTemplateStep[]
}

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'FEATURE_BUILD',
    version: 1,
    name: 'Feature Build',
    nameKo: '기능 개발',
    description: '기능 기획부터 구현·검증·리뷰까지',
    intents: [
      '기능',
      'feature',
      '구현해',
      '만들어',
      '추가해',
      '개발',
      'build',
      'implement',
    ],
    supportedProjectTypes: ['*'],
    workflowKind: 'BUILD',
    steps: [
      {
        key: 'product-plan',
        label: '기능 기획',
        role: 'product',
        provider: 'openai',
        required: true,
        outputArtifactType: 'plan',
        approvalPolicy: 'none',
      },
      {
        key: 'tech-plan',
        label: '기술 계획',
        role: 'engineer',
        provider: 'openai',
        required: true,
        skipIfSmall: true,
        outputArtifactType: 'plan',
        approvalPolicy: 'none',
        inputArtifactTypes: ['plan'],
      },
      {
        key: 'implement',
        label: '구현',
        role: 'frontend',
        provider: 'codex',
        mode: 'implement',
        required: true,
        outputArtifactType: 'code-change',
        approvalPolicy: 'none',
        inputArtifactTypes: ['plan'],
      },
      {
        key: 'change-approval',
        label: '변경 승인',
        role: 'human',
        provider: 'human',
        required: true,
        approvalPolicy: 'change',
      },
      {
        key: 'verify',
        label: '검증',
        role: 'reviewer',
        provider: 'codex',
        mode: 'verify',
        required: true,
        outputArtifactType: 'verification',
        approvalPolicy: 'none',
      },
      {
        key: 'review',
        label: '코드 리뷰',
        role: 'reviewer',
        provider: 'codex',
        mode: 'review',
        required: true,
        outputArtifactType: 'review',
        approvalPolicy: 'none',
        inputArtifactTypes: ['code-change', 'verification'],
      },
      {
        key: 'reality',
        label: '최종 검토',
        role: 'reality',
        provider: 'openai',
        required: true,
        outputArtifactType: 'report',
        approvalPolicy: 'none',
      },
    ],
  },
  {
    id: 'UX_IMPROVEMENT',
    version: 1,
    name: 'UX Improvement',
    nameKo: 'UX 개선',
    description: 'UX 분석 → 개선안 → 계획 승인 → 구현 → 검증',
    intents: [
      'ux',
      'UI',
      '사용성',
      '홈 화면',
      '개선',
      '디자인',
      '인터페이스',
      '경험',
    ],
    supportedProjectTypes: ['*'],
    workflowKind: 'DESIGN',
    steps: [
      {
        key: 'ux-analysis',
        label: 'UX 분석',
        role: 'ux',
        provider: 'openai',
        required: true,
        outputArtifactType: 'research',
        approvalPolicy: 'none',
      },
      {
        key: 'ui-proposal',
        label: 'UI/UX 개선안',
        role: 'ui',
        provider: 'openai',
        required: true,
        outputArtifactType: 'design',
        approvalPolicy: 'none',
        inputArtifactTypes: ['research'],
      },
      {
        key: 'impl-plan',
        label: '구현 계획',
        role: 'product',
        provider: 'openai',
        required: true,
        outputArtifactType: 'plan',
        approvalPolicy: 'none',
        inputArtifactTypes: ['research', 'design'],
      },
      {
        key: 'plan-approval',
        label: '계획 승인',
        role: 'human',
        provider: 'human',
        required: true,
        skipIfSmall: true,
        approvalPolicy: 'plan',
      },
      {
        key: 'implement',
        label: '구현',
        role: 'frontend',
        provider: 'codex',
        mode: 'implement',
        required: true,
        outputArtifactType: 'code-change',
        approvalPolicy: 'none',
        inputArtifactTypes: ['plan', 'design'],
      },
      {
        key: 'change-approval',
        label: '변경 승인',
        role: 'human',
        provider: 'human',
        required: true,
        approvalPolicy: 'change',
      },
      {
        key: 'verify',
        label: '검증',
        role: 'reviewer',
        provider: 'codex',
        mode: 'verify',
        required: true,
        outputArtifactType: 'verification',
        approvalPolicy: 'none',
      },
      {
        key: 'review',
        label: '코드 리뷰',
        role: 'reviewer',
        provider: 'codex',
        mode: 'review',
        required: true,
        outputArtifactType: 'review',
        approvalPolicy: 'none',
      },
      {
        key: 'reality',
        label: '최종 검토',
        role: 'reality',
        provider: 'openai',
        required: true,
        outputArtifactType: 'report',
        approvalPolicy: 'none',
      },
    ],
  },
  {
    id: 'BUG_FIX',
    version: 1,
    name: 'Bug Fix',
    nameKo: '버그 수정',
    description: 'Inspect → 원인 → 수정 → 승인 → 검증',
    intents: ['버그', 'bug', '오류', '에러', '고치', 'fix', '깨짐', '실패'],
    supportedProjectTypes: ['*'],
    workflowKind: 'BUILD',
    steps: [
      {
        key: 'inspect',
        label: '코드 조사',
        role: 'engineer',
        provider: 'codex',
        mode: 'inspect',
        required: true,
        outputArtifactType: 'document',
        approvalPolicy: 'none',
      },
      {
        key: 'root-cause',
        label: '원인 분석',
        role: 'analyst',
        provider: 'openai',
        required: true,
        outputArtifactType: 'document',
        approvalPolicy: 'none',
      },
      {
        key: 'fix-plan',
        label: '수정 계획',
        role: 'engineer',
        provider: 'openai',
        required: true,
        skipIfSmall: true,
        outputArtifactType: 'plan',
        approvalPolicy: 'none',
      },
      {
        key: 'implement',
        label: '수정 구현',
        role: 'frontend',
        provider: 'codex',
        mode: 'implement',
        required: true,
        outputArtifactType: 'code-change',
        approvalPolicy: 'none',
        inputArtifactTypes: ['plan', 'document'],
      },
      {
        key: 'change-approval',
        label: '변경 승인',
        role: 'human',
        provider: 'human',
        required: true,
        approvalPolicy: 'change',
      },
      {
        key: 'verify',
        label: '검증',
        role: 'reviewer',
        provider: 'codex',
        mode: 'verify',
        required: true,
        outputArtifactType: 'verification',
        approvalPolicy: 'none',
      },
      {
        key: 'review',
        label: '코드 리뷰',
        role: 'reviewer',
        provider: 'codex',
        mode: 'review',
        required: true,
        outputArtifactType: 'review',
        approvalPolicy: 'none',
      },
    ],
  },
  {
    id: 'GAME_PROTOTYPE',
    version: 1,
    name: 'Game Prototype',
    nameKo: '게임 프로토타입',
    description: '게임 컨셉 → 프로토타입 계획 → 승인 → 구현',
    intents: [
      '게임',
      '프로토타입',
      'prototype',
      'steam',
      '코어 루프',
      'game',
    ],
    supportedProjectTypes: ['steam-game', 'mobile-game', '*'],
    workflowKind: 'GAME_IDEA',
    steps: [
      {
        key: 'trend-research',
        label: '트렌드 리서치',
        role: 'researcher',
        provider: 'openai',
        required: true,
        requiresWebSearch: true,
        outputArtifactType: 'research',
        approvalPolicy: 'none',
      },
      {
        key: 'game-design',
        label: '게임 디자인',
        role: 'game-designer',
        provider: 'openai',
        required: true,
        outputArtifactType: 'design',
        approvalPolicy: 'none',
        inputArtifactTypes: ['research'],
      },
      {
        key: 'prototype-plan',
        label: '프로토타입 계획',
        role: 'product',
        provider: 'openai',
        required: true,
        outputArtifactType: 'plan',
        approvalPolicy: 'none',
        inputArtifactTypes: ['design'],
      },
      {
        key: 'tech-feasibility',
        label: '기술 타당성',
        role: 'engineer',
        provider: 'openai',
        required: true,
        outputArtifactType: 'document',
        approvalPolicy: 'none',
        inputArtifactTypes: ['plan', 'design'],
      },
      {
        key: 'plan-approval',
        label: '계획 승인',
        role: 'human',
        provider: 'human',
        required: true,
        approvalPolicy: 'plan',
      },
      {
        key: 'implement',
        label: '프로토타입 구현',
        role: 'frontend',
        provider: 'codex',
        mode: 'implement',
        required: true,
        outputArtifactType: 'code-change',
        approvalPolicy: 'none',
        inputArtifactTypes: ['plan'],
      },
      {
        key: 'change-approval',
        label: '변경 승인',
        role: 'human',
        provider: 'human',
        required: true,
        approvalPolicy: 'change',
      },
      {
        key: 'verify',
        label: '검증',
        role: 'reviewer',
        provider: 'codex',
        mode: 'verify',
        required: true,
        outputArtifactType: 'verification',
        approvalPolicy: 'none',
      },
      {
        key: 'review',
        label: '코드 리뷰',
        role: 'reviewer',
        provider: 'codex',
        mode: 'review',
        required: true,
        outputArtifactType: 'review',
        approvalPolicy: 'none',
      },
      {
        key: 'reality',
        label: '최종 검토',
        role: 'reality',
        provider: 'openai',
        required: true,
        outputArtifactType: 'report',
        approvalPolicy: 'none',
      },
    ],
  },
  {
    id: 'RESEARCH_TO_BUILD',
    version: 1,
    name: 'Research to Build',
    nameKo: '조사 후 구현',
    description: '리서치 → 제품 합성 → 계획 승인 → 구현',
    intents: ['조사', '리서치', 'research', '시장', '분석 후', '조사 후'],
    supportedProjectTypes: ['*'],
    workflowKind: 'RESEARCH',
    steps: [
      {
        key: 'research',
        label: '리서치',
        role: 'researcher',
        provider: 'openai',
        required: true,
        requiresWebSearch: true,
        outputArtifactType: 'research',
        approvalPolicy: 'none',
      },
      {
        key: 'synthesis',
        label: '제품 합성',
        role: 'product',
        provider: 'openai',
        required: true,
        outputArtifactType: 'plan',
        approvalPolicy: 'none',
        inputArtifactTypes: ['research'],
      },
      {
        key: 'impl-plan',
        label: '구현 계획',
        role: 'engineer',
        provider: 'openai',
        required: true,
        outputArtifactType: 'plan',
        approvalPolicy: 'none',
        inputArtifactTypes: ['plan', 'research'],
      },
      {
        key: 'plan-approval',
        label: '계획 승인',
        role: 'human',
        provider: 'human',
        required: true,
        skipIfSmall: true,
        approvalPolicy: 'plan',
      },
      {
        key: 'implement',
        label: '구현',
        role: 'frontend',
        provider: 'codex',
        mode: 'implement',
        required: true,
        outputArtifactType: 'code-change',
        approvalPolicy: 'none',
      },
      {
        key: 'change-approval',
        label: '변경 승인',
        role: 'human',
        provider: 'human',
        required: true,
        approvalPolicy: 'change',
      },
      {
        key: 'verify',
        label: '검증',
        role: 'reviewer',
        provider: 'codex',
        mode: 'verify',
        required: true,
        outputArtifactType: 'verification',
        approvalPolicy: 'none',
      },
      {
        key: 'review',
        label: '코드 리뷰',
        role: 'reviewer',
        provider: 'codex',
        mode: 'review',
        required: true,
        outputArtifactType: 'review',
        approvalPolicy: 'none',
      },
    ],
  },
  {
    id: 'MARKETING_CAMPAIGN',
    version: 1,
    name: 'Marketing Campaign',
    nameKo: '마케팅 조사·기획',
    description: '시장/경쟁 리서치 → 마케팅 기획 → 콘텐츠',
    intents: [
      '마케팅',
      'marketing',
      'steam page',
      '출시 마케팅',
      '경쟁 앱',
      '캠페인',
    ],
    supportedProjectTypes: ['*'],
    workflowKind: 'MARKETING',
    steps: [
      {
        key: 'market-research',
        label: '시장 리서치',
        role: 'researcher',
        provider: 'openai',
        required: true,
        requiresWebSearch: true,
        outputArtifactType: 'research',
        approvalPolicy: 'none',
      },
      {
        key: 'marketing-plan',
        label: '마케팅 기획',
        role: 'marketing',
        provider: 'openai',
        required: true,
        outputArtifactType: 'plan',
        approvalPolicy: 'none',
        inputArtifactTypes: ['research'],
      },
      {
        key: 'content',
        label: '콘텐츠 초안',
        role: 'content',
        provider: 'openai',
        required: true,
        outputArtifactType: 'document',
        approvalPolicy: 'none',
        inputArtifactTypes: ['research', 'plan'],
      },
      {
        key: 'reality',
        label: '최종 검토',
        role: 'reality',
        provider: 'openai',
        required: true,
        outputArtifactType: 'report',
        approvalPolicy: 'none',
      },
    ],
  },
  {
    id: 'REVIEW_ONLY',
    version: 1,
    name: 'Review Only',
    nameKo: '프로젝트 검토',
    description: '파일 수정 없이 Inspect → 리뷰 → 현실성 검토',
    intents: ['검토', '리뷰만', 'review only', '읽어', '검사', '코드 리뷰만'],
    supportedProjectTypes: ['*'],
    workflowKind: 'REVIEW',
    steps: [
      {
        key: 'inspect',
        label: '코드 조사',
        role: 'engineer',
        provider: 'codex',
        mode: 'inspect',
        required: true,
        outputArtifactType: 'document',
        approvalPolicy: 'none',
      },
      {
        key: 'review',
        label: '코드 리뷰',
        role: 'reviewer',
        provider: 'codex',
        mode: 'review',
        required: true,
        outputArtifactType: 'review',
        approvalPolicy: 'none',
      },
      {
        key: 'reality',
        label: '최종 검토',
        role: 'reality',
        provider: 'openai',
        required: true,
        outputArtifactType: 'report',
        approvalPolicy: 'none',
      },
    ],
  },
]

export function getTemplateById(id: string): WorkflowTemplate | undefined {
  return WORKFLOW_TEMPLATES.find((t) => t.id === id)
}

export function listTemplates(): WorkflowTemplate[] {
  return WORKFLOW_TEMPLATES
}
