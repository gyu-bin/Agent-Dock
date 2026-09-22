#!/usr/bin/env node
/**
 * Regenerates agencyDivisionMap.json from the agency-agents repo.
 * Source of truth: top-level division directories + frontmatter `name:` → slug.
 *
 * Usage:
 *   node scripts/generate-division-map.mjs
 *   AGENT_DECK_AGENCY_DIR=/path/to/agency-agents node scripts/generate-division-map.mjs
 */
import { readdir, readFile, writeFile, stat, mkdir } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

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
]

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const OUTS = [
  path.join(ROOT, 'shared', 'agencyDivisionMap.json'),
  path.join(ROOT, 'server', 'src', 'registry', 'agencyDivisionMap.json'),
  path.join(ROOT, 'client', 'src', 'data', 'agencyDivisionMap.json'),
]

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function parseName(frontmatter) {
  const m = frontmatter.match(/^name:\s*(.+)$/m)
  if (!m) return null
  return m[1].trim().replace(/^["']|["']$/g, '')
}

async function walkMd(dir) {
  const out = []
  const entries = await readdir(dir, { withFileTypes: true })
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...(await walkMd(full)))
    else if (e.isFile() && e.name.endsWith('.md')) out.push(full)
  }
  return out
}

async function main() {
  const agencyDir =
    process.env.AGENT_DECK_AGENCY_DIR ??
    path.join(os.homedir(), 'Desktop', 'Coding', 'agency-agents')

  await stat(agencyDir)

  const slugToDivision = {}
  for (const div of AGENT_DIRS) {
    const divPath = path.join(agencyDir, div)
    try {
      await stat(divPath)
    } catch {
      continue
    }
    for (const file of await walkMd(divPath)) {
      const text = await readFile(file, 'utf8')
      if (!text.startsWith('---')) continue
      const end = text.indexOf('\n---', 3)
      if (end < 0) continue
      const name = parseName(text.slice(3, end))
      if (!name) continue
      slugToDivision[slugify(name)] = div
    }
  }

  const payload = {
    _comment:
      'Generated from agency-agents directory structure. Regenerate via scripts/generate-division-map.mjs',
    _source: agencyDir,
    _generatedAt: new Date().toISOString(),
    agentCount: Object.keys(slugToDivision).length,
    slugToDivision: Object.fromEntries(
      Object.entries(slugToDivision).sort(([a], [b]) => a.localeCompare(b)),
    ),
  }

  const json = `${JSON.stringify(payload, null, 2)}\n`
  for (const out of OUTS) {
    await mkdir(path.dirname(out), { recursive: true })
    await writeFile(out, json)
    console.log(`[generate-division-map] wrote ${out}`)
  }
  console.log(`[generate-division-map] agents: ${payload.agentCount}`)
  console.log(
    `[generate-division-map] trend-researcher → ${slugToDivision['trend-researcher']}`,
  )
}

main().catch((err) => {
  console.error('[generate-division-map] failed:', err.message)
  process.exit(1)
})
