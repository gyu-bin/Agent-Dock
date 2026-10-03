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
import { pickExchange } from './idleChatter'
import { advanceWalk, canWander, nextWanderRoute, wanderPause, wanderPoints, type Facing } from './pixelMovement'
import { pickDefaultCrew, simulateCrew } from './defaultCrew'
import './PixelOfficeScene.css'

const BASE = '/assets/pixel-office'
const MAP_W = officeMap.width
const MAP_H = officeMap.height
const FW = charManifest.frameWidth
const FH = charManifest.frameHeight
const WALK_SPEED = 54 // map px per second

type Waypoint = { x: number; y: number; pose: 'sit' | 'stand'; face: Facing }
type Target = Waypoint & { key: string }

const WAYPOINTS = officeMap.waypoints as unknown as Record<string, Waypoint>
const ANIMS = charManifest.animations as unknown as Record<string, { row: number; frames: number }>
const ACCESSORIES = charManifest.accessories as unknown as Record<string, string>
const WANDER_POINTS = wanderPoints(officeMap)

interface Runner {
  agent: Agent
  pos: Pt
  path: Pt[]
  target: Target
  homeTarget: Target
  wanderTrip: number
  nextWanderAt: number
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

/** Integer device-pixel scaling keeps every art pixel the same size. */
type ViewMode = 'fill' | 'fit'
const VIEW_KEY = 'agent-deck-office-view'

/**
 * fill = cover the pane (pan to see the rest), fit = whole office visible.
 * When it costs little (≤12% size change) the scale is snapped so one art pixel
 * is a whole number of device pixels and every dot renders at the same size.
 * Fill rounds up (still covers), fit rounds down (still fits).
 */
function viewScale(mode: ViewMode, width: number, height: number): number {
  if (!width || !height) return 1
  const dpr = Math.max(1, Math.round(window.devicePixelRatio || 1))
  const raw = mode === 'fill' ? Math.max(width / MAP_W, height / MAP_H) : Math.min(width / MAP_W, height / MAP_H)
  const snapped = (mode === 'fill' ? Math.ceil(raw * dpr) : Math.floor(raw * dpr)) / dpr
  // On low-DPR screens a whole-pixel step can be big (2.4 → 3); keep size over crispness then.
  const chosen = snapped > 0 && Math.abs(snapped - raw) / raw <= 0.12 ? snapped : Math.floor(raw * 100) / 100
  return Math.max(0.5, Math.min(6, chosen))
}

function clampOffset(o: Pt, scale: number, w: number, h: number): Pt {
  const fw = MAP_W * scale
  const fh = MAP_H * scale
  return {
    x: fw <= w ? (w - fw) / 2 : Math.min(0, Math.max(w - fw, o.x)),
    y: fh <= h ? (h - fh) / 2 : Math.min(0, Math.max(h - fh, o.y)),
  }
}

/** Align to the device pixel grid so the snapped scale stays crisp after panning. */
function snapPx(v: number): number {
  const dpr = Math.max(1, Math.round(window.devicePixelRatio || 1))
  return Math.round(v * dpr) / dpr
}

function readViewMode(): ViewMode {
  try {
    return localStorage.getItem(VIEW_KEY) === 'fit' ? 'fit' : 'fill'
  } catch {
    return 'fill'
  }
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

const ROLE_KO: Record<string, string> = {
  pm: 'PM · 기획', developer: '개발자', 'game-developer': '게임 개발자', designer: '디자이너',
  researcher: '리서처', marketer: '마케터', qa: 'QA · 테스트', reviewer: '리뷰어',
}

function AgentCard({
  runner,
  preview,
  onClose,
  onOpenTask,
}: {
  runner: Runner
  preview: boolean
  onClose: () => void
  onOpenTask: (taskId: string) => void
}) {
  const a = runner.agent
  const role = ROLE_KO[resolveOfficeV2VisualRole(a)] ?? a.division
  const busy = a.status === 'working' || a.status === 'reviewing' || a.status === 'verifying' || a.status === 'blocked'
  let doing: string
  if (preview) doing = '실제로 맡은 작업은 없어요. 지금 보이는 움직임은 미리보기 연출이에요.'
  else if (a.currentTaskLabel) doing = a.currentTaskLabel
  else if (busy) doing = '작업 단계 정보를 아직 받지 못했어요.'
  else doing = '맡은 작업 없이 대기 중이에요.'
  return (
    <aside className="pxo-card" aria-label={`${a.name} 정보`} onPointerDown={(e) => e.stopPropagation()}>
      <header>
        <div>
          <b>{a.name}</b>
          <span>{role}</span>
        </div>
        <button type="button" className="pxo-card-close" onClick={onClose} aria-label="닫기">×</button>
      </header>
      <dl>
        <dt>상태</dt>
        <dd><i className={`pxo-dot is-${a.status}`} />{STATUS_KO[a.status]}{preview ? ' (미리보기)' : ''}</dd>
        <dt>하는 일</dt>
        <dd>{doing}</dd>
        {a.speech && !preview ? (<><dt>메모</dt><dd>{a.speech}</dd></>) : null}
        {a.description ? (<><dt>전문 분야</dt><dd className="pxo-desc">{a.description}</dd></>) : null}
      </dl>
      {!preview && a.currentTaskId ? (
        <button type="button" className="pxo-card-cta" onClick={() => onOpenTask(a.currentTaskId!)}>작업 상세 보기</button>
      ) : null}
      {preview ? <p className="pxo-card-note">오른쪽 채팅에 일을 시키면 이 직원들로 기본 작업공간이 만들어지고 실제로 일하기 시작해요.</p> : null}
    </aside>
  )
}

/** Text bubble: something the agent said in the last few seconds (handoff, kickoff, idle chat). */
function talkFor(
  id: string,
  runtime: Record<string, { speech?: string; speechAt?: number }>,
  chatter: Record<string, { text: string; at: number }>,
  nowMs: number,
): string | null {
  const wall = Date.now()
  void nowMs
  const r = runtime[id]
  if (r?.speech && r.speechAt && wall - r.speechAt < 6000) return r.speech
  const c = chatter[id]
  if (c && wall - c.at < 5000) return c.text
  return null
}

const STATUS_KO: Record<Agent['status'], string> = {
  idle: '대기', waiting: '대기', working: '작업 중', reviewing: '리뷰 중',
  verifying: '검증 중', blocked: '막힘', offline: '오프라인',
}

export function PixelOfficeScene({ preview = false }: { preview?: boolean }) {
  const teamRoster = useDeckStore(useShallow((s) => selectTeamAgents(s).slice(0, 30)))
  const runtime = useDeckStore((s) => s.agentRuntime)
  const recentTaskTitle = useDeckStore((s) => s.tasks.filter((t) => t.status === 'completed').sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))[0]?.title)
  const chatterRef = useRef<Record<string, { text: string; at: number }>>({})
  const chatter = chatterRef.current
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
  const selectTask = useDeckStore((s) => s.selectTask)
  const setNav = useDeckStore((s) => s.setNav)
  const [pinned, setPinned] = useState<string | null>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPinned(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const assignments = useMemo(() => assignOfficeDestinations(agents, { offlineMode: 'hidden' }), [agents])

  const runners = useRef<Map<string, Runner>>(new Map())
  // Idle chatter: every ~9s two resting staff standing close together exchange a short line.
  useEffect(() => {
    let seed = 0
    const timers: number[] = []
    const id = window.setInterval(() => {
      const resting = [...runners.current.values()].filter((r) => !r.moving && canWander(r.agent))
      const wall = Date.now()
      const busy = (r: Runner) => (chatterRef.current[r.agent.id]?.at ?? 0) > wall - 8000
      for (const a of resting) {
        if (busy(a)) continue
        const b = resting.find((o) => o !== a && !busy(o) && Math.hypot(o.pos.x - a.pos.x, o.pos.y - a.pos.y) < 96)
        if (!b) continue
        const [first, reply] = pickExchange(seed++ * 7 + a.agent.id.length, recentTaskTitle)
        chatterRef.current[a.agent.id] = { text: first, at: wall }
        // Stay put for the exchange instead of walking off mid-sentence.
        const hold = performance.now() + 6000
        a.nextWanderAt = Math.max(a.nextWanderAt, hold)
        b.nextWanderAt = Math.max(b.nextWanderAt, hold)
        timers.push(window.setTimeout(() => { chatterRef.current[b.agent.id] = { text: reply, at: Date.now() } }, 2400))
        break
      }
    }, 9000)
    return () => { window.clearInterval(id); timers.forEach((t) => window.clearTimeout(t)) }
  }, [recentTaskTitle])
  const [now, setNow] = useState(() => performance.now())
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReducedMotion(preference.matches)
    preference.addEventListener('change', update)
    return () => preference.removeEventListener('change', update)
  }, [])
  const [hovered, setHovered] = useState<string | null>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  const [mode, setMode] = useState<ViewMode>(readViewMode)
  const scale = viewScale(mode, box.w, box.h)
  // pan offset in screen px; null = not yet centred for this scale
  const [pan, setPan] = useState<Pt | null>(null)
  const drag = useRef<{ x: number; y: number; ox: number; oy: number; moved: boolean } | null>(null)
  const justDragged = useRef(false)
  const offset = clampOffset(pan ?? { x: box.w / 2 - (MAP_W / 2) * scale, y: box.h / 2 - (MAP_H / 2) * scale }, scale, box.w, box.h)
  const changeMode = (next: ViewMode) => {
    setMode(next)
    setPan(null)
    try {
      localStorage.setItem(VIEW_KEY, next)
    } catch {
      /* per-viewer convenience only */
    }
  }

  // sync roster → runners (place on first sight, walk on change)
  useEffect(() => {
    const map = runners.current
    const seen = new Set<string>()
    let overflow = 0
    const firstSync = map.size === 0
    for (const agent of agents) {
      const a = assignmentForAgent(assignments, agent.id)
      if (a?.destinationType === 'hidden') continue
      const useKey = a && !a.overflow ? a.waypointId : undefined
      const target = targetFor(agent, useKey, useKey ? 0 : overflow++)
      seen.add(agent.id)
      const existing = map.get(agent.id)
      if (!existing) {
        const startAtSeat = firstSync || reducedMotion
        const pos = startAtSeat ? { x: target.x, y: target.y } : { ...officeMap.spawn }
        const look = lookFor(agent)
        const path = startAtSeat ? [] : findPath(officeMap, pos, target)
        map.set(agent.id, {
          agent,
          pos,
          path,
          target,
          homeTarget: target,
          wanderTrip: 0,
          nextWanderAt: performance.now() + wanderPause(look.seed, 0),
          facing: startAtSeat ? target.face : 'up',
          moving: path.length > 0,
          look,
        })
        continue
      }
      existing.agent = agent
      // Roster updates must not restart a leisure walk. A real task takes priority.
      if (existing.homeTarget.key !== target.key || (!canWander(agent) && existing.target.key.startsWith('wander.')) || reducedMotion) {
        existing.homeTarget = target
        existing.target = target
        existing.path = reducedMotion ? [] : findPath(officeMap, existing.pos, target)
        existing.moving = existing.path.length > 0
        existing.nextWanderAt = performance.now() + wanderPause(existing.look.seed, existing.wanderTrip)
        if (reducedMotion) {
          existing.pos = { x: target.x, y: target.y }
          existing.facing = target.face
        }
      }
    }
    for (const id of [...map.keys()]) if (!seen.has(id)) map.delete(id)
  }, [agents, assignments, reducedMotion])

  // movement loop
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const tick = (t: number) => {
      const dt = Math.min((t - last) / 1000, 0.05)
      last = t
      for (const r of runners.current.values()) {
        if (!reducedMotion && !r.moving && canWander(r.agent) && t >= r.nextWanderAt) {
          const route = nextWanderRoute(officeMap, WANDER_POINTS, r.pos, r.look.seed, r.wanderTrip++)
          if (route) {
            r.target = { ...route.target, pose: 'stand', face: 'down', key: `wander.${r.wanderTrip}` }
            r.path = route.path
            r.moving = true
          } else r.nextWanderAt = t + wanderPause(r.look.seed, r.wanderTrip)
        }
        if (!r.moving) continue
        if (advanceWalk(r, dt, WALK_SPEED)) {
          r.moving = false
          r.facing = r.target.face
          r.nextWanderAt = t + wanderPause(r.look.seed, r.wanderTrip)
        }
      }
      setNow(t)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [reducedMotion])

  useLayoutEffect(() => {
    const el = viewport.current
    if (!el) return
    const update = () => setBox({ w: el.clientWidth, h: el.clientHeight })
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
  const focusId = hovered ?? pinned ?? selectedAgentId
  const focus = focusId ? runners.current.get(focusId) : undefined
  const card = pinned ? runners.current.get(pinned) : undefined

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
          <li className="pxo-view" role="group" aria-label="보기 방식">
            <button type="button" aria-pressed={mode === 'fill'} onClick={() => changeMode('fill')}>꽉 채우기</button>
            <button type="button" aria-pressed={mode === 'fit'} onClick={() => changeMode('fit')}>전체 보기</button>
          </li>
          <li><b>{agents.length}</b>명 출근</li>
          <li className="is-working"><i />작업 {counts.working}</li>
          <li className="is-meeting"><i />회의 {counts.meeting}</li>
          <li className="is-verify"><i />검증 {counts.verifying}</li>
          <li className="is-idle"><i />대기 {counts.idle}</li>
          {counts.blocked ? <li className="is-blocked"><i />막힘 {counts.blocked}</li> : null}
        </ul>
      </header>

      <div
        className={`pxo-viewport is-${mode}`}
        ref={viewport}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y, moved: false }
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (!d) return
          const dx = e.clientX - d.x
          const dy = e.clientY - d.y
          if (!d.moved && Math.hypot(dx, dy) < 4) return
          if (!d.moved) {
            d.moved = true
            e.currentTarget.setPointerCapture(e.pointerId)
          }
          setPan({ x: d.ox + dx, y: d.oy + dy })
        }}
        onPointerUp={(e) => {
          if (drag.current?.moved) {
            e.currentTarget.releasePointerCapture(e.pointerId)
            justDragged.current = true
            window.setTimeout(() => (justDragged.current = false), 0)
          }
          drag.current = null
        }}
        onClickCapture={(e) => {
          // a drag that just ended should not click the character underneath
          if (justDragged.current) e.stopPropagation()
        }}
        onWheel={(e) => {
          if (mode !== 'fill') return
          setPan({ x: offset.x - e.deltaX, y: offset.y - e.deltaY })
        }}
      >
        <div className="pxo-frame" style={{ width: MAP_W * scale, height: MAP_H * scale, transform: `translate(${snapPx(offset.x)}px, ${snapPx(offset.y)}px)` }}>
          <div className="pxo-map" style={{ width: MAP_W, height: MAP_H, transform: `scale(${scale})` }}>
            <img className="pxo-bg" src={`${BASE}/office-bg.png`} alt="" draggable={false} />
            {propEls}
            {list.map((r) => {
              const { row, col } = animationFor(r, now)
              const bp = `-${col * FW}px -${row * FH}px`
              const bubble = talkFor(r.agent.id, runtime, chatter, now) ? null : bubbleFor(r, now)
              const bubbleIdx = bubble ? bubbleManifest.names.indexOf(bubble) : -1
              const sitting = !r.moving && r.target.pose === 'sit'
              const left = Math.round(r.pos.x - FW / 2)
              const top = Math.round(r.pos.y - FH)
              return (
                <button
                  key={r.agent.id}
                  type="button"
                  className={`pxo-char${focusId === r.agent.id ? ' is-focus' : ''}`}
                  style={{ left, top, width: FW, height: FH, zIndex: Math.round(r.pos.y) + 1 }}
                  aria-label={`${r.agent.name} · ${STATUS_KO[r.agent.status]}`}
                  onClick={() => {
                    setPinned((p) => (p === r.agent.id ? null : r.agent.id))
                    if (!preview) selectAgent(r.agent.id)
                  }}
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
              <span key={l.id} className={`pxo-label room-${l.id}`} style={{ left: l.x * scale, top: l.y * scale, fontSize: Math.round(Math.min(15, Math.max(11, 8 * scale))) }}>
                {l.text}
              </span>
            ))}
            {list.map((r) => {
              const line = talkFor(r.agent.id, runtime, chatter, now)
              if (!line || focus?.agent.id === r.agent.id) return null
              return (
                <span key={`say-${r.agent.id}`} className="pxo-say" style={{ left: r.pos.x * scale, top: (r.pos.y - FH - 2) * scale }}>
                  <span>{line}</span>
                </span>
              )
            })}
            {focus ? (
              <span
                className="pxo-nametag"
                style={{ left: focus.pos.x * scale, top: (focus.pos.y - FH - 3) * scale }}
              >
                <b>{focus.agent.name}</b>
                <em>{preview ? `${STATUS_KO[focus.agent.status]} · 미리보기` : focus.agent.currentTaskLabel || focus.agent.speech || STATUS_KO[focus.agent.status]}</em>
              </span>
            ) : null}
          </div>
        </div>
        {card ? (
          <AgentCard
            runner={card}
            preview={preview}
            onClose={() => setPinned(null)}
            onOpenTask={(taskId) => {
              selectTask(taskId)
              setNav('tasks')
            }}
          />
        ) : null}
      </div>

      <footer className="pxo-footer">
        {preview ? (
          <span className="pxo-hint">지금 움직임은 미리보기예요. 오른쪽 채팅에 일을 시키면 이 직원들이 실제로 일을 시작해요.</span>
        ) : (
          <>
            <span>직원을 클릭하면 하는 일을 볼 수 있어요</span>
            <span>일이 없으면 휴게실·가든 산책</span>
            <span>작업 → 부서 자리</span>
            <span>리뷰 → 회의실</span>
            <span>검증 → 테스트룸</span>
          </>
        )}
      </footer>
    </div>
  )
}
