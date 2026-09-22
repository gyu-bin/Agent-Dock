import { useShallow } from 'zustand/react/shallow'
import { getDepartment } from '../domain/departments'
import {
  userFacingTaskStatus,
  userFacingWorkflowLabel,
} from '../domain/taskDisplay'
import { displayAgentName, t } from '../i18n'
import {
  selectStatusBreakdown,
  selectTasksForActive,
  selectTeamAgents,
  useDeckStore,
} from '../store/useDeckStore'
import styles from './BottomPanel.module.css'

export function BottomPanel() {
  const tasks = useDeckStore(useShallow(selectTasksForActive))
  const agents = useDeckStore(useShallow(selectTeamAgents))
  const breakdown = useDeckStore(selectStatusBreakdown)
  const selectTask = useDeckStore((s) => s.selectTask)
  const steps = useDeckStore((s) => s.pipelineSteps)
  const registry = useDeckStore((s) => s.registry)

  const agentById = new Map(agents.map((a) => [a.id, a]))
  const ongoing = tasks
    .filter((task) =>
      [
        'running',
        'paused',
        'queued',
        'blocked',
        'review',
        'awaiting_approval',
        'verifying',
        'interrupted',
      ].includes(task.status),
    )
    .slice(0, 8)

  const slices = [
    { key: 'working', label: t('status.working'), value: breakdown.working, color: '#22c55e' },
    { key: 'waiting', label: t('status.waiting'), value: breakdown.waiting, color: '#f59e0b' },
    {
      key: 'reviewing',
      label: t('status.inMeeting'),
      value: breakdown.reviewing + (breakdown.verifying ?? 0),
      color: '#3b82f6',
    },
    {
      key: 'idle',
      label: t('status.inLounge'),
      value: breakdown.idle,
      color: '#94a3b8',
    },
    { key: 'blocked', label: t('status.blocked'), value: breakdown.blocked, color: '#ef4444' },
  ]

  return (
    <footer className={styles.panel}>
      <section className={styles.tasks} aria-label={t('task.ongoing')}>
        <header className={styles.sectionHead}>
          <h3>{t('task.ongoing')}</h3>
          <span>{t('task.activeCount', { n: ongoing.length })}</span>
        </header>
        {ongoing.length === 0 ? (
          <p className={styles.emptyHint}>{t('task.emptyOngoing')}</p>
        ) : (
          <ul className={styles.taskList}>
            {ongoing.map((task) => {
              const taskSteps = steps.filter((s) => s.taskId === task.id)
              const current =
                taskSteps.find(
                  (s) =>
                    s.status === 'running' ||
                    s.status === 'reviewing' ||
                    s.status === 'awaiting_approval',
                ) ?? taskSteps.find((s) => s.status === 'waiting')
              const isHumanGate =
                task.status === 'awaiting_approval' ||
                current?.provider === 'human' ||
                Boolean(current?.approvalKind)
              const lead =
                !isHumanGate && current
                  ? agentById.get(current.agentId) ??
                    registry.find((a) => a.id === current.agentId)
                  : undefined
              const dept = lead ? getDepartment(lead.division) : null
              const statusLabel = userFacingTaskStatus(task, current)
              return (
                <li key={task.id}>
                  <button
                    type="button"
                    className={styles.taskRow}
                    onClick={() => selectTask(task.id)}
                  >
                    <span className={styles.taskTitle}>{task.title}</span>
                    <span className={styles.workflowChip}>
                      {userFacingWorkflowLabel(task)}
                    </span>
                    {dept ? (
                      <span
                        className={styles.deptChip}
                        style={{ background: `${dept.color}18`, color: dept.color }}
                      >
                        {dept.shortLabel}
                      </span>
                    ) : (
                      <span />
                    )}
                    <span
                      className={styles.agentMini}
                      title={
                        isHumanGate
                          ? '사용자 승인'
                          : lead
                            ? displayAgentName(lead.id, lead.name)
                            : '승인 대기'
                      }
                    >
                      {isHumanGate ? '👤' : lead ? lead.name.slice(0, 1) : '👤'}
                    </span>
                    <div className={styles.progressWrap}>
                      <div className={styles.progressTrack}>
                        <div
                          className={styles.progressFill}
                          style={{ width: `${task.progress}%` }}
                        />
                      </div>
                      <span>{task.progress}%</span>
                    </div>
                    <span className={styles.eta}>{statusLabel}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className={styles.team} aria-label={t('task.teamStatus')}>
        <header className={styles.sectionHead}>
          <h3>{t('task.teamStatus')}</h3>
          <span>{breakdown.total}명</span>
        </header>
        <div className={styles.legend}>
          {slices.map((s) => (
            <div key={s.key} className={styles.legendItem}>
              <i style={{ background: s.color }} />
              <span className={styles.legendLabel}>{s.label}</span>
              <strong className={styles.legendValue}>{s.value}</strong>
            </div>
          ))}
        </div>
      </section>
    </footer>
  )
}
