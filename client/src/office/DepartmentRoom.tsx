import type { Agent } from '../domain/types'
import type { OfficePlacement, RoomDef } from './officeModel'
import type { AgentVisualState } from './visual/agentVisual'
import { AgentCharacter } from './AgentCharacter'
import { Workstation } from './Workstation'
import styles from './DepartmentRoom.module.css'

interface Props {
  room: RoomDef
  agents: Agent[]
  visuals: AgentVisualState[]
  /** @deprecated placements kept for compatibility — visuals drive positions */
  placements?: OfficePlacement[]
  highlighted: boolean
  onSelectAgent: (id: string) => void
  onOpenDepartment?: () => void
  edgeRight?: boolean
  edgeBottom?: boolean
  deskCount?: number
}

export function DepartmentRoom({
  room,
  agents,
  visuals,
  highlighted,
  onSelectAgent,
  onOpenDepartment,
  edgeRight,
  edgeBottom,
  deskCount = 1,
}: Props) {
  const agentMap = new Map(agents.map((a) => [a.id, a]))
  const here = visuals.filter((v) => v.roomId === room.id)

  return (
    <div
      className={styles.room}
      data-room={room.id}
      data-highlight={highlighted || undefined}
      data-edge-right={edgeRight || undefined}
      data-edge-bottom={edgeBottom || undefined}
      style={{ ['--accent' as string]: room.accent }}
      role={onOpenDepartment ? 'button' : undefined}
      tabIndex={onOpenDepartment ? 0 : undefined}
      onClick={(e) => {
        if (!onOpenDepartment) return
        if ((e.target as HTMLElement).closest('[data-agent-char]')) return
        onOpenDepartment()
      }}
      onKeyDown={(e) => {
        if (!onOpenDepartment) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpenDepartment()
        }
      }}
    >
      <div className={styles.floorWash} aria-hidden />
      <div className={styles.wallTop} />
      <div className={styles.doorway} aria-hidden />
      {room.label ? (
        <header className={styles.header}>
          <span>{room.label}</span>
        </header>
      ) : null}
      {room.kind === 'department' ? (
        <Workstation roomId={room.id} deskCount={deskCount} />
      ) : null}
      {here.map((v) => {
        const agent = agentMap.get(v.agentId)
        if (!agent) return null
        return (
          <AgentCharacter
            key={agent.id}
            agent={agent}
            visual={v}
            onSelect={onSelectAgent}
          />
        )
      })}
    </div>
  )
}
