import { mkdir, readFile, writeFile, rename, access, constants } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  defaultSettings,
  type DeckSettings,
  type ModelProfileId,
  type SettingsRepository,
} from './settingsTypes.js'
import { atomicWriteJson } from './atomicWrite.js'

function defaultFile(): string {
  const here = path.dirname(fileURLToPath(import.meta.url))
  return (
    process.env.AGENT_DECK_SETTINGS_FILE ??
    path.resolve(here, '../../data/settings.json')
  )
}

function migrate(raw: unknown): DeckSettings {
  const base = defaultSettings()
  if (!raw || typeof raw !== 'object') return base
  const obj = raw as Record<string, unknown>
  const openai = (obj.openai ?? {}) as Record<string, unknown>
  const codex = (obj.codex ?? {}) as Record<string, unknown>
  const webSearch = (obj.webSearch ?? {}) as Record<string, unknown>
  const agents = (obj.agents ?? {}) as Record<string, unknown>
  const project = (obj.project ?? {}) as Record<string, unknown>
  const safety = (obj.safety ?? {}) as Record<string, unknown>
  const retry = (obj.retry ?? {}) as Record<string, unknown>
  const budget = (obj.budget ?? {}) as Record<string, unknown>
  const profiles = (obj.modelProfiles ?? {}) as Record<
    string,
    Record<string, unknown>
  >

  const mergeProfile = (id: ModelProfileId) => {
    const src = profiles[id] ?? {}
    const def = base.modelProfiles[id]
    return {
      ...def,
      model: typeof src.model === 'string' && src.model.trim()
        ? String(src.model).trim()
        : def.model,
      roles: Array.isArray(src.roles)
        ? (src.roles as string[])
        : def.roles,
    }
  }

  return {
    version: 1,
    openai: {
      enabled: openai.enabled !== false,
      model:
        typeof openai.model === 'string' && openai.model.trim()
          ? String(openai.model).trim()
          : base.openai.model,
    },
    modelProfiles: {
      FAST: mergeProfile('FAST'),
      STANDARD: mergeProfile('STANDARD'),
      REASONING: mergeProfile('REASONING'),
    },
    codex: {
      enabled: codex.enabled !== false,
      binaryPath:
        typeof codex.binaryPath === 'string' && codex.binaryPath.trim()
          ? String(codex.binaryPath).trim()
          : undefined,
    },
    webSearch: {
      providers: Array.isArray(webSearch.providers)
        ? (webSearch.providers as DeckSettings['webSearch']['providers'])
        : base.webSearch.providers,
      failPolicy:
        webSearch.failPolicy === 'allow-continue-without'
          ? 'allow-continue-without'
          : 'block-step',
    },
    agents: {
      codexAgentsDir:
        typeof agents.codexAgentsDir === 'string'
          ? agents.codexAgentsDir
          : undefined,
      agencySourceDir:
        typeof agents.agencySourceDir === 'string'
          ? agents.agencySourceDir
          : undefined,
    },
    project: {
      requireProjectPath: project.requireProjectPath !== false,
      sandboxNote:
        typeof project.sandboxNote === 'string'
          ? project.sandboxNote
          : base.project.sandboxNote,
    },
    safety: {
      humanApproval: true,
      verifyAfterCodeChange: true,
      codeReview: safety.codeReview !== false,
      realityCheck: safety.realityCheck !== false,
    },
    retry: {
      ...base.retry,
      openaiMaxRetries:
        typeof retry.openaiMaxRetries === 'number'
          ? retry.openaiMaxRetries
          : base.retry.openaiMaxRetries,
      codexMaxRetries:
        typeof retry.codexMaxRetries === 'number'
          ? retry.codexMaxRetries
          : base.retry.codexMaxRetries,
      webSearchMaxRetries:
        typeof retry.webSearchMaxRetries === 'number'
          ? retry.webSearchMaxRetries
          : base.retry.webSearchMaxRetries,
      implementAutoRetryRestricted: true,
    },
    budget: {
      maxCost:
        typeof budget.maxCost === 'number' ? budget.maxCost : undefined,
      maxTokens:
        typeof budget.maxTokens === 'number' ? budget.maxTokens : undefined,
      warningThreshold:
        typeof budget.warningThreshold === 'number'
          ? budget.warningThreshold
          : base.budget.warningThreshold,
    },
    updatedAt:
      typeof obj.updatedAt === 'string' ? obj.updatedAt : base.updatedAt,
  }
}

/**
 * JSON settings store (secrets never written here).
 * Swap later for SQLite by implementing SettingsRepository.
 */
export class JsonSettingsRepository implements SettingsRepository {
  private chain: Promise<void> = Promise.resolve()

  constructor(private readonly file = defaultFile()) {}

  path(): string {
    return this.file
  }

  async load(): Promise<DeckSettings> {
    try {
      const raw = await readFile(this.file, 'utf8')
      return migrate(JSON.parse(raw))
    } catch (err) {
      const code =
        err && typeof err === 'object' && 'code' in err
          ? (err as { code?: string }).code
          : ''
      if (code === 'ENOENT') return defaultSettings()
      throw err
    }
  }

  async save(settings: DeckSettings): Promise<void> {
    this.chain = this.chain.then(async () => {
      await mkdir(path.dirname(this.file), { recursive: true })
      const payload: DeckSettings = {
        ...settings,
        version: 1,
        safety: {
          ...settings.safety,
          humanApproval: true,
          verifyAfterCodeChange: true,
        },
        retry: {
          ...settings.retry,
          implementAutoRetryRestricted: true,
        },
        updatedAt: new Date().toISOString(),
      }
      // Never persist secrets
      const payloadClean = payload
      const json = JSON.stringify(payloadClean, null, 2)
      if (/sk-[a-zA-Z0-9]{10,}|api[_-]?key["'\s:=]/i.test(json)) {
        throw Object.assign(
          new Error('Refusing to persist settings that look like secrets'),
          { status: 400 },
        )
      }
      await atomicWriteJson(this.file, payloadClean)
    })
    await this.chain
  }

  async isWritable(): Promise<boolean> {
    try {
      await mkdir(path.dirname(this.file), { recursive: true })
      const probe = `${this.file}.probe`
      await writeFile(probe, 'ok', 'utf8')
      await rename(probe, probe) // no-op ensure
      const { unlink } = await import('node:fs/promises')
      await unlink(probe).catch(() => undefined)
      await access(path.dirname(this.file), constants.W_OK)
      return true
    } catch {
      return false
    }
  }
}

export const settingsRepository = new JsonSettingsRepository()
