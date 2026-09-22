import type { Agent } from '../domain/types'
import type { AgentVisualState } from './visual/agentVisual'
import { t } from '../i18n'
import { PropSprite } from './furniture/PropSprite'
import { SofaYellow } from './furniture/SheetProps'
import styles from './Lounge.module.css'

interface Props {
  agents: Agent[]
  visuals: AgentVisualState[]
  onSelectAgent: (id: string) => void
}

/** Lounge — idle/waiting hub. Minimal prototype furniture. */
export function Lounge(_props: Props) {
  return (
    <div className={styles.room} data-room="lounge">
      <div className={styles.wallTop} />
      <header className={styles.header}>
        <span>{t('room.lounge')}</span>
      </header>
      <svg className={styles.scene} viewBox="0 0 560 300" preserveAspectRatio="xMidYMid meet" aria-hidden>
        <PropSprite id="sofa" x={200} y={100} fallback={<SofaYellow x={200} y={100} />} />
      </svg>
    </div>
  )
}
