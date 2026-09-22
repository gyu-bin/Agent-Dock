import type { RoomId } from './officeModel'
import { PropSprite } from './furniture/PropSprite'
import { DeskBasic, DeskDual } from './furniture/SheetProps'
import styles from './Workstation.module.css'

/** Department rooms — one desk per team member in that division (capped). */
export function Workstation({
  roomId,
  deskCount = 1,
}: {
  roomId: RoomId
  deskCount?: number
}) {
  const count = Math.max(1, Math.min(deskCount, 8))
  const dual =
    roomId === 'engineering' || roomId === 'game-development'
  const cols = Math.min(count, count <= 3 ? count : Math.ceil(Math.sqrt(count)))
  const rows = Math.ceil(count / cols)
  const viewW = 40 + cols * 95
  const viewH = 28 + rows * 70

  const desks = Array.from({ length: count }, (_, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    const x = 12 + col * 95
    const y = 8 + row * 68
    const useDual = dual && i === 0
    return (
      <g key={i}>
        {useDual ? (
          <PropSprite
            id="dual-monitor-desk"
            x={x}
            y={y}
            fallback={<DeskDual x={x} y={y} />}
          />
        ) : (
          <PropSprite
            id="desk"
            x={x}
            y={y}
            fallback={<DeskBasic x={x} y={y} />}
          />
        )}
      </g>
    )
  })

  return (
    <svg
      className={styles.scene}
      viewBox={`0 0 ${viewW} ${viewH}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
    >
      {desks}
    </svg>
  )
}
