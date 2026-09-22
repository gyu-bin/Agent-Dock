import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import type { CodexProviderState } from './types.js'

const execFileAsync = promisify(execFile)

async function isExecutable(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.X_OK)
    return true
  } catch {
    try {
      await access(filePath, constants.F_OK)
      return true
    } catch {
      return false
    }
  }
}

async function which(cmd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      process.platform === 'win32' ? 'where' : 'which',
      [cmd],
      { timeout: 5000 },
    )
    const first = stdout.split(/\r?\n/).map((s) => s.trim()).find(Boolean)
    return first || null
  } catch {
    return null
  }
}

/**
 * Resolve Codex CLI binary. Does not auto-install.
 * Order: CODEX_BIN → PATH `codex` → common npx package path hint (not executed).
 */
export async function resolveCodexBinary(): Promise<{
  binary: string | null
  error?: string
}> {
  const fromEnv = process.env.CODEX_BIN?.trim()
  if (fromEnv) {
    if (await isExecutable(fromEnv)) return { binary: path.resolve(fromEnv) }
    return {
      binary: null,
      error: `CODEX_BIN set but not executable: ${fromEnv}`,
    }
  }

  const fromPath = await which('codex')
  if (fromPath) return { binary: fromPath }

  return {
    binary: null,
    error:
      'Codex CLI not found. Install `@openai/codex` or set CODEX_BIN to the binary path.',
  }
}

export async function getCodexProviderState(): Promise<CodexProviderState> {
  const { binary, error } = await resolveCodexBinary()
  if (!binary) {
    return {
      available: false,
      binary: null,
      label: 'Codex · Unavailable',
      error,
    }
  }

  let version: string | undefined
  try {
    const { stdout } = await execFileAsync(binary, ['--version'], {
      timeout: 8000,
    })
    version = stdout.trim().split(/\r?\n/)[0]?.slice(0, 80)
  } catch {
    // still available if binary exists
  }

  return {
    available: true,
    binary,
    label: version ? `Codex · ${version}` : 'Codex · Available',
    version,
  }
}
