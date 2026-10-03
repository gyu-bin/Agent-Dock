import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { selectTeamAgents, useDeckStore } from '../../store/useDeckStore'
import type { Agent } from '../../domain/types'
import { assignOfficeDestinations, assignmentForAgent } from '../v2/officeAssignmentPolicy'
import { pickVariationIndex, resolveOfficeV2VisualRole, visualVariationSeed } from '../v2/visualRole'
import officeMap from '../../../public/assets/pixel-office/office-map.json'
import charManifest from '../../../public/assets/pixel-office/characters.json'
import bubbleManifest from '../../../public/assets/pixel-office/bubbles.json'
import { findPath, type Pt } from './pixelPath'
import { pickDefaultCrew, simulateCrew } from './defaultCrew'
import './PixelOfficeScene.css'

const BASE = '/assets/pixel-office'
const MAP_W = officeMap.width
const MAP_H = officeMap.height
const FW = charManifest.frameWidth
const FH = charManifest.frameHeight
const WALK_SPEED = 54 // map px per second

type Facing = 'up' | 'down' | 'left' | 'right'
type Waypoint = { x: number; y: number; pose: 'sit' | 'stand'; face: Facing }
type Target = Waypoint & { key: string }

const WAYPOINTS = officeMap.waypoints as unknown as Record<string, Waypoint>
const ANIMS = charManifest.animations as unknown as Record<string, { row: number; frames: number }>
const ACCESSORIES = charManifest.accessories as unknown as Record<string, string>

interface Runner {
  agent: Agent
  pos: Pt
  path: Pt[]
  target: Target
  facing: Facing
  moving: boolean
  look: Look
}

interface Look {
  skin: string
  outfit: string
  hair: string
  acc?: string
  seed: number
}

function lookFor(agent: Agent): Look {
  const role = resolveOfficeV2VisualRole(agent)
  const skin = charManifest.skins[pickVariationIndex(agent.id, 1, charManifest.skins.length)]
  const style = charManifest.hairStyles[pickVariationIndex(agent.id, 2, charManifest.hairStyles.length)]
  const color = charManifest.hairColors[pickVariationIndex(agent.id, 4, charManifest.hairColors.length)]
  return {
    skin: `${BASE}/characters/skin-${skin}.png`,
    outfit: `${BASE}/characters/outfit-${role}.png`,
    hair: `${BASE}/characters/hair-${style}-${color}.png`,
    acc: ACCESSORIES[role] ? `${BASE}/characters/acc-${ACCESSORIES[role]}.png` : undefined,
    seed: visualVariationSeed(agent.id),
  }
}

function targetFor(agent: Agent, assignmentKey: string | undefined, overflowIndex: number): Target {
  const wp = assignmentKey ? WAYPOINTS[assignmentKey] : undefined
  if (wp) return { ...wp, key: assignmentKey! }
  const lobby = officeMap.lobby[overflowIndex % officeMap.lobby.length]
  return { x: lobby.x, y: lobby.y, pose: 'stand', face: 'down', key: `lobby.${overflowIndex}.${agent.id}` }
}

function facingToward(dx: number, dy: number, fallback: Facing): Facing {
  if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return fallback
  return Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'down'
}

/** Integer device-pixel scaling keeps every art pixel the same size. */
function crispScale(containerWidth: number): number {
  const dpr = Math.max(1, Math.round(window.devicePixelRatio || 1))
  const raw = Math.floor((containerWidth / MAP_W) * dpr) / dpr
  return Math.max(1 / dpr, Math.min(raw, 3))
}

type Bubble = (typeof bubbleManifest.names)[number]

function bubbleFor(r: Runner, now: number): Bubble | null {
  if (r.moving) return null
  const s = r.agent.status
  if (s === 'blocked') return 'alert'
  if (s === 'verifying') return 'check'
  const phase = (now + (r.look.seed % 9000)) % 9000
  if (s === 'reviewing') return phase < 5200 ? 'dots' : null
  if (r.target.key === 'lounge.stand.7') return 'zzz'
  if (s === 'idle' || s === 'waiting') {
    if (phase > 2600) return null
    const pick = ['coffee', 'note', 'idea', 'dots'] as const
    return pick[r.look.seed % pick.length]
  }
  return null
}

function animationFor(r: Runner, now: number): { row: number; col: number } {
  if (r.moving) {
    const a = ANIMS[`walk-${r.facing}`]
    return { row: a.row, col: Math.floor(now / 125) % a.frames }
  }
  const pose = r.target.pose === 'sit' ? 'sit' : 'idle'
  const a = ANIMS[`${pose}-${r.facing}`]
  const working = r.agent.status === 'working' || r.agent.status === 'blocked'
  if (pose === 'sit' && r.facing === 'up' && working) {
    return { row: a.row, col: Math.floor((now + r.look.seed) / 220) % 2 } // typing
  }
  const blink = (now + (r.look.seed % 4000)) % 3600 < 140
  return { row: a.row, col: blink ? 1 : 0 }
}

