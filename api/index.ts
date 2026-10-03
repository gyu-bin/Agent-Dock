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
 * Single serverless entry for every /api/* route (Vite static + Express share one project).
 * vercel.json rewrites `/api/(.*)` → `/api?__vpath=$1`; the original path is restored
 * here before Express routes it. (A `[...path].ts` catch-all only served one-segment
 * paths on Vercel, so /api/a/b returned 404.)
 * Same-origin: leave VITE_API_URL unset.
 */
export function restoreApiPath(rawUrl: string | undefined): string {
  const url = new URL(rawUrl ?? '/api', 'http://local')
  const vpath = url.searchParams.get('__vpath')
  if (vpath === null) return url.pathname + url.search
  url.searchParams.delete('__vpath')
  const qs = url.searchParams.toString()
  return `/api/${vpath.replace(/^\/+/, '')}${qs ? `?${qs}` : ''}`
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  req.url = restoreApiPath(req.url)
  const { app } = await loadServer()
  app(req, res)
}
