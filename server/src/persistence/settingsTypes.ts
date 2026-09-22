/**
 * Phase S1 — Provider & System Settings (no secrets in stored payload).
 */

export type ModelProfileId = 'FAST' | 'STANDARD' | 'REASONING'

export interface ModelProfile {
  id: ModelProfileId
  label: string
  description: string
  model: string
  roles: string[]
}

export type SearchProviderId =
  | 'openai-web-search'
  | 'steam'
  | 'duckduckgo'

export interface SearchProviderSetting {
  id: SearchProviderId
  label: string
  enabled: boolean
  /** Order: lower = earlier (primary first). */
  order: number
}

export type SearchFailPolicy = 'block-step' | 'allow-continue-without'

export interface SafetyPolicy {
  /** Required — always ON. Cannot be disabled via Settings API. */
  humanApproval: true
  /** Required — always ON. */
  verifyAfterCodeChange: true
  /** Optional toggle. */
  codeReview: boolean
  /** Optional toggle. */
  realityCheck: boolean
}

export interface RetryPolicy {
  openaiMaxRetries: number
  codexMaxRetries: number
  webSearchMaxRetries: number
  /**
   * IMPLEMENT mode must not auto-retry file-changing runs freely.
   * Only transient upstream retries (non-mutating wait) are allowed at most N.
   */
  implementAutoRetryRestricted: true
  implementNote: string
}

export interface BudgetDefaults {
  maxCost?: number
  maxTokens?: number
  warningThreshold: number
}

export interface DeckSettings {
  version: 1
  openai: {
    enabled: boolean
    /** Preferred model id (non-secret). Runtime still uses env until restart. */
    model: string
  }
  modelProfiles: Record<ModelProfileId, ModelProfile>
  codex: {
    enabled: boolean
    /** Optional override path structure (persisted preference). */
    binaryPath?: string
  }
  webSearch: {
    providers: SearchProviderSetting[]
    failPolicy: SearchFailPolicy
  }
  agents: {
    codexAgentsDir?: string
    agencySourceDir?: string
  }
  project: {
    requireProjectPath: boolean
    sandboxNote: string
  }
  safety: SafetyPolicy
  retry: RetryPolicy
  budget: BudgetDefaults
  updatedAt: string
}

export interface SettingsRepository {
  load(): Promise<DeckSettings>
  save(settings: DeckSettings): Promise<void>
}

export type StatusLevel = 'ok' | 'warn' | 'off'

export interface SystemStatusItem {
  id: string
  label: string
  level: StatusLevel
  value: string
}

export interface DiagnosticCheck {
  id: string
  label: string
  ok: boolean
  detail: string
}

export interface SettingsBoard {
  settings: DeckSettings
  status: SystemStatusItem[]
  runtime: {
    openai: {
      configured: boolean
      enabled: boolean
      model: string | null
      label: string
      apiKeyConfigured: boolean
    }
    codex: {
      available: boolean
      enabled: boolean
      binary: string | null
      label: string
      version?: string
      authMode: 'local-login' | 'api-key' | 'unknown'
      apiKeyConfigured: boolean
      sandboxPolicy: string
    }
    webSearch: {
      configured: boolean
      primaryLabel: string
      fallbackLabels: string[]
      failPolicy: SearchFailPolicy
    }
    agents: {
      total: number
      source: string
      codexAgentsDir: string | null
      agencySourceDir: string | null
      divisionMapped: number
      divisionTotal: number
    }
    persistence: {
      writable: boolean
      settingsPath: string
    }
  }
  diagnostics: DiagnosticCheck[]
  advanced?: {
    openaiEnvKeys: string[]
    codexEnvKeys: string[]
    note: string
  }
}

export const REQUIRED_SAFETY_KEYS = [
  'humanApproval',
  'verifyAfterCodeChange',
] as const

export function defaultSettings(): DeckSettings {
  const now = new Date().toISOString()
  return {
    version: 1,
    openai: {
      enabled: true,
      model: 'gpt-4o-mini',
    },
    modelProfiles: {
      FAST: {
        id: 'FAST',
        label: 'FAST',
        description: 'Router · Classification · 간단 요약',
        model: 'gpt-4o-mini',
        roles: ['router', 'classification', 'summary'],
      },
      STANDARD: {
        id: 'STANDARD',
        label: 'STANDARD',
        description: '일반 Agent · Research · Product · Marketing',
        model: 'gpt-4o-mini',
        roles: ['agent', 'research', 'product', 'marketing'],
      },
      REASONING: {
        id: 'REASONING',
        label: 'REASONING',
        description:
          'Orchestrator · Game Designer · Reality Checker · 중요 Planning',
        model: 'gpt-4o',
        roles: [
          'orchestrator',
          'game-designer',
          'reality-checker',
          'planning',
        ],
      },
    },
    codex: {
      enabled: true,
    },
    webSearch: {
      providers: [
        {
          id: 'openai-web-search',
          label: 'OpenAI Web Search',
          enabled: true,
          order: 0,
        },
        { id: 'steam', label: 'Steam', enabled: true, order: 1 },
        {
          id: 'duckduckgo',
          label: 'DuckDuckGo',
          enabled: true,
          order: 2,
        },
      ],
      failPolicy: 'block-step',
    },
    agents: {},
    project: {
      requireProjectPath: true,
      sandboxNote:
        'Codex는 프로젝트 경로 안에서만 동작합니다. 전체 파일시스템 접근은 허용되지 않습니다.',
    },
    safety: {
      humanApproval: true,
      verifyAfterCodeChange: true,
      codeReview: true,
      realityCheck: true,
    },
    retry: {
      openaiMaxRetries: 2,
      codexMaxRetries: 2,
      webSearchMaxRetries: 1,
      implementAutoRetryRestricted: true,
      implementNote:
        'IMPLEMENT(파일 변경)은 위험하므로 자동 재시도가 제한됩니다. 일시적 업스트림 오류에만 짧은 재시도를 허용합니다.',
    },
    budget: {
      warningThreshold: 0.8,
    },
    updatedAt: now,
  }
}
