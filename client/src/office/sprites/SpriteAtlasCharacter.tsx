import { useEffect, useState } from 'react'
import { assetUrl } from '../assets/assetResolver'
import type { SpriteManifest, SpriteStateId } from './types'
import styles from './SpriteAtlasCharacter.module.css'

interface Props {
  manifest: SpriteManifest
  /** Directory under /assets containing atlas + manifest */
  bundleDir: string
  state: SpriteStateId
  displayWidth?: number
  displayHeight?: number
}

/**
 * Manifest-driven atlas player — samples frame_layout rectangles; never hardcodes cells.
 */
export function SpriteAtlasCharacter({
  manifest,
  bundleDir,
  state,
  displayWidth = 52,
  displayHeight = 52,
}: Props) {
  const [frame, setFrame] = useState(0)
  const row = manifest.animation.rows[state]
  const rects = manifest.frame_layout.rows[state]
  const atlasFile =
    manifest.sprite_sheet_alpha ?? manifest.game_input ?? 'sprite-sheet-alpha.png'
  const atlasSrc = assetUrl(`${bundleDir.replace(/\/$/, '')}/${atlasFile}`)

  useEffect(() => {
    setFrame(0)
  }, [state])

  useEffect(() => {
    if (!row || !rects?.length) return
    const durations = row.durations_ms?.length
      ? row.durations_ms
      : Array.from({ length: rects.length }, () => 1000 / Math.max(1, row.fps))
    let cancelled = false
    let idx = 0
    let timer: number | undefined

    const tick = () => {
      if (cancelled) return
      const wait = durations[idx % durations.length] ?? 125
      timer = window.setTimeout(() => {
        idx = (idx + 1) % rects.length
        if (!row.loop && idx === 0) {
          setFrame(rects.length - 1)
          return
        }
        setFrame(idx)
        tick()
      }, wait)
    }
    tick()
    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
    }
  }, [row, rects])

  if (!row || !rects?.length) {
    return <div className={styles.missing} aria-hidden />
  }

  const rect = rects[Math.min(frame, rects.length - 1)]
  const scaleX = displayWidth / rect.w
  const scaleY = displayHeight / rect.h

  return (
    <div
      className={styles.wrap}
      style={{ width: displayWidth, height: displayHeight }}
      data-sprite-state={state}
      data-sprite-frame={frame}
      aria-hidden
    >
      <div
        className={styles.atlas}
        style={{
          width: manifest.frame_layout.sheetWidth * scaleX,
          height: manifest.frame_layout.sheetHeight * scaleY,
          backgroundImage: `url(${atlasSrc})`,
          backgroundSize: `${manifest.frame_layout.sheetWidth * scaleX}px ${manifest.frame_layout.sheetHeight * scaleY}px`,
          transform: `translate(${-rect.x * scaleX}px, ${-rect.y * scaleY}px)`,
        }}
      />
    </div>
  )
}
