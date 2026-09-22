import os from 'node:os'
import path from 'node:path'
import { access, constants } from 'node:fs/promises'
import type { AiProvider } from '../providers/aiProvider.js'
import { getCodexProviderState } from '../codex/codexProvider.js'
import { loadAgentRegistry } from '../registry/loadAgents.js'
import { loadDivisionMap } from '../registry/divisionMap.js'
import type { JsonSettingsRepository } from './settingsRepository.js'
import type {
  DeckSettings,
  DiagnosticCheck,
  ModelProfileId,
  SearchFailPolicy,
  SearchProviderId,
  SearchProviderSetting,
  SettingsBoard,
  SystemStatusItem,
} from './settingsTypes.js'
import { defaultSettings } from './settingsTypes.js'

export interface SettingsPatch {
  openai?: { enabled?: boolean; model?: string }
  modelProfiles?: Partial<
    Record<ModelProfileId, { model?: string; roles?: string[] }>
  >
  codex?: { enabled?: boolean; binaryPath?: string | null }
  webSearch?: {
    providers?: Array<{
      id: SearchProviderId
      enabled?: boolean
      order?: number
    }>
    failPolicy?: SearchFailPolicy
  }
  agents?: {
    codexAgentsDir?: string | null
    agencySourceDir?: string | null
  }
  project?: { requireProjectPath?: boolean }
  safety?: {
    humanApproval?: boolean
    verifyAfterCodeChange?: boolean
    codeReview?: boolean
    realityCheck?: boolean
  }
  retry?: {
    openaiMaxRetries?: number
    codexMaxRetries?: number
    webSearchMaxRetries?: number
  }
  budget?: {
    maxCost?: number | null
    maxTokens?: number | null
    warningThreshold?: number
  }
}

function envConfigured(name: string): boolean {
  return Boolean(process.env[name]?.trim())
}

function defaultCodexAgentsDir(settings: DeckSettings): string {
  return (
    settings.agents.codexAgentsDir?.trim() ||
    process.env.AGENT_DECK_AGENTS_DIR?.trim() ||
    path.join(os.homedir(), '.codex', 'agents')
  )
}

function defaultAgencyDir(settings: DeckSettings): string {
  return (
    settings.agents.agencySourceDir?.trim() ||
    process.env.AGENT_DECK_AGENCY_DIR?.trim() ||
    path.join(os.homedir(), 'Desktop', 'Coding', 'agency-agents')
  )
}

/**
 * Apply patch with Safety locks: required policies cannot be turned off.
 */
export function applySettingsPatch(
  current: DeckSettings,
  patch: SettingsPatch,
): { settings: DeckSettings; rejectedSafety: string[] } {
  const rejectedSafety: string[] = []
  const next: DeckSettings = structuredClone(current)

  if (patch.openai) {
    if (typeof patch.openai.enabled === 'boolean')
      next.openai.enabled = patch.openai.enabled
    if (typeof patch.openai.model === 'string' && patch.openai.model.trim())
      next.openai.model = patch.openai.model.trim()
  }

  if (patch.modelProfiles) {
    for (const id of ['FAST', 'STANDARD', 'REASONING'] as ModelProfileId[]) {
      const p = patch.modelProfiles[id]
      if (!p) continue
      if (typeof p.model === 'string' && p.model.trim())
        next.modelProfiles[id].model = p.model.trim()
      if (Array.isArray(p.roles)) next.modelProfiles[id].roles = p.roles
    }
  }

  if (patch.codex) {
    if (typeof patch.codex.enabled === 'boolean')
      next.codex.enabled = patch.codex.enabled
    if (patch.codex.binaryPath === null) delete next.codex.binaryPath
    else if (
      typeof patch.codex.binaryPath === 'string' &&
      patch.codex.binaryPath.trim()
    ) {
      next.codex.binaryPath = patch.codex.binaryPath.trim()
    }
  }

  if (patch.webSearch) {
    if (patch.webSearch.failPolicy)
      next.webSearch.failPolicy = patch.webSearch.failPolicy
    if (Array.isArray(patch.webSearch.providers)) {
      const map = new Map(
        next.webSearch.providers.map((p) => [p.id, { ...p }]),
      )
      for (const p of patch.webSearch.providers) {
        const cur = map.get(p.id)
        if (!cur) continue
        if (typeof p.enabled === 'boolean') cur.enabled = p.enabled
        if (typeof p.order === 'number') cur.order = p.order
        map.set(p.id, cur)
      }
      next.webSearch.providers = [...map.values()].sort(
        (a, b) => a.order - b.order,
      )
    }
  }

  if (patch.agents) {
    if (patch.agents.codexAgentsDir === null)
      delete next.agents.codexAgentsDir
    else if (typeof patch.agents.codexAgentsDir === 'string')
      next.agents.codexAgentsDir = patch.agents.codexAgentsDir
    if (patch.agents.agencySourceDir === null)
      delete next.agents.agencySourceDir
    else if (typeof patch.agents.agencySourceDir === 'string')
      next.agents.agencySourceDir = patch.agents.agencySourceDir
  }

  if (patch.project) {
    if (typeof patch.project.requireProjectPath === 'boolean')
      next.project.requireProjectPath = patch.project.requireProjectPath
  }

  if (patch.safety) {
    if (patch.safety.humanApproval === false)
      rejectedSafety.push('humanApproval')
    if (patch.safety.verifyAfterCodeChange === false)
      rejectedSafety.push('verifyAfterCodeChange')
    // Always force required ON
    next.safety.humanApproval = true
    next.safety.verifyAfterCodeChange = true
    if (typeof patch.safety.codeReview === 'boolean')
      next.safety.codeReview = patch.safety.codeReview
    if (typeof patch.safety.realityCheck === 'boolean')
      next.safety.realityCheck = patch.safety.realityCheck
  }

  if (patch.retry) {
    if (typeof patch.retry.openaiMaxRetries === 'number')
      next.retry.openaiMaxRetries = Math.max(0, patch.retry.openaiMaxRetries)
    if (typeof patch.retry.codexMaxRetries === 'number')
      next.retry.codexMaxRetries = Math.max(0, patch.retry.codexMaxRetries)
    if (typeof patch.retry.webSearchMaxRetries === 'number')
      next.retry.webSearchMaxRetries = Math.max(
        0,
        patch.retry.webSearchMaxRetries,
      )
    next.retry.implementAutoRetryRestricted = true
  }

  if (patch.budget) {
    if (patch.budget.maxCost === null) delete next.budget.maxCost
    else if (typeof patch.budget.maxCost === 'number')
      next.budget.maxCost = patch.budget.maxCost
    if (patch.budget.maxTokens === null) delete next.budget.maxTokens
    else if (typeof patch.budget.maxTokens === 'number')
      next.budget.maxTokens = patch.budget.maxTokens
    if (typeof patch.budget.warningThreshold === 'number')
      next.budget.warningThreshold = Math.min(
        1,
        Math.max(0, patch.budget.warningThreshold),
      )
  }

  next.updatedAt = new Date().toISOString()
  return { settings: next, rejectedSafety }
}

