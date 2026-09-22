import type { VercelRequest, VercelResponse } from '@vercel/node'
import { app, ensureReady } from '../server/src/index.js'

export const config = {
  maxDuration: 60,
}

let boot: Promise<void> | null = null

/**
 * Catch-all serverless entry so Vite static + Express /api share one Vercel project.
 * Same-origin: leave VITE_API_URL unset.
 */
export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (!boot) boot = ensureReady()
  await boot
  app(req as never, res as never)
}
