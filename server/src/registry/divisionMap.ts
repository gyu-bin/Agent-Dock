import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import type { DivisionId } from '../types.js'
import fallbackMap from './agencyDivisionMap.json' with { type: 'json' }

const AGENT_DIRS = [
  'academic',
  'design',
  'engineering',
  'finance',
  'game-development',
  'gis',
  'healthcare',
  'marketing',
  'paid-media',
  'product',
  'project-management',
  'research',
  'sales',
  'security',
  'spatial-computing',
  'specialized',
  'support',
  'testing',
] as const

export type DivisionMapSource = 'agency-agents' | 'committed-json'

export interface DivisionMapResult {
  slugToDivision: Record<string, DivisionId>
  source: DivisionMapSource
  agencyDir?: string
  agentCount: number
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function parseName(frontmatter: string): string | null {
  const m = frontmatter.match(/^name:\s*(.+)$/m)
  if (!m) return null
  return m[1].trim().replace(/^["']|["']$/g, '')
}

async function walkMd(dir: string): Promise<string[]> {
  const out: string[] = []
  const entries = await readdir(dir, { withFileTypes: true })
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      out.push(...(await walkMd(full)))
    } else if (e.isFile() && e.name.endsWith('.md')) {
      out.push(full)
    }
  }
  return out
}

function defaultAgencyDir(): string {
  return (
    process.env.AGENT_DECK_AGENCY_DIR ??
    path.join(os.homedir(), 'Desktop', 'Coding', 'agency-agents')
  )
}

/**
 * Build slug → division from agency-agents directory layout.
 * Does not modify agency-agents. Falls back to committed JSON snapshot.
 */
export async function loadDivisionMap(
  agencyDir = defaultAgencyDir(),
): Promise<DivisionMapResult> {
  try {
    await stat(agencyDir)
    const slugToDivision: Record<string, DivisionId> = {}

    for (const div of AGENT_DIRS) {
      const divPath = path.join(agencyDir, div)
      try {
        await stat(divPath)
      } catch {
        continue
      }
      const files = await walkMd(divPath)
      for (const file of files) {
        const text = await readFile(file, 'utf8')
        if (!text.startsWith('---')) continue
        const end = text.indexOf('\n---', 3)
        if (end < 0) continue
        const name = parseName(text.slice(3, end))
        if (!name) continue
        slugToDivision[slugify(name)] = div
      }
    }

    const agentCount = Object.keys(slugToDivision).length
    if (agentCount === 0) {
      throw new Error(`No agents found under ${agencyDir}`)
    }

    return {
      slugToDivision,
      source: 'agency-agents',
      agencyDir,
      agentCount,
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    console.warn(
      `[agent-deck] agency-agents scan failed (${reason}); using committed division map`,
    )
    const slugToDivision = fallbackMap.slugToDivision as Record<string, DivisionId>
    return {
      slugToDivision,
      source: 'committed-json',
      agentCount: Object.keys(slugToDivision).length,
    }
  }
}

export function resolveDivision(
  agentId: string,
  map: Record<string, DivisionId>,
): DivisionId {
  const key = agentId.toLowerCase().replace(/_/g, '-')
  return map[key] ?? 'specialized'
}

/** Path helper for tests / scripts */
export function sharedMapPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url))
  return path.resolve(here, './agencyDivisionMap.json')
}
