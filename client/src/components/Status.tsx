import type { ReactNode } from 'react'
import styles from './Status.module.css'

export type StatusTone = 'success' | 'warning' | 'danger' | 'primary' | 'muted'

export function StatusDot({
  tone = 'muted',
  title,
}: {
  tone?: StatusTone
  title?: string
}) {
  return <span className={styles.dot} data-tone={tone} title={title} />
}

export function StatusBadge({
  children,
  tone = 'muted',
}: {
  children: ReactNode
  tone?: StatusTone
}) {
  return (
    <span className={styles.badge} data-tone={tone}>
      {children}
    </span>
  )
}

export function ProviderStatus({
  ok,
  label,
}: {
  ok: boolean
  label: string
}) {
  return (
    <span className={styles.provider} data-ok={ok ? 'true' : 'false'}>
      <StatusDot tone={ok ? 'success' : 'danger'} />
      {label}
    </span>
  )
}

const TASK_TONE: Record<string, StatusTone> = {
  completed: 'success',
  done: 'success',
  running: 'primary',
  working: 'primary',
  reviewing: 'primary',
  awaiting_approval: 'warning',
  waiting: 'warning',
  blocked: 'danger',
  failed: 'danger',
  rejected: 'danger',
  cancelled: 'muted',
  idle: 'muted',
  queued: 'muted',
}

export function TaskStatus({
  status,
  label,
}: {
  status: string
  label?: string
}) {
  const tone = TASK_TONE[status] ?? 'muted'
  return (
    <StatusBadge tone={tone}>
      <StatusDot tone={tone} />
      {label ?? status}
    </StatusBadge>
  )
}
