/**
 * Simplify-1 — user-facing display labels (internal statuses unchanged).
 */
import type { PipelineStep, Task, TaskStatus } from './types'

/** Simple status for the main UI. */
export type UserTaskStatus =
  | '준비 중'
  | '조사 중'
  | '기획 중'
  | '구현 중'
  | '승인 대기'
  | '검증 중'
  | '검토 중'
  | '완료'
  | '문제 발생'
  | '일시정지'
  | '취소됨'
  | '중단됨'

export function userFacingTaskStatus(
  task: Pick<Task, 'status' | 'workflow'>,
  currentStep?: Pick<PipelineStep, 'label' | 'provider' | 'mode' | 'approvalKind' | 'status'> | null,
): UserTaskStatus {
  const s = task.status
  if (s === 'awaiting_approval') return '승인 대기'
  if (s === 'completed') return '완료'
  if (s === 'failed' || s === 'blocked' || s === 'rejected') return '문제 발생'
  if (s === 'paused') return '일시정지'
  if (s === 'cancelled') return '취소됨'
  if (s === 'interrupted') return '중단됨'
  if (s === 'verifying') return '검증 중'
  if (s === 'review') return '검토 중'
  if (s === 'queued') return '준비 중'

  if (s === 'running' && currentStep) {
    const label = `${currentStep.label} ${currentStep.mode ?? ''}`.toLowerCase()
    if (currentStep.approvalKind || currentStep.provider === 'human') return '승인 대기'
    if (currentStep.mode === 'verify' || /검증/.test(currentStep.label)) return '검증 중'
    if (currentStep.mode === 'review' || /리뷰|검토/.test(currentStep.label))
      return '검토 중'
    if (
      currentStep.mode === 'implement' ||
      /구현|코딩|개발/.test(currentStep.label)
    )
      return '구현 중'
    if (/조사|검색|리서치|연구/.test(label)) return '조사 중'
    if (/기획|계획|설계|요구|분석|ux/.test(label)) return '기획 중'
  }

  if (s === 'running') {
    const w = task.workflow
    if (w === 'RESEARCH' || w === 'IDEA' || w === 'GAME_IDEA') return '조사 중'
    if (w === 'PLAN' || w === 'DESIGN') return '기획 중'
    if (w === 'BUILD') return '구현 중'
    if (w === 'REVIEW') return '검토 중'
    return '구현 중'
  }

  return '준비 중'
}

export function approvalKindLabel(
  kind: 'plan' | 'change' | 'publish' | undefined,
): string {
  if (kind === 'plan') return '계획 승인'
  if (kind === 'publish') return '게시 승인'
  return '변경 승인'
}

/** WorkflowKind chip label — never expose raw BUILD/RESEARCH/etc. */
export function userFacingWorkflowLabel(
  task: Pick<Task, 'workflow'>,
): string {
  switch (task.workflow) {
    case 'IDEA':
    case 'GAME_IDEA':
    case 'RESEARCH':
      return '조사'
    case 'PLAN':
    case 'DESIGN':
      return '기획'
    case 'BUILD':
      return '기능 개발'
    case 'REVIEW':
      return '검토'
    case 'MARKETING':
      return '마케팅'
    case 'RELEASE':
      return '배포'
    default:
      return '작업'
  }
}

export function formatWaitingDuration(iso?: string): string {
  if (!iso) return '—'
  const ms = Date.now() - Date.parse(iso)
  if (!Number.isFinite(ms) || ms < 0) return '방금'
  const m = Math.floor(ms / 60_000)
  if (m < 1) return '방금'
  if (m < 60) return `${m}분 전`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}시간 전`
  return `${Math.floor(h / 24)}일 전`
}

/** Friendly Korean for technical errors (default surface). */
export function userFacingErrorMessage(raw?: string | null): string {
  if (!raw) return '일시적인 문제가 발생했습니다.'
  const t = raw.toLowerCase()
  if (t.includes('codex')) return 'Codex 서비스가 일시적으로 응답하지 않습니다.'
  if (t.includes('openai') || t.includes('api key') || t.includes('not configured'))
    return 'AI 연결에 문제가 있습니다. 설정을 확인해 주세요.'
  if (t.includes('path') || t.includes('sandbox') || t.includes('경로'))
    return '프로젝트 경로를 사용할 수 없습니다.'
  if (t.includes('session') || t.includes('unauthorized'))
    return '로컬 세션이 만료되었습니다. 앱을 다시 시작해 주세요.'
  if (t.includes('network') || t.includes('fetch') || t.includes('econn'))
    return '네트워크 연결에 문제가 있습니다.'
  if (t.includes('search') || t.includes('검색'))
    return '웹 검색을 완료하지 못했습니다.'
  return '작업을 이어가지 못했습니다. 잠시 후 다시 시도해 주세요.'
}

export function currentWorkerLabel(
  steps: PipelineStep[],
  agentName: (id: string) => string,
): string {
  const cur = steps.find(
    (s) =>
      s.status === 'running' ||
      s.status === 'reviewing' ||
      s.status === 'awaiting_approval',
  )
  if (!cur) return '—'
  if (cur.provider === 'human') return '사용자 승인 필요'
  return agentName(cur.agentId)
}

export function isTerminalTaskStatus(status: TaskStatus): boolean {
  return (
    status === 'completed' ||
    status === 'failed' ||
    status === 'cancelled' ||
    status === 'rejected'
  )
}
