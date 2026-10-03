import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'

export interface AgentBundleManifest {
  version: string
  agents: { id: string; filename: string; sha256: string; version: string }[]
}

export async function readBundleManifest(directory: string): Promise<AgentBundleManifest> {
  const parsed = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8')) as AgentBundleManifest
  if (parsed.version !== '1' || !Array.isArray(parsed.agents) || !parsed.agents.length) throw new Error('Invalid agent bundle manifest')
  const ids = new Set<string>()
  for (const item of parsed.agents) {
    if (!/^[a-zA-Z0-9_-]+$/.test(item.id) || item.filename !== `${item.id}.toml` || !/^[a-f0-9]{64}$/.test(item.sha256) || item.version !== '1' || ids.has(item.id)) {
      throw new Error('Invalid agent bundle entry')
    }
    ids.add(item.id)
  }
  return parsed
}

export async function verifyBundledInstruction(directory: string, id: string, raw: string): Promise<void> {
  const manifest = await readBundleManifest(directory)
  const entry = manifest.agents.find((item) => item.id === id)
  if (!entry || createHash('sha256').update(raw).digest('hex') !== entry.sha256) throw new Error('Agent bundle integrity mismatch')
}
