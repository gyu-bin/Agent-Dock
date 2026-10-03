import { access, constants, realpath, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { settingsRepository } from '../persistence/settingsRepository.js'

export interface AgentSource {
  type: 'filesystem'
  directory: string
  available: boolean
  configuredBy: 'runtime' | 'settings' | 'environment' | 'default'
  failureCode?: string
}

/** Agency Markdown sources only supply division metadata; they are not Codex personas. */
export async function resolveAgentSource(runtimeDirectory?: string): Promise<AgentSource> {
  const settingsDirectory = runtimeDirectory?.trim()
    ? undefined
    : (await settingsRepository.load()).agents.codexAgentsDir?.trim()
  const envDirectory = process.env.AGENT_DECK_AGENTS_DIR?.trim()
  const configuredBy = runtimeDirectory?.trim() ? 'runtime'
    : settingsDirectory ? 'settings' : envDirectory ? 'environment' : 'default'
  const raw = runtimeDirectory?.trim() || settingsDirectory || envDirectory || path.join(os.homedir(), '.codex', 'agents')
  const expanded = raw === '~' ? os.homedir()
    : raw.startsWith('~/') ? path.join(os.homedir(), raw.slice(2)) : raw
  // Relative custom paths have a stable home anchor, independent of server cwd.
  let directory = path.resolve(os.homedir(), expanded)
  try {
    directory = await realpath(directory)
    if (!(await stat(directory)).isDirectory()) throw Object.assign(new Error('Not a directory'), { code: 'ENOTDIR' })
    await access(directory, constants.R_OK)
    return { type: 'filesystem', directory, available: true, configuredBy }
  } catch (error) {
    const failureCode = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'UNKNOWN'
    return { type: 'filesystem', directory, available: false, configuredBy, failureCode }
  }
}
