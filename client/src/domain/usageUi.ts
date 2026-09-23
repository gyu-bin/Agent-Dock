import type {
  ExecutionProvider,
  ExecutionStatus,
  UsageAggregation,
} from './types'

export const PROVIDER_LABEL: Record<ExecutionProvider, string> = {
  openai: 'OpenAI',
  'openai-image': 'OpenAI Image',
  threads: 'Threads',
  'media-delivery': 'Media Delivery',
  buffer: 'Buffer',
  codex: 'Codex',
  'web-search': '웹 검색',
  mock: 'Mock',
  human: 'Human',
}

export const STATUS_LABEL: Record<ExecutionStatus, string> = {
  queued: '대기',
  running: '실행 중',
  completed: '완료',
  failed: '실패',
  cancelled: '취소',
}

export const PROVIDER_FILTERS: Array<{
  id: 'all' | ExecutionProvider
  label: string
}> = [
  { id: 'all', label: '전체 프로바이더' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'openai-image', label: 'OpenAI Image' },
  { id: 'threads', label: 'Threads' },
  { id: 'media-delivery', label: 'Media Delivery' },
  { id: 'buffer', label: 'Buffer' },
  { id: 'codex', label: 'Codex' },
  { id: 'web-search', label: '웹 검색' },
  { id: 'mock', label: 'Mock' },
  { id: 'human', label: 'Human' },
]

export const STATUS_FILTERS: Array<{
  id: 'all' | ExecutionStatus
  label: string
}> = [
  { id: 'all', label: '전체 상태' },
  { id: 'completed', label: '완료' },
  { id: 'failed', label: '실패' },
  { id: 'running', label: '실행 중' },
  { id: 'cancelled', label: '취소' },
  { id: 'queued', label: '대기' },
]

export function formatCost(agg: Pick<UsageAggregation, 'estimatedCost' | 'hasUnknownCost'>): string {
  if (agg.hasUnknownCost || agg.estimatedCost == null) return 'Unknown'
  if (agg.estimatedCost === 0) return '$0'
  return `$${agg.estimatedCost.toFixed(4)}`
}

export function formatRecordCost(r: {
  estimatedCost?: number
  costUnknown?: boolean
}): string {
  if (r.costUnknown) return 'Unknown'
  if (r.estimatedCost == null) return '—'
  if (r.estimatedCost === 0) return '$0'
  return `$${r.estimatedCost.toFixed(4)}`
}

export function formatTokens(n: number): string {
  return n.toLocaleString('ko-KR')
}

export function formatDuration(ms?: number): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}
