import { readdir, readFile } from 'node:fs/promises'
import TOML from '@iarna/toml'

async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const result = []
  for (const entry of entries) {
    const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory)
    if (entry.isDirectory()) result.push(...await collect(url))
    else result.push(url)
  }
  return result
}
const clientFiles = await collect(new URL('../client/dist/', import.meta.url))
const clientText = (await Promise.all(clientFiles.filter((url) => /\.(js|json|html|map)$/.test(url.pathname)).map((url) => readFile(url, 'utf8')))).join('\n')
const agentDirectory = new URL('../server/assets/agents/', import.meta.url)
const files = (await readdir(agentDirectory)).filter((name) => name.endsWith('.toml'))
for (const filename of files) {
  const parsed = TOML.parse(await readFile(new URL(filename, agentDirectory), 'utf8'))
  const instruction = parsed.developer_instructions.trim()
  const sample = instruction.slice(0, Math.min(220, instruction.length))
  if (clientText.includes(sample) || clientText.includes(JSON.stringify(sample).slice(1, -1))) throw new Error(`Server instruction leaked in client: ${filename}`)
}
if (clientFiles.some((url) => url.pathname.endsWith('.toml'))) throw new Error('Client bundle contains TOML instructions')
console.log(`Client isolation PASS: ${files.length} persona samples absent, no TOMLs in ${clientFiles.length} built files`)
