import { readdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import TOML from '@iarna/toml'

const directory = new URL('../server/assets/agents/', import.meta.url)
const files = (await readdir(directory)).filter((file) => file.endsWith('.toml')).sort()
const entries = []
for (const filename of files) {
  const id = filename.slice(0, -5)
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error(`Invalid agent ID: ${id}`)
  const raw = await readFile(new URL(filename, directory), 'utf8')
  let parsed
  try { parsed = TOML.parse(raw) } catch { throw new Error(`Invalid TOML: ${id}`) }
  if (typeof parsed.developer_instructions !== 'string' || !parsed.developer_instructions.trim()) throw new Error(`Missing instructions: ${id}`)
  entries.push({ id, filename, sha256: createHash('sha256').update(raw).digest('hex'), version: '1' })
}
const required = ['agents-orchestrator', 'research-synthesist', 'backend-architect', 'frontend-developer', 'ui-designer', 'code-reviewer', 'reality-checker', 'rapid-prototyper']
for (const id of required) if (!entries.some((entry) => entry.id === id)) throw new Error(`Missing core agent: ${id}`)
const expected = { version: '1', agents: entries }
const manifestUrl = new URL('manifest.json', directory)
if (process.argv.includes('--generate')) await writeFile(manifestUrl, `${JSON.stringify(expected, null, 2)}\n`)
const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'))
if (JSON.stringify(manifest) !== JSON.stringify(expected)) throw new Error('Agent manifest/hash mismatch; regenerate intentionally after reviewed asset changes')
console.log(`Agent bundle PASS: ${entries.length} TOMLs, manifest IDs/hashes/instructions/core agents verified (${fileURLToPath(directory)})`)
