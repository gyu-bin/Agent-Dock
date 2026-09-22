import { useEffect, useMemo, useState } from 'react'
import {
  X,
  Play,
  Pause,
  RotateCcw,
  Ban,
  AlertTriangle,
  Check,
  MessageSquare,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { fetchProjectArtifacts, fetchTaskUsage } from '../api/client'
import type { Artifact, UsageAggregation } from '../domain/types'
import { artifactIcon } from '../domain/artifactUi'
import { formatCost, formatTokens } from '../domain/usageUi'
import {
  currentWorkerLabel,
  userFacingErrorMessage,
  userFacingTaskStatus,
  userFacingWorkflowLabel,
} from '../domain/taskDisplay'
import {
  selectCodexRunsForTask,
  selectRunsForTask,
  selectSelectedTask,
  selectStepsForTask,
  useDeckStore,
} from '../store/useDeckStore'
import { displayAgentName, t } from '../i18n'
import { DiffViewer } from './DiffViewer'
import styles from './TaskDetailPanel.module.css'

export function TaskDetailPanel({
  embedded = false,
}: {
  embedded?: boolean
}) {
  const task = useDeckStore(selectSelectedTask)
  const selectedTaskId = useDeckStore((s) => s.selectedTaskId)
  const steps = useDeckStore(
    useShallow((s) => selectStepsForTask(s, selectedTaskId)),
  )
  const runs = useDeckStore(
    useShallow((s) => selectRunsForTask(s, selectedTaskId)),
  )
  const codexRuns = useDeckStore(
    useShallow((s) => selectCodexRunsForTask(s, selectedTaskId)),
  )
  const projects = useDeckStore((s) => s.projects)
  const registry = useDeckStore((s) => s.registry)
  const selectTask = useDeckStore((s) => s.selectTask)
  const selectArtifact = useDeckStore((s) => s.selectArtifact)
  const setNav = useDeckStore((s) => s.setNav)
  const [taskArtifacts, setTaskArtifacts] = useState<Artifact[]>([])
  const [usageAgg, setUsageAgg] = useState<UsageAggregation | null>(null)
  const pauseTask = useDeckStore((s) => s.pauseTask)
  const resumeTask = useDeckStore((s) => s.resumeTask)
  const cancelTask = useDeckStore((s) => s.cancelTask)
  const retryTask = useDeckStore((s) => s.retryTask)
  const retryFailedStep = useDeckStore((s) => s.retryFailedStep)
  const retryFromPreviousStep = useDeckStore((s) => s.retryFromPreviousStep)
  const retryWebSearch = useDeckStore((s) => s.retryWebSearch)
  const continueWithoutWebSearch = useDeckStore((s) => s.continueWithoutWebSearch)
  const startTask = useDeckStore((s) => s.startTask)
  const markSimulateFailure = useDeckStore((s) => s.markSimulateFailure)
  const approveTaskChanges = useDeckStore((s) => s.approveTaskChanges)
  const rejectTaskChanges = useDeckStore((s) => s.rejectTaskChanges)
  const requestTaskChanges = useDeckStore((s) => s.requestTaskChanges)
  const speed = useDeckStore((s) => s.executionSpeed)
  const setExecutionSpeed = useDeckStore((s) => s.setExecutionSpeed)
  const [expandedRun, setExpandedRun] = useState<string | null>(null)
  const [feedback, setFeedback] = useState('')
  const [showFeedback, setShowFeedback] = useState(false)
  const [showSearchHistory, setShowSearchHistory] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirmImplement, setConfirmImplement] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showTechError, setShowTechError] = useState(false)
  const [showDiffDetail, setShowDiffDetail] = useState(false)

  const agentName = useMemo(() => {
    const map = new Map(registry.map((a) => [a.id, a.name]))
    return (id: string) => displayAgentName(id, map.get(id) ?? id)
  }, [registry])

  const tokenTotal = runs.reduce(
    (sum, r) => sum + (r.inputTokens ?? 0) + (r.outputTokens ?? 0),
    0,
  )

  const project = task
    ? projects.find((p) => p.id === task.projectId)
    : null

  const hasImplement = steps.some((s) => s.mode === 'implement')
  const latestImplement = [...codexRuns]
    .filter((r) => r.mode === 'implement')
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .at(-1)
  const verifyCommands = codexRuns.flatMap((r) => r.commands ?? [])
  const awaiting = task?.status === 'awaiting_approval'
  const verifyFailed = task?.verificationFailed === true
  const isPlanApproval = task?.approval?.kind === 'plan'
  const currentStep = steps.find(
    (s) =>
      s.status === 'running' ||
      s.status === 'reviewing' ||
      s.status === 'awaiting_approval',
  )
  const statusLabel = task
    ? userFacingTaskStatus(task, currentStep)
    : ''
  const worker = currentWorkerLabel(steps, agentName)
  const lastError =
    runs.find((r) => r.status === 'failed')?.error ||
    codexRuns.find((r) => r.status === 'failed')?.userMessageKo ||
    codexRuns.find((r) => r.status === 'failed')?.error ||
    task?.webSearchFailure?.message

  useEffect(() => {
    if (!task) {
      setTaskArtifacts([])
      setUsageAgg(null)
      return
    }
    let cancelled = false
    void fetchProjectArtifacts(task.projectId, { taskId: task.id })
      .then((list) => {
        if (!cancelled) setTaskArtifacts(list)
      })
      .catch(() => {
        if (!cancelled) setTaskArtifacts([])
      })
    void fetchTaskUsage(task.projectId, task.id)
      .then((res) => {
        if (!cancelled) setUsageAgg(res.aggregation)
      })
      .catch(() => {
        if (!cancelled) setUsageAgg(null)
      })
    return () => {
      cancelled = true
    }
  }, [task?.id, task?.projectId, task?.status, task?.updatedAt])

  if (!task) {
    if (embedded) {
      return (
        <div className={styles.embeddedEmpty}>
          <p>작업을 선택하면 상세가 여기에 표시됩니다.</p>
          <span>상태 · 단계 · 승인 · 결과를 한곳에서 확인합니다.</span>
        </div>
      )
    }
    return null
  }

  async function onApprove() {
    setBusy(true)
    try {
      await approveTaskChanges(task!.id)
    } finally {
      setBusy(false)
    }
  }

  async function onReject() {
    setBusy(true)
    try {
      await rejectTaskChanges(task!.id)
    } finally {
      setBusy(false)
    }
  }

  async function onRequestChanges() {
    if (!feedback.trim()) return
    setBusy(true)
    try {
      await requestTaskChanges(task!.id, feedback)
      setFeedback('')
      setShowFeedback(false)
    } finally {
      setBusy(false)
    }
  }

  function onStartClick() {
    if (hasImplement && !confirmImplement && task.status === 'queued') {
      setConfirmImplement(true)
      return
    }
    setConfirmImplement(false)
    startTask(task.id)
  }

  const panel = (
      <aside className={embedded ? styles.embeddedPanel : styles.panel}>
        <header className={styles.head}>
          <div>
            <p className={styles.workflow}>{userFacingWorkflowLabel(task)}</p>
            <h2>{task.title}</h2>
            <p className={styles.meta}>
              {statusLabel} · {task.progress}%
            </p>
          </div>
          {!embedded ? (
            <button type="button" className={styles.close} onClick={() => selectTask(null)}>
              <X size={16} />
            </button>
          ) : null}
        </header>

        {/* ── Basic surface ── */}
        <section className={styles.pipeline}>
          <ul className={styles.fileList}>
            <li>
              <strong>지금</strong> {statusLabel}
              {currentStep ? ` — ${currentStep.label}` : ''}
            </li>
            <li>
              <strong>작업자</strong> {worker}
            </li>
            <li>
              <strong>진행</strong> {task.progress}%
            </li>
            <li>
              <strong>승인</strong>{' '}
              {awaiting
                ? isPlanApproval
                  ? t('task.planApproval')
                  : t('task.approvalGate')
                : '필요 없음'}
            </li>
          </ul>
        </section>

        <section className={styles.pipeline}>
          <h3>{t('task.pipeline')}</h3>
          <ol>
            {steps.map((step) => {
              const isCurrent =
                step.status === 'running' ||
                step.status === 'reviewing' ||
                step.status === 'awaiting_approval'
              const needsApproval = step.status === 'awaiting_approval'
              const label =
                step.approvalKind === 'plan'
                  ? t('task.planApproval')
                  : step.provider === 'human'
                    ? t('task.approvalGate')
                    : step.label
              return (
                <li
                  key={step.id}
                  data-status={step.status}
                  className={isCurrent ? styles.stepCurrent : undefined}
                >
                  <span className={styles.mark}>
                    {needsApproval
                      ? '!'
                      : step.status === 'completed'
                        ? '✓'
                        : step.status === 'failed' || step.status === 'blocked'
                          ? '×'
                          : isCurrent
                            ? '●'
                            : '○'}
                  </span>
                  <div>
                    <strong>{label}</strong>
                    <em>
                      {step.status === 'completed'
                        ? '완료'
                        : needsApproval
                          ? '승인 필요'
                          : step.status === 'failed' || step.status === 'blocked'
                            ? '문제'
                            : isCurrent
                              ? '진행 중'
                              : '대기'}
                    </em>
                  </div>
                </li>
              )
            })}
          </ol>
        </section>

        {confirmImplement ? (
          <section className={styles.preflight}>
            <h3>파일 변경 확인</h3>
            <p className={styles.warn}>{t('task.filesMayModify')}</p>
            <div className={styles.actions}>
              <button type="button" className={styles.primary} onClick={onStartClick}>
                {t('task.confirmStart')}
              </button>
              <button type="button" onClick={() => setConfirmImplement(false)}>
                {t('task.confirmCancel')}
              </button>
            </div>
          </section>
        ) : null}

        {awaiting ? (
          <section className={styles.approval}>
            <h3>
              {isPlanApproval ? t('task.planApproval') : t('task.approvalGate')}
            </h3>
            {isPlanApproval ? (
              <>
                <p className={styles.desc}>AI 팀이 제안한 계획을 확인한 뒤 승인하세요.</p>
                <dl className={styles.fileList}>
                  <li>
                    <strong>{t('task.planGoals')}</strong>
                    <br />
                    {task.title}
                  </li>
                  <li>
                    <strong>{t('task.planScope')}</strong>
                    <br />
                    {(task.approval?.planExcerpt ?? task.planSummary ?? '')
                      .split('\n')
                      .slice(0, 4)
                      .join(' ')
                      .slice(0, 280) || '계획 요약이 준비되면 여기에 표시됩니다.'}
                  </li>
                </dl>
                {showDiffDetail ? (
                  <pre className={styles.resultPre}>
                    {(task.approval?.planExcerpt ?? task.planSummary ?? '').slice(0, 3500)}
                  </pre>
                ) : null}
                <button
                  type="button"
                  className={styles.speed}
                  onClick={() => setShowDiffDetail((v) => !v)}
                >
                  {showDiffDetail ? '계획 접기' : '계획 자세히'}
                </button>
              </>
            ) : (
              <>
                {latestImplement?.summary ? (
                  <p className={styles.desc}>{latestImplement.summary.slice(0, 400)}</p>
                ) : null}
                <p>
                  {t('task.added')}: {(latestImplement?.addedFiles ?? []).length} ·{' '}
                  {t('task.modified')}: {(latestImplement?.modifiedFiles ?? []).length} ·{' '}
                  {t('task.deleted')}: {(latestImplement?.deletedFiles ?? []).length}
                </p>
                {showDiffDetail ? (
                  <DiffViewer
                    diffByFile={latestImplement?.diffByFile}
                    unifiedDiff={latestImplement?.unifiedDiff}
                    added={latestImplement?.addedFiles}
                    modified={latestImplement?.modifiedFiles}
                    deleted={latestImplement?.deletedFiles}
                    changedFiles={latestImplement?.changedFiles}
                  />
                ) : (
                  <ul className={styles.fileList}>
                    {(latestImplement?.changedFiles ?? []).slice(0, 8).map((f) => (
                      <li key={f}>
                        <code>{f}</code>
                      </li>
                    ))}
                  </ul>
                )}
                <button
                  type="button"
                  className={styles.speed}
                  onClick={() => setShowDiffDetail((v) => !v)}
                >
                  {showDiffDetail ? 'Diff 접기' : 'Diff 펼치기'}
                </button>
              </>
            )}
            {showFeedback ? (
              <div className={styles.feedbackBox}>
                <textarea
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  placeholder={t('task.feedbackPlaceholder')}
                  rows={3}
                />
                <button
                  type="button"
                  className={styles.primary}
                  disabled={busy || !feedback.trim()}
                  onClick={() => void onRequestChanges()}
                >
                  {t('task.requestChanges')}
                </button>
              </div>
            ) : (
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.primary}
                  disabled={busy}
                  onClick={() => void onApprove()}
                >
                  <Check size={14} />{' '}
                  {isPlanApproval ? t('task.approvePlan') : t('task.approve')}
                </button>
                <button type="button" disabled={busy} onClick={() => setShowFeedback(true)}>
                  <MessageSquare size={14} /> {t('task.requestChanges')}
                </button>
                <button
                  type="button"
                  className={styles.danger}
                  disabled={busy}
                  onClick={() => void onReject()}
                >
                  {isPlanApproval ? t('task.cancelTask') : t('task.reject')}
                </button>
              </div>
            )}
          </section>
        ) : null}

        {verifyFailed ? (
          <section className={styles.approval}>
            <h3>{t('task.verifyFailed')}</h3>
            <p className={styles.warn}>{userFacingErrorMessage('verify failed')}</p>
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.primary}
                onClick={() => {
                  void requestTaskChanges(task.id, '검증 실패를 수정해 주세요.')
                }}
              >
                {t('task.askCodexFix')}
              </button>
              <button type="button" className={styles.danger} onClick={() => cancelTask(task.id)}>
                {t('task.stopTask')}
              </button>
            </div>
          </section>
        ) : null}

        {task.webSearchFailure ? (
          <section className={styles.pipeline}>
            <h3>조사에 문제가 있어요</h3>
            <p className={styles.warn}>{userFacingErrorMessage(task.webSearchFailure.message)}</p>
            <div className={styles.actions}>
              <button type="button" className={styles.primary} onClick={() => retryWebSearch(task.id)}>
                {t('task.retry')}
              </button>
              <button type="button" onClick={() => continueWithoutWebSearch(task.id)}>
                검색 없이 계속
              </button>
              <button type="button" onClick={() => setShowTechError((v) => !v)}>
                {showTechError ? '상세 숨기기' : '상세 보기'}
              </button>
            </div>
            {showTechError ? (
              <pre className={styles.resultPre}>{task.webSearchFailure.message}</pre>
            ) : null}
          </section>
        ) : null}

        {(task.status === 'failed' || task.status === 'blocked') && lastError ? (
          <section className={styles.pipeline}>
            <h3>문제 발생</h3>
            <p className={styles.warn}>{userFacingErrorMessage(lastError)}</p>
            <div className={styles.actions}>
              <button type="button" className={styles.primary} onClick={() => retryTask(task.id)}>
                {t('task.retry')}
              </button>
              <button type="button" onClick={() => setShowTechError((v) => !v)}>
                {showTechError ? '상세 숨기기' : '상세 보기'}
              </button>
            </div>
            {showTechError ? <pre className={styles.resultPre}>{lastError}</pre> : null}
          </section>
        ) : null}

        {task.status === 'completed' ? (
          <section className={styles.pipeline}>
            <h3>작업 완료</h3>
            {task.finalResult ? (
              <p className={styles.desc}>{task.finalResult.slice(0, 500)}</p>
            ) : (
              <p className={styles.desc}>결과가 준비되었습니다.</p>
            )}
            {taskArtifacts.length > 0 ? (
              <ul className={styles.runList}>
                {taskArtifacts.slice(0, 6).map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      className={styles.linkBtn}
                      onClick={() => {
                        selectArtifact(a.id)
                        setNav('documents')
                      }}
                    >
                      {artifactIcon(a.type)} {a.title}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.primary}
                onClick={() => {
                  selectTask(null)
                  setNav('documents')
                }}
              >
                {t('task.viewArtifacts')}
              </button>
            </div>
          </section>
        ) : null}

        {taskArtifacts.length > 0 && task.status !== 'completed' ? (
          <section className={styles.pipeline}>
            <h3>{t('task.artifacts')}</h3>
            <ul className={styles.runList}>
              {taskArtifacts.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    className={styles.linkBtn}
                    onClick={() => {
                      selectArtifact(a.id)
                      setNav('documents')
                    }}
                  >
                    {artifactIcon(a.type)} {a.title}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <div className={styles.actions}>
          {task.status === 'queued' && !confirmImplement ? (
            <button type="button" className={styles.primary} onClick={onStartClick}>
              <Play size={14} /> {t('task.start')}
            </button>
          ) : null}
          {task.status === 'running' || task.status === 'verifying' ? (
            <button type="button" onClick={() => pauseTask(task.id)}>
              <Pause size={14} /> {t('task.pause')}
            </button>
          ) : null}
          {task.status === 'paused' || task.status === 'blocked' || task.status === 'interrupted' ? (
            <button type="button" className={styles.primary} onClick={() => resumeTask(task.id)}>
              <Play size={14} /> {t('task.resume')}
            </button>
          ) : null}
          {task.status === 'blocked' || task.status === 'failed' ? (
            <>
              <button type="button" onClick={() => retryFailedStep(task.id)}>
                <RotateCcw size={14} /> {t('task.retryStep')}
              </button>
              <button type="button" onClick={() => retryFromPreviousStep(task.id)}>
                {t('task.retryFromPrevious')}
              </button>
            </>
          ) : null}
          {task.status === 'running' ||
          task.status === 'paused' ||
          task.status === 'queued' ||
          task.status === 'blocked' ||
          task.status === 'awaiting_approval' ||
          task.status === 'verifying' ||
          task.status === 'interrupted' ? (
            <button type="button" className={styles.danger} onClick={() => cancelTask(task.id)}>
              <Ban size={14} /> {t('task.cancel')}
            </button>
          ) : null}
        </div>

        <button
          type="button"
          className={styles.speed}
          style={{ margin: '8px 0' }}
          onClick={() => setShowAdvanced((v) => !v)}
        >
          {showAdvanced ? (
            <>
              <ChevronUp size={12} /> {t('task.hideAdvanced')}
            </>
          ) : (
            <>
              <ChevronDown size={12} /> {t('task.showAdvanced')}
            </>
          )}
        </button>

        {/* ── Advanced ── */}
        {showAdvanced ? (
          <>
            {usageAgg && usageAgg.calls > 0 ? (
              <section className={styles.pipeline}>
                <h3>{t('task.executionSummary')}</h3>
                <ul className={styles.fileList}>
                  <li>AI 호출: {usageAgg.openaiCalls + usageAgg.mockCalls}</li>
                  <li>Tokens: {formatTokens(usageAgg.totalTokens)}</li>
                  <li>예상 비용: {formatCost(usageAgg)}</li>
                  <li>코드 실행: {usageAgg.codexRuns}</li>
                  <li>웹 검색: {usageAgg.webSearches}</li>
                </ul>
              </section>
            ) : null}

            {project?.path ? (
              <section className={styles.preflight}>
                <h3>{t('task.preflight')}</h3>
                <p>
                  경로: <code>{project.path}</code>
                </p>
                {hasImplement ? (
                  <p className={styles.warn}>{t('task.filesMayModify')}</p>
                ) : (
                  <p>{t('task.readOnly')}</p>
                )}
              </section>
            ) : null}

            {!awaiting &&
            latestImplement &&
            (latestImplement.changedFiles?.length ?? 0) > 0 ? (
              <section className={styles.pipeline}>
                <h3>{t('task.diffViewer')}</h3>
                <DiffViewer
                  diffByFile={latestImplement.diffByFile}
                  unifiedDiff={latestImplement.unifiedDiff}
                  added={latestImplement.addedFiles}
                  modified={latestImplement.modifiedFiles}
                  deleted={latestImplement.deletedFiles}
                  changedFiles={latestImplement.changedFiles}
                />
              </section>
            ) : null}

            {(task.implementationIterations?.length ?? 0) > 0 ? (
              <section className={styles.pipeline}>
                <h3>{t('task.iterations')}</h3>
                <ol>
                  {task.implementationIterations!.map((it) => (
                    <li key={`${it.runId}-${it.index}`}>
                      <strong>#{it.index}</strong>
                      <em>{it.status}</em>
                      {it.feedback ? <small> — {it.feedback}</small> : null}
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}

            {runs.length > 0 ? (
              <section className={styles.pipeline}>
                <h3>
                  {t('task.openaiRuns')} {runs.length}
                  {tokenTotal > 0 ? ` · 토큰 ${tokenTotal}` : ''}
                </h3>
                <ol>
                  {runs.map((run) => (
                    <li key={run.id} data-status={run.status}>
                      <div>
                        <strong>{agentName(run.agentId)}</strong>
                        <em>{run.inputSummary}</em>
                        <small>
                          {run.status}
                          {run.error ? ` — ${run.error}` : ''}
                        </small>
                        {run.output ? (
                          <button
                            type="button"
                            className={styles.speed}
                            style={{ marginTop: 6 }}
                            onClick={() =>
                              setExpandedRun(expandedRun === run.id ? null : run.id)
                            }
                          >
                            {expandedRun === run.id
                              ? t('task.hideResult')
                              : t('task.viewResult')}
                          </button>
                        ) : null}
                        {expandedRun === run.id && run.output ? (
                          <pre className={styles.resultPre}>{run.output}</pre>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}

            {codexRuns.length > 0 ? (
              <section className={styles.pipeline}>
                <h3>
                  {t('task.codexRuns')} {codexRuns.length}
                </h3>
                <ol>
                  {codexRuns.map((run) => (
                    <li key={run.id} data-status={run.status}>
                      <div>
                        <strong>{agentName(run.agentId)}</strong>
                        <em>
                          {run.mode}
                          {run.activity ? ` · ${run.activity}` : ''}
                        </em>
                        <small>
                          {run.status}
                          {run.userMessageKo || run.error
                            ? ` — ${run.userMessageKo || run.error}`
                            : ''}
                        </small>
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}

            {verifyCommands.length > 0 ? (
              <section className={styles.pipeline}>
                <h3>{t('task.verification')}</h3>
                <ul className={styles.fileList}>
                  {verifyCommands.map((c, i) => (
                    <li key={`${c.name}-${i}`}>
                      <strong>{c.name}</strong> {c.status}
                      <small> · {c.command}</small>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {(task.webSearchSessions?.length ?? 0) > 0 ? (
              <section className={styles.pipeline}>
                <h3>검색 기록</h3>
                <button
                  type="button"
                  className={styles.speed}
                  onClick={() => setShowSearchHistory((v) => !v)}
                >
                  {showSearchHistory ? '숨기기' : '보기'}
                </button>
                {showSearchHistory ? (
                  <ul className={styles.runList}>
                    {task.webSearchSessions!.map((sess) => (
                      <li key={sess.id}>
                        <strong>{new Date(sess.searchedAt).toLocaleString()}</strong>
                        <div className={styles.meta}>
                          {sess.queries.join(' · ')}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ) : null}

            {task.finalResult && task.status !== 'completed' ? (
              <section className={styles.pipeline}>
                <h3>{t('task.finalResult')}</h3>
                <pre className={styles.resultPre}>{task.finalResult}</pre>
              </section>
            ) : null}

            {task.executionMode !== 'REAL_AI' ? (
              <div className={styles.dev}>
                <span>데모 배속</span>
                {([1, 2, 4] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={speed === s ? styles.speedOn : styles.speed}
                    onClick={() => setExecutionSpeed(s)}
                  >
                    {s}x
                  </button>
                ))}
                <button
                  type="button"
                  className={styles.failBtn}
                  onClick={() => markSimulateFailure(task.id)}
                >
                  <AlertTriangle size={12} /> 다음 실패
                </button>
              </div>
            ) : null}
          </>
        ) : null}
      </aside>
  )

  if (embedded) {
    return (
      <div className={styles.embedded} aria-label={t('task.detail')}>
        {panel}
      </div>
    )
  }

  return (
    <div className={styles.overlay} role="dialog" aria-modal aria-label={t('task.detail')}>
      <button
        type="button"
        className={styles.backdrop}
        aria-label={t('actions.close')}
        onClick={() => selectTask(null)}
      />
      {panel}
    </div>
  )
}