const STATUS_KO: Record<Agent['status'], string> = {
  idle: '대기', waiting: '대기', working: '작업 중', reviewing: '리뷰 중',
  verifying: '검증 중', blocked: '막힘', offline: '오프라인',
}

export function PixelOfficeScene({ preview = false }: { preview?: boolean }) {
  const teamRoster = useDeckStore(useShallow((s) => selectTeamAgents(s).slice(0, 30)))
  const registry = useDeckStore((s) => s.registry)
  const openWizard = useDeckStore((s) => s.openWizard)
  const crew = useMemo(() => (preview ? pickDefaultCrew(registry) : []), [preview, registry])
  const [simClock, setSimClock] = useState(() => Date.now())
  useEffect(() => {
    if (!preview) return
    const id = window.setInterval(() => setSimClock(Date.now()), 2000)
    return () => window.clearInterval(id)
  }, [preview])
  const simulated = preview ? simulateCrew(crew, simClock) : null
  const simKey = simulated ? simulated.map((a) => `${a.id}:${a.status}`).join('|') : ''
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const previewRoster = useMemo(() => simulated ?? [], [simKey])
  const roster = preview ? previewRoster : teamRoster
  const agents = useMemo(() => roster.filter((a) => a.enabled !== false), [roster])
  const selectAgent = useDeckStore((s) => s.selectAgent)
  const selectedAgentId = useDeckStore((s) => s.selectedAgentId)
  const assignments = useMemo(() => assignOfficeDestinations(agents), [agents])

  const runners = useRef<Map<string, Runner>>(new Map())
  const [now, setNow] = useState(() => performance.now())
  const [hovered, setHovered] = useState<string | null>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)

  // sync roster → runners (place on first sight, walk on change)
  useEffect(() => {
    const map = runners.current
    const seen = new Set<string>()
    let overflow = 0
    let receptionTaken = false
    const firstSync = map.size === 0
    for (const agent of agents) {
      const a = assignmentForAgent(assignments, agent.id)
      if (a?.destinationType === 'hidden') continue
      let useKey = a && !a.overflow ? a.waypointId : undefined
      // a single reception seat: extra offline agents wait in the lobby
      if (useKey === 'reception.spawn') {
        if (receptionTaken) useKey = undefined
        receptionTaken = true
      }
      const target = targetFor(agent, useKey, useKey ? 0 : overflow++)
      seen.add(agent.id)
      const existing = map.get(agent.id)
      if (!existing) {
        const startAtSeat = firstSync
        const pos = startAtSeat ? { x: target.x, y: target.y } : { ...officeMap.spawn }
        map.set(agent.id, {
          agent,
          pos,
          path: startAtSeat ? [] : findPath(officeMap, pos, target),
          target,
          facing: startAtSeat ? target.face : 'up',
          moving: !startAtSeat,
          look: lookFor(agent),
        })
        continue
      }
      existing.agent = agent
      if (existing.target.key !== target.key) {
        existing.target = target
        existing.path = findPath(officeMap, existing.pos, target)
        existing.moving = true
      }
    }
    for (const id of [...map.keys()]) if (!seen.has(id)) map.delete(id)
  }, [agents, assignments])

  // movement loop
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const tick = (t: number) => {
      const dt = Math.min((t - last) / 1000, 0.05)
      last = t
      for (const r of runners.current.values()) {
        if (!r.moving) continue
        let budget = WALK_SPEED * dt
        while (budget > 0 && r.path.length) {
          const wp = r.path[0]
          const dx = wp.x - r.pos.x
          const dy = wp.y - r.pos.y
          const dist = Math.hypot(dx, dy)
          if (dist <= budget) {
            r.pos = { x: wp.x, y: wp.y }
            r.path.shift()
            budget -= dist
          } else {
            r.facing = facingToward(dx, dy, r.facing)
            r.pos = { x: r.pos.x + (dx / dist) * budget, y: r.pos.y + (dy / dist) * budget }
            budget = 0
          }
        }
        if (!r.path.length) {
          r.moving = false
          r.facing = r.target.face
        }
      }
      setNow(t)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  useLayoutEffect(() => {
    const el = viewport.current
    if (!el) return
    const update = () => setScale(crispScale(el.clientWidth))
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    window.addEventListener('resize', update)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [])

  const propEls = useMemo(
    () =>
      officeMap.props.map((p, i) => (
        <div
          key={i}
          className="pxo-prop"
          style={{ left: p.x, top: p.y, width: p.w, height: p.h, zIndex: p.z, backgroundPosition: `-${p.sx}px -${p.sy}px` }}
        />
      )),
    [],
  )
  const list = [...runners.current.values()]
  const counts = {
    working: agents.filter((a) => a.status === 'working').length,
    meeting: agents.filter((a) => a.status === 'reviewing').length,
    verifying: agents.filter((a) => a.status === 'verifying').length,
    idle: agents.filter((a) => a.status === 'idle' || a.status === 'waiting').length,
    blocked: agents.filter((a) => a.status === 'blocked').length,
  }
  const focusId = hovered ?? selectedAgentId
  const focus = focusId ? runners.current.get(focusId) : undefined

  return (
    <div className="pxo-scene">
      <header className="pxo-toolbar">
        <div>
          <span className="pxo-kicker">{preview ? 'PREVIEW · 기본 직원' : 'LIVE OFFICE'}</span>
          <h1>AI 팀 오피스</h1>
        </div>
        <ul className="pxo-stats" aria-label="상태 요약">
          {preview ? (
            <li className="pxo-cta">
              <button type="button" onClick={openWizard}>새 프로젝트로 내 팀 꾸리기</button>
            </li>
          ) : null}
          <li><b>{agents.length}</b>명 출근</li>
          <li className="is-working"><i />작업 {counts.working}</li>
          <li className="is-meeting"><i />회의 {counts.meeting}</li>
          <li className="is-verify"><i />검증 {counts.verifying}</li>
          <li className="is-idle"><i />대기 {counts.idle}</li>
          {counts.blocked ? <li className="is-blocked"><i />막힘 {counts.blocked}</li> : null}
        </ul>
      </header>

      <div className="pxo-viewport" ref={viewport}>
        <div className="pxo-frame" style={{ width: MAP_W * scale, height: MAP_H * scale }}>
          <div className="pxo-map" style={{ width: MAP_W, height: MAP_H, transform: `scale(${scale})` }}>
            <img className="pxo-bg" src={`${BASE}/office-bg.png`} alt="" draggable={false} />
            {propEls}
            {list.map((r) => {
              const { row, col } = animationFor(r, now)
              const bp = `-${col * FW}px -${row * FH}px`
              const bubble = bubbleFor(r, now)
              const bubbleIdx = bubble ? bubbleManifest.names.indexOf(bubble) : -1
              const sitting = !r.moving && r.target.pose === 'sit'
              const left = Math.round(r.pos.x - FW / 2)
              const top = Math.round(r.pos.y - FH)
              return (
                <button
                  key={r.agent.id}
                  type="button"
                  className={`pxo-char${focusId === r.agent.id ? ' is-focus' : ''}`}
                  style={{ left, top, zIndex: Math.round(r.pos.y) + 1 }}
                  aria-label={`${r.agent.name} · ${STATUS_KO[r.agent.status]}`}
                  onClick={() => (preview ? undefined : selectAgent(r.agent.id))}
                  onMouseEnter={() => setHovered(r.agent.id)}
                  onMouseLeave={() => setHovered((h) => (h === r.agent.id ? null : h))}
                >
                  {!sitting ? <span className="pxo-shadow" /> : null}
                  <span className="pxo-layer" style={{ backgroundImage: `url(${r.look.skin})`, backgroundPosition: bp }} />
                  <span className="pxo-layer" style={{ backgroundImage: `url(${r.look.outfit})`, backgroundPosition: bp }} />
                  <span className="pxo-layer" style={{ backgroundImage: `url(${r.look.hair})`, backgroundPosition: bp }} />
                  {r.look.acc ? <span className="pxo-layer" style={{ backgroundImage: `url(${r.look.acc})`, backgroundPosition: bp }} /> : null}
                  {bubbleIdx >= 0 ? (
                    <span className="pxo-bubble" style={{ backgroundPosition: `-${bubbleIdx * bubbleManifest.size}px 0` }} />
                  ) : null}
                </button>
              )
            })}
          </div>
          <div className="pxo-overlay">
            {officeMap.labels.map((l) => (
              <span key={l.id} className={`pxo-label room-${l.id}`} style={{ left: l.x * scale, top: l.y * scale }}>
                {l.text}
              </span>
            ))}
            {focus ? (
              <span
                className="pxo-nametag"
                style={{ left: focus.pos.x * scale, top: (focus.pos.y - FH - 3) * scale }}
              >
                <b>{focus.agent.name}</b>
                <em>{focus.agent.currentTaskLabel || focus.agent.speech || STATUS_KO[focus.agent.status]}</em>
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <footer className="pxo-footer">
        <span>대기 → 휴게실·가든</span>
        <span>작업 → 부서 자리</span>
        <span>리뷰 → 회의실</span>
        <span>검증 → 테스트룸</span>
        <span>오프라인 → 리셉션</span>
      </footer>
    </div>
  )
}
