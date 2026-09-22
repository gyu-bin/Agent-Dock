/**
 * Harden-0 — shared error categories (API code + Korean user message).
 * Technical detail stays in logs / error.message for diagnostics.
 */

export type HardenErrorCategory =
  | 'SESSION_UNAUTHORIZED'
  | 'ORIGIN_FORBIDDEN'
  | 'PERSISTENCE_CONFLICT'
  | 'PATH_VIOLATION'
  | 'SNAPSHOT_OWNERSHIP'
  | 'EXECUTION_LOCK'
  | 'TASK_INTERRUPTED'
  | 'BAD_REQUEST'

export const HARDEN_USER_MESSAGE_KO: Record<HardenErrorCategory, string> = {
  SESSION_UNAUTHORIZED: '로컬 세션이 없어 요청을 거부했습니다. 앱을 다시 시작해 주세요.',
  ORIGIN_FORBIDDEN: '허용되지 않은 origin에서의 요청입니다.',
  PERSISTENCE_CONFLICT:
    '다른 곳에서 상태가 먼저 저장되어 덮어쓰지 않았습니다. 새로고침 후 다시 시도해 주세요.',
  PATH_VIOLATION: '프로젝트 경로 밖으로의 파일 접근은 허용되지 않습니다.',
  SNAPSHOT_OWNERSHIP:
    '이 스냅샷은 요청한 프로젝트에 속하지 않아 복원할 수 없습니다.',
  EXECUTION_LOCK:
    '다른 탭에서 이미 실행 중입니다. 한 번에 하나의 실행만 허용됩니다.',
  TASK_INTERRUPTED: '작업이 중단되었습니다. 완료된 것으로 처리하지 않습니다.',
  BAD_REQUEST: '요청이 올바르지 않습니다.',
}

export function hardenError(
  category: HardenErrorCategory,
  technical: string,
  status?: number,
): Error & {
  status: number
  code: HardenErrorCategory
  userMessageKo: string
} {
  const statusMap: Record<HardenErrorCategory, number> = {
    SESSION_UNAUTHORIZED: 401,
    ORIGIN_FORBIDDEN: 403,
    PERSISTENCE_CONFLICT: 409,
    PATH_VIOLATION: 403,
    SNAPSHOT_OWNERSHIP: 403,
    EXECUTION_LOCK: 409,
    TASK_INTERRUPTED: 409,
    BAD_REQUEST: 400,
  }
  return Object.assign(new Error(technical), {
    status: status ?? statusMap[category],
    code: category,
    userMessageKo: HARDEN_USER_MESSAGE_KO[category],
  })
}
