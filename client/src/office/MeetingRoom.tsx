import type { Agent } from '../domain/types'
import type { AgentVisualState } from './visual/agentVisual'
import { t } from '../i18n'
import { PropSprite } from './furniture/PropSprite'
import { MeetingTable } from './furniture/SheetProps'
import styles from './MeetingRoom.module.css'

interface Props {
  agents: Agent[]
  visuals: AgentVisualState[]
  onSelectAgent: (id: string) => void
}

/** Meeting — table for review/handoff. */
export function MeetingRoom(_props: Props) {
  return (
    <div className={styles.room} data-room="meeting">
      <div className={styles.wallTop} />
      <header className={styles.header}>
        <span>{t('room.meeting')}</span>
      </header>
      <svg className={styles.furniture} viewBox="0 0 240 170" preserveAspectRatio="xMidYMid meet" aria-hidden>
        <PropSprite
          id="meeting-table"
          x={28}
          y={50}
          width={180}
          height={95}
          fallback={<MeetingTable x={28} y={50} />}
        />
      </svg>
    </div>
  )
}