export class SettingsService {
  constructor(
    private readonly repo: JsonSettingsRepository,
    private readonly aiProvider: AiProvider,
    private readonly webSearch: {
      isAvailable: () => boolean
      id: string
      label: string
    },
  ) {}

  async get(): Promise<DeckSettings> {
    return this.repo.load()
  }

  async update(patch: SettingsPatch): Promise<{
    settings: DeckSettings
    rejectedSafety: string[]
  }> {
    const current = await this.repo.load()
    const { settings, rejectedSafety } = applySettingsPatch(current, patch)
    await this.repo.save(settings)
    return { settings, rejectedSafety }
  }

  async buildBoard(): Promise<SettingsBoard> {
    const settings = await this.repo.load()
    const openaiConfigured = this.aiProvider.isConfigured()
    const openaiState = this.aiProvider.getState()
    const codex = await getCodexProviderState()
    const agentsDir = defaultCodexAgentsDir(settings)
    const agencyDir = defaultAgencyDir(settings)
    const registry = await loadAgentRegistry(agentsDir)
    const division = await loadDivisionMap()
    const writable = await this.repo.isWritable()
    const openaiKey = envConfigured('OPENAI_API_KEY')
    const codexKey = envConfigured('CODEX_API_KEY')
    const searchConfigured = this.webSearch.isAvailable()

    const enabledProviders = [...settings.webSearch.providers]
      .filter((p) => p.enabled)
      .sort((a, b) => a.order - b.order)

    const status: SystemStatusItem[] = [
      {
        id: 'openai',
        label: 'OpenAI',
        level: openaiConfigured && settings.openai.enabled ? 'ok' : 'off',
        value: openaiConfigured ? '설정됨' : '미설정',
      },
      {
        id: 'codex',
        label: 'Codex',
        level: codex.available && settings.codex.enabled ? 'ok' : 'warn',
        value: codex.available ? '사용 가능' : '사용 불가',
      },
      {
        id: 'web-search',
        label: 'Web Search',
        level: searchConfigured ? 'ok' : 'warn',
        value: searchConfigured ? '설정됨' : '제한됨',
      },
      {
        id: 'agents',
        label: 'Agents',
        level: registry.total > 0 ? 'ok' : 'warn',
        value: String(registry.total),
      },
      {
        id: 'persistence',
        label: 'Storage',
        level: writable ? 'ok' : 'warn',
        value: writable ? '정상' : '쓰기 불가',
      },
    ]

    const diagnostics = await this.runDiagnostics({
      agentsDir,
      agencyDir,
      registryTotal: registry.total,
      divisionCount: division.agentCount,
      openaiConfigured,
      searchConfigured,
      codexAvailable: codex.available,
      writable,
    })

    return {
      settings,
      status,
      runtime: {
        openai: {
          configured: openaiConfigured,
          enabled: settings.openai.enabled,
          model: settings.openai.model || openaiState.model || null,
          label: openaiState.label,
          apiKeyConfigured: openaiKey,
        },
        codex: {
          available: codex.available,
          enabled: settings.codex.enabled,
          binary: settings.codex.binaryPath || codex.binary,
          label: codex.label,
          version: codex.version,
          authMode: codexKey ? 'api-key' : 'local-login',
          apiKeyConfigured: codexKey,
          sandboxPolicy: settings.project.sandboxNote,
        },
        webSearch: {
          configured: searchConfigured,
          primaryLabel: enabledProviders[0]?.label ?? this.webSearch.label,
          fallbackLabels: enabledProviders.slice(1).map((p) => p.label),
          failPolicy: settings.webSearch.failPolicy,
        },
        agents: {
          total: registry.total,
          source: registry.source,
          codexAgentsDir: agentsDir,
          agencySourceDir: agencyDir,
          divisionMapped: Math.min(registry.total, division.agentCount),
          divisionTotal: registry.total,
        },
        persistence: {
          writable,
          settingsPath: this.repo.path(),
        },
      },
      diagnostics,
      advanced: {
        openaiEnvKeys: [
          'OPENAI_API_KEY',
          'OPENAI_MODEL',
          'OPENAI_BASE_URL',
          'OPENAI_IMAGE_MODEL_FAST',
          'OPENAI_IMAGE_MODEL_QUALITY',
        ],
        codexEnvKeys: ['CODEX_BIN', 'CODEX_API_KEY', 'CODEX_TIMEOUT_MS'],
        note: '환경변수 이름은 Advanced에서만 표시합니다. 값은 절대 노출하지 않습니다. OPENAI_API_KEY와 CODEX_API_KEY는 서로 다른 키입니다.',
      },
    }
  }

