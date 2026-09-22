import { useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { selectTeamAgents, useDeckStore } from '../../store/useDeckStore'
import type { Agent } from '../../domain/types'
import { assignOfficeDestinations, assignmentForAgent } from './officeAssignmentPolicy'
import { ROOM_LABELS, pointForWaypoint, type OfficePoint } from './officeMap'
import { resolveOfficeV2VisualRole, visualVariationSeed } from './visualRole'
import type { OfficeV2VisualRole } from './manifestTypes'
import developerManifest from '../../../public/assets/office-v2/characters/developer/manifest.json'
import furnitureManifest from '../../../public/assets/office-v2/manifests/office-v2-furniture.json'
import './OfficeV2Scene.css'

type SpriteAnimation = keyof typeof developerManifest.animations
type RuntimeCharacter = {
  agent: Agent
  point: OfficePoint
  target: OfficePoint
  route: OfficePoint[]
  routeIndex: number
  animation: SpriteAnimation
  facing: string
}
const furniture = Object.fromEntries(furnitureManifest.assets.map((asset) => [asset.id, asset]))

/** Existing role art is the visual fallback until dedicated composable atlases pass the gate. */
const ROLE_ASSET_DIR: Record<OfficeV2VisualRole, string> = {
  pm: 'pm',
  developer: 'developer',
  'game-developer': 'game-designer',
  designer: 'designer',
  researcher: 'researcher',
  marketer: 'marketer',
  qa: 'tester',
  reviewer: 'manager',
}

const NORTH_EXIT = { x: 800, y: 390 }
const SOUTH_EXIT = { x: 800, y: 610 }
const NORTH_HALL = { x: 800, y: 350 }
const SOUTH_HALL = { x: 800, y: 650 }

function routeFor(current: OfficePoint, target: OfficePoint): OfficePoint[] {
  const isLounge = target.y >= 380 && target.y <= 620
  if (isLounge) {
    if (current.y < 340) return [NORTH_HALL, NORTH_EXIT, target]
    if (current.y > 660) return [SOUTH_HALL, SOUTH_EXIT, target]
    return [target]
  }

  const targetIsNorth = target.y < 320
  const targetIsSouth = target.y > 680
  const route: OfficePoint[] = []
  if (current.y < 340 && targetIsNorth) {
    route.push({ x: target.x, y: 350 })
  } else if (current.y > 660 && targetIsSouth) {
    route.push({ x: target.x, y: 650 })
  } else if (targetIsNorth) {
    if (current.y > 660) route.push(SOUTH_HALL, SOUTH_EXIT)
    route.push(NORTH_EXIT, NORTH_HALL, { x: target.x, y: 350 })
  } else {
    if (current.y < 340) route.push(NORTH_HALL, NORTH_EXIT)
    route.push(SOUTH_EXIT, SOUTH_HALL, { x: target.x, y: 650 })
  }
  route.push(target)
  return route
}

function spriteAnimation(agent: Agent, moving: boolean, facing: string): SpriteAnimation {
  if (moving) return `walk-${facing}` as SpriteAnimation
  if (agent.status === 'working' || agent.status === 'blocked' || agent.status === 'verifying') return 'work'
  if (agent.status === 'reviewing') return 'talk'
  return 'idle'
}

function rolePose(animation: SpriteAnimation): 'idle' | 'walking' | 'working' | 'talking' {
  if (animation.startsWith('walk')) return 'walking'
  if (animation === 'work') return 'working'
  if (animation === 'talk') return 'talking'
  return 'idle'
}

function mapFurniture(id: string, x: number, y: number, className = '') {
  const asset = furniture[id]
  if (!asset || asset.status !== 'ready') return null
  return <img className={`office-v2-furniture ${className}`} key={`${id}-${x}-${y}`} src={`/assets/office-v2/${asset.src}`} alt="" style={{ left: `${(x / 1600) * 100}%`, top: `${(y / 1000) * 100}%`, width: `${(asset.logicalWidth / 1600) * 100}%`, zIndex: y }} />
}

function Sprite({ character }: { character: RuntimeCharacter }) {
  const [frame, setFrame] = useState(0)
  const animation = developerManifest.animations[character.animation]
  const rect = animation.rects[frame % animation.rects.length]
  useEffect(() => {
    setFrame(0)
    const timer = window.setInterval(() => setFrame((value) => (value + 1) % animation.rects.length), 1000 / animation.fps)
    return () => window.clearInterval(timer)
  }, [animation.fps, animation.rects.length, character.animation])
  const variationSeed = visualVariationSeed(character.agent.id)
  const hue = (variationSeed % 5) * 7 - 14
  const role = resolveOfficeV2VisualRole(character.agent)
  const roleDir = ROLE_ASSET_DIR[role]
  const rolePoseName = rolePose(character.animation)
  const roleImage = `/assets/characters/${roleDir}/${rolePoseName}.png`
  const usePilotAtlas = role === 'developer'
  const x = (character.point.x / 1600) * 100
  const y = (character.point.y / 1000) * 100
  return (
    <button className="office-v2-character" type="button" aria-label={character.agent.name} data-role={role} data-animation={character.animation} style={{ left: `${x}%`, top: `${y}%`, zIndex: Math.round(character.point.y) }}>
      <span className="office-v2-character-clip">
        {usePilotAtlas ? <span className="office-v2-character-atlas" aria-hidden="true" style={{ width: developerManifest.frameWidth * 0.75, height: developerManifest.frameHeight * 0.75, backgroundImage: 'url(/assets/office-v2/characters/developer/atlas.png)', backgroundSize: `${developerManifest.sheetWidth * 0.75}px ${developerManifest.sheetHeight * 0.75}px`, backgroundPosition: `${-rect.x * 0.75}px ${-rect.y * 0.75}px`, filter: `hue-rotate(${hue}deg)` }} /> : <img className="office-v2-character-role" src={roleImage} alt="" style={{ filter: `hue-rotate(${hue}deg)` }} />}
      </span>
      {character.agent.status === 'blocked' ? <i className="office-v2-blocked">!</i> : null}
      <span className="office-v2-name">{character.agent.name}</span>
    </button>
  )
}

function initialPoint(_agent: Agent, index: number): OfficePoint {
  // Start at a door so a refresh has a short, readable walk-in. Once the
  // destination is reached the canonical status policy takes over.
  return index % 2 === 0 ? NORTH_EXIT : SOUTH_EXIT
}

export function OfficeV2Scene() {
  const roster = useDeckStore(useShallow(selectTeamAgents)).slice(0, 30)
  const agents = useMemo(() => roster.filter((agent) => agent.status !== 'offline'), [roster])
  const selectAgent = useDeckStore((state) => state.selectAgent)
  const assignments = useMemo(() => assignOfficeDestinations(agents), [agents])
  const [characters, setCharacters] = useState<RuntimeCharacter[]>(() => agents.map((agent, index) => {
    const point = initialPoint(agent, index)
    return { agent, point, target: point, route: [], routeIndex: 0, animation: 'idle', facing: 'down' }
  }))
  const last = useRef(0)

  useEffect(() => {
    setCharacters((current) => agents.map((agent, index) => {
      const assignment = assignmentForAgent(assignments, agent.id)
      const target = assignment?.overflow ? initialPoint(agent, index) : pointForWaypoint(assignment?.waypointId)
      const existing = current.find((item) => item.agent.id === agent.id)
      const point = existing?.point ?? initialPoint(agent, index)
      const changed = !existing || existing.target.x !== target.x || existing.target.y !== target.y
      return {
        agent,
        point,
        target,
        route: changed ? routeFor(point, target) : existing.route,
        routeIndex: changed ? 0 : existing.routeIndex,
        animation: existing?.animation ?? 'idle',
        facing: existing?.facing ?? 'down',
      }
    }))
  }, [agents, assignments])

  useEffect(() => {
    let raf = 0
    const tick = (now: number) => {
      const dt = last.current ? Math.min((now - last.current) / 1000, 0.05) : 0
      last.current = now
      setCharacters((current) => current.map((character) => {
        const waypoint = character.route[character.routeIndex]
        if (!waypoint) return { ...character, point: character.target, animation: spriteAnimation(character.agent, false, character.facing) }
        const dx = waypoint.x - character.point.x
        const dy = waypoint.y - character.point.y
        const distance = Math.hypot(dx, dy)
        if (distance < 1) {
          const nextIndex = character.routeIndex + 1
          if (nextIndex >= character.route.length) {
            return { ...character, point: character.target, routeIndex: nextIndex, animation: spriteAnimation(character.agent, false, character.facing) }
          }
          return { ...character, point: waypoint, routeIndex: nextIndex }
        }
        const step = Math.min(distance, 105 * dt)
        const facing = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down')
        return { ...character, point: { x: character.point.x + (dx / distance) * step, y: character.point.y + (dy / distance) * step }, facing, animation: spriteAnimation(character.agent, true, facing) }
      }))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const roomArt = [
    mapFurniture('desk', 105, 245, 'desk desk-a'), mapFurniture('desk', 235, 245, 'desk desk-b'),
    mapFurniture('desk-dual-monitor', 485, 245, 'desk desk-dual'), mapFurniture('desk-dual-monitor', 655, 245, 'desk desk-dual'),
    mapFurniture('desk-dual-monitor', 865, 245, 'desk desk-dual'), mapFurniture('desk-dual-monitor', 1035, 245, 'desk desk-dual'),
    mapFurniture('desk', 1290, 245, 'desk desk-a'), mapFurniture('desk', 1430, 245, 'desk desk-b'),
    mapFurniture('desk', 105, 915, 'desk desk-bottom'), mapFurniture('desk', 235, 915, 'desk desk-bottom'),
    mapFurniture('sofa', 620, 555, 'sofa'),
    mapFurniture('armchair', 360, 570, 'armchair armchair-left'), mapFurniture('armchair', 865, 570, 'armchair armchair-right'),
    mapFurniture('coffee-table', 620, 625, 'coffee-table'),
    mapFurniture('coffee-machine', 270, 585, 'coffee-machine'), mapFurniture('bookshelf', 1370, 585, 'bookshelf'),
    mapFurniture('meeting-table', 600, 920, 'meeting-table'), mapFurniture('whiteboard', 650, 780, 'whiteboard'),
    mapFurniture('plant-large', 145, 565, 'plant plant-large'), mapFurniture('plant-large', 1490, 565, 'plant plant-large'),
    mapFurniture('plant-medium', 340, 280, 'plant plant-room'), mapFurniture('plant-medium', 1240, 280, 'plant plant-room'),
    mapFurniture('plant-small', 760, 695, 'plant'), mapFurniture('plant-small', 1180, 890, 'plant'),
  ]

  return (
    <div className="office-v2-scene">
      <div className="office-v2-toolbar"><div><span className="office-v2-kicker">OFFICE V2 · LIVE FLOOR</span><h1>AI Team Office</h1></div><span className="office-v2-count"><b>{agents.length}</b> agents on floor</span></div>
      <div className="office-v2-board">
        <div className="office-v2-map">
          <div className="office-v2-hall north" /><div className="office-v2-hall south" />
          <div className="office-v2-lounge-label">Lounge</div>
          {ROOM_LABELS.map(([id, label]) => <div className={`office-v2-room-label room-${id}`} key={id}>{label}</div>)}
          <div className="office-v2-room room-product" /><div className="office-v2-room room-design" /><div className="office-v2-room room-development" /><div className="office-v2-room room-research" />
          <div className="office-v2-room room-marketing" /><div className="office-v2-room room-meeting" /><div className="office-v2-room room-testing" />
          <div className="office-v2-lounge" />
          {roomArt}
          <div className="office-v2-character-layer">{characters.map((character) => <span key={character.agent.id} onClick={() => selectAgent(character.agent.id)}><Sprite character={character} /></span>)}</div>
        </div>
      </div>
      <div className="office-v2-footer"><span><i className="dot green" /> Working spaces stay open for movement</span><span>Idle / waiting → Lounge · Reviewing → Meeting · Verifying → QA</span></div>
    </div>
  )
}
