import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { selectTeamAgents, useDeckStore } from '../store/useDeckStore'
import type { DivisionId } from '../domain/types'
import { AgentCharacter } from './AgentCharacter'
import { DepartmentRoom } from './DepartmentRoom'
import { Entrance } from './Entrance'
import { Lounge } from './Lounge'
import { MeetingRoom } from './MeetingRoom'
import { Reception } from './Reception'
import {
  activeDepartmentIds,
  computeRoomAnchors,
  deskCountByDivision,
  roomDefForDivision,
} from './officeLayout'
import { buildVisualStates } from './visual/agentVisual'
import styles from './OfficeScene.module.css'

export function OfficeScene() {
  const agents = useDeckStore(useShallow(selectTeamAgents))
  const selectAgent = useDeckStore((s) => s.selectAgent)
  const selectedDepartment = useDeckStore((s) => s.selectedDepartment)
  const selectDepartment = useDeckStore((s) => s.selectDepartment)
  const openManageTeam = useDeckStore((s) => s.openManageTeam)

  const deptIds = useMemo(() => activeDepartmentIds(agents), [agents])
  const deskCounts = useMemo(() => deskCountByDivision(agents), [agents])
  const anchors = useMemo(() => computeRoomAnchors(deptIds), [deptIds])
  const deptRooms = useMemo(
    () => deptIds.map((id) => roomDefForDivision(id)),
    [deptIds],
  )

  const { states: visuals, overflows } = useMemo(
    () => buildVisualStates(agents, anchors),
    [agents, anchors],
  )

  const emptyVisuals = useMemo(() => [], [])

  function openDept(id: DivisionId) {
    selectDepartment(id)
    openManageTeam()
  }

  function onSelectAgent(id: string) {
    selectAgent(id)
    openManageTeam()
  }

  return (
    <div className={styles.scene}>
      <div className={styles.floor}>
        <div className={styles.board}>
          <div
            className={styles.grid}
            data-has-depts={deptIds.length > 0 ? '1' : '0'}
          >
            {deptRooms.length > 0 ? (
              <div
                className={styles.deptRow}
                style={{
                  gridTemplateColumns: `repeat(${deptRooms.length}, minmax(0, 1fr))`,
                }}
              >
                {deptRooms.map((room) => (
                  <DepartmentRoom
                    key={room.id}
                    room={room}
                    agents={agents}
                    visuals={emptyVisuals}
                    deskCount={deskCounts[room.id] ?? 1}
                    highlighted={selectedDepartment === room.id}
                    onSelectAgent={onSelectAgent}
                    onOpenDepartment={() => openDept(room.id as DivisionId)}
                  />
                ))}
              </div>
            ) : null}

            <div className={styles.lounge}>
              <Lounge
                agents={agents}
                visuals={emptyVisuals}
                onSelectAgent={onSelectAgent}
              />
            </div>

            <div className={styles.commonRow}>
              <div className={styles.meeting}>
                <MeetingRoom
                  agents={agents}
                  visuals={emptyVisuals}
                  onSelectAgent={onSelectAgent}
                />
              </div>
              <div className={styles.reception}>
                <Reception
                  agents={agents}
                  visuals={emptyVisuals}
                  onSelectAgent={onSelectAgent}
                />
              </div>
              <div className={styles.entrance}>
                <Entrance />
              </div>
            </div>
          </div>

          <div className={styles.actorLayer} aria-label="에이전트">
            {visuals.map((v) => {
              const agent = agents.find((a) => a.id === v.agentId)
              if (!agent) return null
              return (
                <AgentCharacter
                  key={v.agentId}
                  agent={agent}
                  visual={v}
                  onSelect={onSelectAgent}
                />
              )
            })}
            {overflows.map((o) => (
              <div
                key={`overflow-${o.roomId}`}
                className={styles.overflowBadge}
                style={{ left: `${o.x}%`, top: `${o.y}%` }}
                title={`이 공간에 ${o.hidden}명 더 있음`}
              >
                +{o.hidden}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