  async runDiagnostics(input: {
    agentsDir: string
    agencyDir: string
    registryTotal: number
    divisionCount: number
    openaiConfigured: boolean
    searchConfigured: boolean
    codexAvailable: boolean
    writable: boolean
  }): Promise<DiagnosticCheck[]> {
    const dirOk = async (dir: string) => {
      try {
        await access(dir, constants.R_OK)
        return true
      } catch {
        return false
      }
    }
    const agentsOk = await dirOk(input.agentsDir)
    const agencyOk = await dirOk(input.agencyDir)

    return [
      {
        id: 'agent-registry',
        label: 'Agent Registry',
        ok: input.registryTotal > 0,
        detail: agentsOk
          ? `${input.registryTotal}개 로드`
          : `경로 확인 필요 (${input.agentsDir})`,
      },
      {
        id: 'agency-mapping',
        label: 'Agency mapping',
        ok: input.divisionCount > 0,
        detail: `${input.divisionCount}/${input.registryTotal || input.divisionCount}`,
      },
      {
        id: 'persistence',
        label: 'Persistence writable',
        ok: input.writable,
        detail: input.writable ? '설정 저장 가능' : '쓰기 불가',
      },
      {
        id: 'codex-cli',
        label: 'Codex CLI',
        ok: input.codexAvailable,
        detail: input.codexAvailable ? 'Available' : 'Unavailable',
      },
      {
        id: 'openai-configured',
        label: 'OpenAI configured',
        ok: input.openaiConfigured,
        detail: input.openaiConfigured ? 'Configured' : 'Not configured',
      },
      {
        id: 'search-configured',
        label: 'Search configured',
        ok: input.searchConfigured,
        detail: input.searchConfigured
          ? 'Configured (fallback 포함 가능)'
          : 'Not configured',
      },
      {
        id: 'agency-source',
        label: 'Agency source path',
        ok: agencyOk,
        detail: agencyOk ? input.agencyDir : `없음: ${input.agencyDir}`,
      },
    ]
  }

  /**
   * Connection test structure — S1 does not call external APIs.
   */
  connectionTestOpenAI(): {
    ran: false
    skipped: true
    reason: string
    configured: boolean
  } {
    return {
      ran: false,
      skipped: true,
      reason:
        '현재 단계에서는 실제 OpenAI 연결 테스트를 실행하지 않습니다. 설정 상태만 확인합니다.',
      configured: this.aiProvider.isConfigured(),
    }
  }
}

export function assertNoSecretsInPayload(payload: unknown): void {
  const text = JSON.stringify(payload)
  if (
    /sk-[a-zA-Z0-9_-]{20,}/.test(text) ||
    /"OPENAI_API_KEY"\s*:\s*"[^"]+"/i.test(text) ||
    /"CODEX_API_KEY"\s*:\s*"[^"]+"/i.test(text)
  ) {
    throw new Error('Secret leaked into settings response')
  }
}

export { defaultSettings }
export type { SearchProviderSetting }
