import type { AgentStatus } from '../domain/types'
import styles from './StatusIndicator.module.css'

/** Minimal status cue — idle has no indicator. */
export function StatusIndicator({ status }: { status: AgentStatus }) {
  if (status === 'idle' || status === 'offline') return null
  if (status === 'blocked') {
    return (
      <span className={styles.warn} aria-hidden title="blocked">
        !
      </span>
    )
  }
  return <span className={styles.dot} data-status={status} aria-hidden />
}
