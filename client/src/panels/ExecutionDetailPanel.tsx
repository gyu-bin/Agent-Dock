import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { fetchExecutionDetail } from '../api/client'
import type { ExecutionRecord } from '../domain/types'
import {
  PROVIDER_LABEL,
  STATUS_LABEL,
  formatDuration,
  formatRecordCost,
  formatTokens,
} from '../domain/usageUi'
import { selectActiveProject, useDeckStore } from '../store/useDeckStore'
import styles from './TaskDetailPanel.module.css'

export function ExecutionDetailPanel() {
  const executionId = useDeckStore((s) => s.selectedExecutionId)
  const selectExecution = useDeckStore((s) => s.selectExecution)
  const selectTask = useDeckStore((s) => s.selectTask)
  const project = useDeckStore(selectActiveProject)
  const projects = useDeckStore((s) => s.projects)
  const [item, setItem] = useState<ExecutionRecord | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!executionId) {
      setItem(null)
      return
    }
    let cancelled = false
    setError(null)
    void fetchExecutionDetail(executionId, project?.id)
      .then((rec) => {
        if (!cancelled) setItem(rec)
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [executionId, project?.id])

  if (!executionId) return null

  const projName =
    projects.find((p) => p.id === item?.projectId)?.name ?? item?.projectId

  return (
    <div className={styles.overlay} role="dialog" aria-modal aria-label="실행 상세">
      <button
        type="button"
        className={styles.backdrop}
        aria-label="닫기"
        onClick={() => selectExecution(null)}
      />
      <aside className={styles.panel}>
        <header className={styles.head}>
          <div>
            <p className={styles.workflow}>실행 상세</p>
            <h2>
              {item
                ? `${PROVIDER_LABEL[item.provider]} · ${item.operation}`
                : '불러오는 중…'}
            </h2>
            <p className={styles.meta}>
              {item ? STATUS_LABEL[item.status] : ''}
            </p>
          </div>
          <button
            type="button"
            className={styles.close}
            onClick={() => selectExecution(null)}
          >
            <X size={16} />
          </button>
        </header>

        {error ? <p className={styles.warn}>{error}</p> : null}

        {item ? (
          <section className={styles.pipeline}>
            <h3>요약</h3>
            <ul className={styles.fileList}>
              <li>
                <strong>Agent</strong> <span>{item.agentId ?? '—'}</span>
              </li>
              <li>
                <strong>Task</strong>{' '}
                <button
                  type="button"
                  className={styles.linkBtn}
                  onClick={() => {
                    selectTask(item.taskId)
                    selectExecution(null)
                  }}
                >
                  {item.taskId}
                </button>
              </li>
              <li>
                <strong>Project</strong> <span>{projName}</span>
              </li>
              <li>
                <strong>Provider</strong>{' '}
                <span>{PROVIDER_LABEL[item.provider]}</span>
              </li>
              <li>
                <strong>Model</strong> <span>{item.model ?? '—'}</span>
              </li>
              <li>
                <strong>시작</strong>{' '}
                <span>{new Date(item.startedAt).toLocaleString()}</span>
              </li>
              <li>
                <strong>종료</strong>{' '}
                <span>
                  {item.completedAt
                    ? new Date(item.completedAt).toLocaleString()
                    : '—'}
                </span>
              </li>
              <li>
                <strong>Duration</strong>{' '}
                <span>{formatDuration(item.durationMs)}</span>
              </li>
              <li>
                <strong>Tokens</strong>{' '}
                <span>
                  in {formatTokens(item.inputTokens ?? 0)} / out{' '}
                  {formatTokens(item.outputTokens ?? 0)}
                </span>
              </li>
              <li>
                <strong>예상 비용</strong>{' '}
                <span>{formatRecordCost(item)}</span>
              </li>
              <li>
                <strong>Retry</strong> <span>{item.retryCount}</span>
              </li>
              <li>
                <strong>Error</strong>{' '}
                <span>{item.errorCategory ?? '—'}</span>
              </li>
            </ul>
            {item.userMessage ? (
              <p className={styles.warn}>{item.userMessage}</p>
            ) : null}
            <p className={styles.meta}>
              연결: {item.metadata.sourceKind} / {item.metadata.sourceId}
              {item.metadata.artifactIds?.length
                ? ` · Artifact ${item.metadata.artifactIds.join(', ')}`
                : ''}
            </p>
            <p className={styles.meta}>
              Secret · API Key · chain-of-thought는 표시하지 않습니다.
            </p>
          </section>
        ) : null}
      </aside>
    </div>
  )
}
