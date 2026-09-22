import { useEffect, useRef, useState } from 'react'
import type { Agent } from '../domain/types'
import type { AgentVisualState } from './visual/agentVisual'
import { animationToSpriteAnim } from './visual/agentVisual'
import {
  assetUrl,
  characterSpritePath,
  hasProductionPng,
} from './assets/assetResolver'
import { CHAR_DISPLAY_PX } from './assets/scale'
import { SpeechBubble } from './SpeechBubble'
import { StatusIndicator } from './StatusIndicator'
import { PixelCharacter } from './PixelCharacter'
import { SpriteAtlasCharacter } from './sprites/SpriteAtlasCharacter'
import { useSpriteManifest } from './sprites/useSpriteManifest'
import { roleSpriteBundle } from './sprites/roleSprites'
import {
  facingFromDelta,
  resolveSpriteState,
  type SpriteFacing,
} from './sprites/types'
import { displayAgentName } from '../i18n'
import styles from './AgentCharacter.module.css'

interface Props {
  agent: Agent
  visual: AgentVisualState
  onSelect: (id: string) => void
}

const MOVE_MS = 900

/**
 * Character renderer.
 * Role atlas (sprite-gen) when registered → else static PNG → else SVG chibi.
 */
export function AgentCharacter({ agent, visual, onSelect }: Props) {
  const [pos, setPos] = useState({ x: visual.x, y: visual.y })
  const [hovered, setHovered] = useState(false)
  const [moving, setMoving] = useState(false)
  const [facing, setFacing] = useState<SpriteFacing>('down')
  const prevPos = useRef(pos)

  const roleBundle = roleSpriteBundle(visual.visualRole)
  const { manifest: roleManifest } = useSpriteManifest(
    roleBundle ? roleBundle.manifestPath : null,
  )
  const useAtlas = Boolean(roleBundle && roleManifest)

  const spriteRel = characterSpritePath(
    visual.visualRole,
    animationToSpriteAnim(visual.animation),
  )
  const useStaticPng = !useAtlas && hasProductionPng(spriteRel)
  const label = displayAgentName(agent.id, agent.name)
  const roleLabel = visual.visualRole === 'generic' ? '' : visual.visualRole

  // Labels: hover/click only (or blocked). Working uses activity chip, not always-on name.
  const showHoverLabel = hovered
  const showBlocked = agent.status === 'blocked'
  const showWorkingChip = agent.status === 'working' && !moving

  useEffect(() => {
    const dest = visual.destination ?? { x: visual.x, y: visual.y }
    const dx = dest.x - prevPos.current.x
    const dy = dest.y - prevPos.current.y
    const dist = Math.hypot(dx, dy)
    if (dist > 0.4) {
      setFacing(facingFromDelta(dx, dy))
      setMoving(true)
      const t = window.setTimeout(() => setMoving(false), MOVE_MS)
      const id = requestAnimationFrame(() => {
        setPos(dest)
        prevPos.current = dest
      })
      return () => {
        window.clearTimeout(t)
        cancelAnimationFrame(id)
      }
    }
    const id = requestAnimationFrame(() => {
      setPos(dest)
      prevPos.current = dest
      setMoving(false)
    })
    return () => cancelAnimationFrame(id)
  }, [visual.destination, visual.x, visual.y])

  const atlasState = resolveSpriteState(
    visual.animation,
    facing,
    moving || visual.animation === 'walk',
  )

  return (
    <button
      type="button"
      className={styles.character}
      data-agent-char
      data-anim={moving ? 'walk' : visual.animation}
      data-status={agent.status}
      data-role-atlas={useAtlas || undefined}
      data-sprite-state={useAtlas ? atlasState : undefined}
      style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
      onClick={() => onSelect(agent.id)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      title={`${label} — ${agent.status}`}
      aria-label={`${label}, ${agent.status}`}
    >
      {visual.showSpeech && visual.speech ? (
        <SpeechBubble text={visual.speech} />
      ) : agent.status === 'waiting' ? (
        <SpeechBubble text="…" tiny />
      ) : null}

      {useAtlas && roleBundle && roleManifest ? (
        <SpriteAtlasCharacter
          manifest={roleManifest}
          bundleDir={roleBundle.bundleDir}
          state={atlasState}
          displayWidth={CHAR_DISPLAY_PX}
          displayHeight={CHAR_DISPLAY_PX}
        />
      ) : useStaticPng ? (
        <img
          className={styles.sprite}
          src={assetUrl(spriteRel)}
          alt=""
          width={46}
          height={58}
          draggable={false}
        />
      ) : (
        <PixelCharacter
          role={visual.visualRole}
          animation={moving ? 'walk' : visual.animation}
          seed={agent.id}
        />
      )}

      {showWorkingChip ? (
        <span className={styles.activity} aria-hidden>
          ●
        </span>
      ) : null}
      {showBlocked ? (
        <span className={styles.status}>
          <StatusIndicator status={agent.status} />
        </span>
      ) : null}
      {showHoverLabel ? (
        <span className={styles.name}>
          {shortName(label)}
          {roleLabel ? ` · ${roleLabel}` : ''}
        </span>
      ) : null}
    </button>
  )
}

function shortName(name: string) {
  const parts = name.split(/\s+/)
  if (parts.length >= 2 && parts[0].length <= 10) return parts[0]
  return name.length > 12 ? `${name.slice(0, 11)}…` : name
}
