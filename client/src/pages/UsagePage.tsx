import { useEffect, useState } from 'react'
import { Activity } from 'lucide-react'
import {
  fetchUsageExecutions,
  fetchUsageSummary,
} from '../api/client'
import type {
  ExecutionProvider,
  ExecutionRecord,
  ExecutionStatus,
  UsageAggregation,
} from '../domain/types'
import {
  PROVIDER_FILTERS,
  PROVIDER_LABEL,
  STATUS_FILTERS,
  STATUS_LABEL,
  formatCost,
  formatDuration,
  formatRecordCost,
  formatTokens,
} from '../domain/usageUi'
import { t } from '../i18n/ko'
import { selectActiveProject, useDeckStore } from '../store/useDeckStore'
import styles from './Pages.module.css'

type Scope = 'today' | 'project' | 'all'

const emptyAgg = (): UsageAggregation => ({
  calls: 0,
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  estimatedCost: 0,
  hasUnknownCost: false,
  averageDurationMs: 0,
  failures: 0,
  retries: 0,
  openaiCalls: 0,
  codexRuns: 0,
  webSearches: 0,
  mockCalls: 0,
  humanCalls: 0,
})

export function UsagePage() {
  const project = useDeckStore(selectActiveProject)
  const projects = useDeckStore((s) => s.projects)
  const selectExecution = useDeckStore((s) => s.selectExecution)
  const [scope, setScope] = useState<Scope>('project')
  const [provider, setProvider] = useState<'all' | ExecutionProvider>('all')
  const [status, setStatus] = useState<'all' | ExecutionStatus>('all')
  const [filterProjectId, setFilterProjectId] = useState<string>('all')
  const [agg, setAgg] = useState<UsageAggregation>(emptyAgg)
  const [recent, setRecent] = useState<ExecutionRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (scope === 'project' && !project) {
      setAgg(emptyAgg())
      setRecent([])
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    const projectId =
      scope === 'project'
        ? project?.id
        : scope === 'today'
          ? project?.id
          : undefined

    void fetchUsageSummary({ scope, projectId })
      .then(async (summary) => {
        if (cancelled) return
        setAgg(summary.aggregation)
        // Apply local filters on executions list
        const list = await fetchUsageExecutions({
          projectId:
            filterProjectId !== 'all'
              ? filterProjectId
              : scope === 'all'
                ? undefined
                : projectId,
          provider: provider === 'all' ? undefined : provider,
          status: status === 'all' ? undefined : status,
          dateFrom: scope === 'today' ? new Date().toISOString().slice(0, 10) : undefined,
          dateTo: scope === 'today' ? new Date().toISOString().slice(0, 10) : undefined,
        })
        if (!cancelled) setRecent(list.slice(0, 80))
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [scope, project?.id, provider, status, filterProjectId])

  if (scope === 'project' && !project) {
    return (
      <div className={styles.page}>
        <div className={styles.empty}>
          <Activity size={28} />
          <h2>{t('project.noActive')}</h2>
          <p>프로젝트를 선택하면 사용량을 볼 수 있습니다.</p>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <header className={styles.pageHead}>
        <div>
          <h1>{t('nav.usage')}</h1>
          <p>
            AI·Agent 실행을 한곳에서 추적합니다. API 키·추론 과정은 표시되지 않습니다.
          </p>
        </div>
      </header>

      <div className={styles.filterRow}>
        {(
          [
            { id: 'today' as const, label: '오늘' },
            { id: 'project' as const, label: '이번 프로젝트' },
            { id: 'all' as const, label: '전체' },
          ] as const
        ).map((s) => (
          <button
            key={s.id}
            type="button"
            className={scope === s.id ? styles.filterOn : styles.filter}
            onClick={() => setScope(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>

      <section className={styles.statsGrid} aria-label="사용량 요약">
        <Stat label="AI 호출" value={String(agg.openaiCalls + agg.mockCalls)} />
        <Stat label="토큰" value={formatTokens(agg.totalTokens)} />
        <Stat label="예상 비용" value={formatCost(agg)} />
        <Stat label="Codex 실행" value={String(agg.codexRuns)} />
        <Stat label="웹 검색" value={String(agg.webSearches)} />
        <Stat label="실패" value={String(agg.failures)} />
      </section>

      <div className={styles.filterRow}>
        {PROVIDER_FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={provider === f.id ? styles.filterOn : styles.filter}
            onClick={() => setProvider(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div className={styles.filterRow}>
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={status === f.id ? styles.filterOn : styles.filter}
            onClick={() => setStatus(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>
      {scope === 'all' ? (
        <div className={styles.filterRow}>
          <button
            type="button"
            className={filterProjectId === 'all' ? styles.filterOn : styles.filter}
            onClick={() => setFilterProjectId('all')}
          >
            모든 프로젝트
          </button>
          {projects.map((p) => (
            <button
              key={p.id}
              type="button"
              className={
                filterProjectId === p.id ? styles.filterOn : styles.filter
              }
              onClick={() => setFilterProjectId(p.id)}
            >
              {p.name}
            </button>
          ))}
        </div>
      ) : null}

      {loading ? <p className={styles.muted}>불러오는 중…</p> : null}
      {error ? <p className={styles.error}>{error}</p> : null}

      <h2 className={styles.sectionTitle}>최근 실행 기록</h2>
      {recent.length === 0 && !loading ? (
        <div className={styles.empty}>
          <Activity size={24} />
          <h2>실행 기록이 없습니다</h2>
          <p>Agent·Codex·웹 검색이 실행되면 여기에 집계됩니다.</p>
        </div>
      ) : (
        <ul className={styles.cardList}>
          {recent.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className={styles.card}
                onClick={() => selectExecution(r.id)}
              >
                <div className={styles.cardTop}>
                  <strong>
                    {PROVIDER_LABEL[r.provider]} · {r.operation}
                  </strong>
                  <em>{STATUS_LABEL[r.status]}</em>
                </div>
                <div className={styles.cardMeta}>
                  <span>{new Date(r.startedAt).toLocaleString()}</span>
                  <span>{r.agentId ?? '—'}</span>
                  <span>{r.model ?? '—'}</span>
                  <span>{formatDuration(r.durationMs)}</span>
                  <span>
                    토큰{' '}
                    {formatTokens((r.inputTokens ?? 0) + (r.outputTokens ?? 0))}
                  </span>
                  <span>{formatRecordCost(r)}</span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.statCard}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}
