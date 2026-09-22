import type { Agent } from '../domain/types'
import type { AgentVisualState } from './visual/agentVisual'
import { t } from '../i18n'
import { PropSprite } from './furniture/PropSprite'
import { ReceptionDesk } from './furniture/SheetProps'
import styles from './Reception.module.css'

interface Props {
  agents: Agent[]
  visuals: AgentVisualState[]
  onSelectAgent: (id: string) => void
}

/** Reception — desk + label only. */
export function Reception(_props: Props) {
  return (
    <div className={styles.room} data-room="reception">
      <div className={styles.wallTop} />
      <header className={styles.header}>
        <span>{t('room.reception')}</span>
      </header>
      <svg className={styles.scene} viewBox="0 0 320 170" preserveAspectRatio="xMidYMid meet" aria-hidden>
        <text
          x={160}
          y={28}
          textAnchor="middle"
          fontSize={14}
          fill="#1e293b"
          fontFamily="system-ui,sans-serif"
          fontWeight="700"
        >
          Agent Deck
        </text>
        <PropSprite id="reception-desk" x={50} y={48} fallback={<ReceptionDesk x={30} y={42} />} />
      </svg>
    </div>
  )
}
