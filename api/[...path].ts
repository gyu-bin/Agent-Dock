import type { VercelRequest, VercelResponse } from '@vercel/node'

export const config = {
  maxDuration: 60,
}

type ServerMod = {
  app: (req: unknown, res: unknown) => void
  ensureReady: () => Promise<void>
}

let boot: Promise<ServerMod> | null = null

async function loadServer(): Promise<ServerMod> {
  if (!boot) {
    // Dynamic import: server package is ESM; Vercel api handlers compile as CJS.
    boot = import('../server/src/index.js') as Promise<ServerMod>
  }
  const mod = await boot
  await mod.ensureReady()
  return mod
}

/**
 * Catch-all serverless entry so Vite static + Express /api share one Vercel project.
 * Same-origin: leave VITE_API_URL unset.
 */
export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  const { app } = await loadServer()
  app(req, res)
}
