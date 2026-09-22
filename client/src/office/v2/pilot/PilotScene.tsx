import { useEffect, useRef, useState } from 'react'
import characterManifest from '../../../../public/assets/office-v2/characters/developer/manifest.json'
import furnitureManifest from '../../../../public/assets/office-v2/manifests/office-v2-furniture.json'

type Animation = keyof typeof characterManifest.animations
type Point = { x: number; y: number }
type Phase = 'to-desk' | 'work' | 'to-sofa' | 'idle'

const furniture = Object.fromEntries(furnitureManifest.assets.map((asset) => [asset.id, asset]))
const points = {
  lounge: { x: 212, y: 358 },
  deskApproach: { x: 475, y: 375 },
  desk: { x: 475, y: 287 },
  sofaApproach: { x: 282, y: 385 },
  sofa: { x: 250, y: 354 },
} satisfies Record<string, Point>

const speed = 115

function clipForVector(dx: number, dy: number): Animation {
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? 'walk-left' : 'walk-right'
  return dy < 0 ? 'walk-up' : 'walk-down'
}

function Furniture({ id, x, y }: { id: string; x: number; y: number }) {
  const asset = furniture[id]
  if (!asset || asset.status !== 'ready') return null
  return (
    <img
      className="pilot-furniture"
      src={`/assets/office-v2/${asset.src}`}
      alt=""
      style={{
        left: x,
        top: y,
        width: asset.logicalWidth,
        height: asset.logicalHeight,
        zIndex: Math.round(y),
      }}
    />
  )
}

function Developer({ position, animation }: { position: Point; animation: Animation }) {
  const [frame, setFrame] = useState(0)
  const clip = characterManifest.animations[animation]
  const rects = clip.rects

  useEffect(() => {
    setFrame(0)
    if (!rects.length) return
    const timer = window.setInterval(() => setFrame((current) => (current + 1) % rects.length), 1000 / clip.fps)
    return () => window.clearInterval(timer)
  }, [animation, clip.fps, rects])

  if (characterManifest.status !== 'ready' || !rects.length) return null
  const rect = rects[frame % rects.length]
  const scale = 0.75
  return (
    <div
      className="pilot-character"
      data-animation={animation}
      data-frame={frame}
      style={{
        left: position.x,
        top: position.y,
        width: characterManifest.frameWidth * scale,
        height: characterManifest.frameHeight * scale,
        zIndex: Math.round(position.y),
      }}
    >
      <div
        className="pilot-atlas"
        style={{
          width: characterManifest.frameWidth * scale,
          height: characterManifest.frameHeight * scale,
          backgroundImage: 'url(/assets/office-v2/characters/developer/atlas.png)',
          backgroundSize: `${characterManifest.columns * characterManifest.frameWidth * scale}px ${Object.keys(characterManifest.animations).length * characterManifest.frameHeight * scale}px`,
          backgroundPosition: `${-rect.x * scale}px ${-rect.y * scale}px`,
        }}
      />
    </div>
  )
}

export function PilotScene() {
  const [position, setPosition] = useState<Point>(points.lounge)
  const [animation, setAnimation] = useState<Animation>('idle')
  const [phase, setPhase] = useState<Phase>('to-desk')
  const motion = useRef({ position: { ...points.lounge }, phase: 'to-desk' as Phase, targetIndex: 0, holdUntil: 0 })

  useEffect(() => {
    let frameId = 0
    let prior = 0
    const routes: Record<'to-desk' | 'to-sofa', Point[]> = {
      'to-desk': [points.deskApproach, points.desk],
      'to-sofa': [points.deskApproach, points.sofaApproach, points.sofa],
    }
    function tick(now: number) {
      const dt = prior ? Math.min((now - prior) / 1000, 0.05) : 0
      prior = now
      const state = motion.current
      if (state.phase === 'work' || state.phase === 'idle') {
        if (now >= state.holdUntil) {
          state.phase = state.phase === 'work' ? 'to-sofa' : 'to-desk'
          state.targetIndex = 0
          setPhase(state.phase)
        }
      } else {
        const route = routes[state.phase]
        const target = route[state.targetIndex]
        const dx = target.x - state.position.x
        const dy = target.y - state.position.y
        const distance = Math.hypot(dx, dy)
        if (distance <= speed * dt || distance < 1) {
          state.position = { ...target }
          state.targetIndex += 1
          if (state.targetIndex >= route.length) {
            state.phase = state.phase === 'to-desk' ? 'work' : 'idle'
            state.holdUntil = now + (state.phase === 'work' ? 3000 : 2500)
            setPhase(state.phase)
            setAnimation(state.phase === 'work' ? 'work' : 'sit')
          }
        } else {
          state.position = {
            x: state.position.x + (dx / distance) * speed * dt,
            y: state.position.y + (dy / distance) * speed * dt,
          }
          setAnimation(clipForVector(dx, dy))
        }
        setPosition(state.position)
      }
      frameId = requestAnimationFrame(tick)
    }
    frameId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frameId)
  }, [])

  return (
    <main className="pilot-page">
      <header className="pilot-header">
        <div>
          <p>OFFICE V2 / PRODUCTION PILOT</p>
          <h1>Developer movement test</h1>
        </div>
        <div className="pilot-status">{phase} · {animation}</div>
      </header>
      <div className="pilot-viewport">
        <div className="pilot-room" aria-label="Office V2 pilot room">
          <div className="pilot-wall" />
          <div className="pilot-rug" />
          <Furniture id="desk" x={475} y={273} />
          <Furniture id="chair" x={475} y={317} />
          <Furniture id="plant-small" x={625} y={245} />
          <Furniture id="sofa" x={250} y={355} />
          <Developer position={position} animation={animation} />
        </div>
      </div>
      <p className="pilot-caption">Lounge → walk → desk → work → stand → walk → sofa → idle</p>
    </main>
  )
}
