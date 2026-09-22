/**
 * Image model profiles — single place for model IDs.
 * Override via OPENAI_IMAGE_MODEL_FAST / OPENAI_IMAGE_MODEL_QUALITY.
 */

import type { ImageModelProfile } from './types.js'

export const DEFAULT_IMAGE_MODEL_FAST = 'gpt-image-2.5-flare'
export const DEFAULT_IMAGE_MODEL_QUALITY = 'gpt-image-2.5-sunburst'

export function getImageModelFast(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return env.OPENAI_IMAGE_MODEL_FAST?.trim() || DEFAULT_IMAGE_MODEL_FAST
}

export function getImageModelQuality(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return env.OPENAI_IMAGE_MODEL_QUALITY?.trim() || DEFAULT_IMAGE_MODEL_QUALITY
}

export function resolveImageModel(
  profile: ImageModelProfile = 'fast',
  env: NodeJS.ProcessEnv = process.env,
): string {
  return profile === 'quality'
    ? getImageModelQuality(env)
    : getImageModelFast(env)
}

/** Map creative brief aspect ratios to API-supported sizes. */
export function mapAspectRatioToSize(aspectRatio?: string): {
  size: string
  width: number
  height: number
} {
  const ar = (aspectRatio ?? '1:1').trim()
  if (ar === '16:9' || ar === '3:2') {
    return { size: '1536x1024', width: 1536, height: 1024 }
  }
  if (ar === '9:16' || ar === '2:3' || ar === '4:5') {
    return { size: '1024x1536', width: 1024, height: 1536 }
  }
  // 1:1 and unknown → square
  return { size: '1024x1024', width: 1024, height: 1024 }
}
