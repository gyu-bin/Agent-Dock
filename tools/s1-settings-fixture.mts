/**
 * Phase S1 — Settings Control Center fixture tests (no live provider calls).
 *
 *   AGENT_DECK_SETTINGS_FILE=.tmp/s1-settings.json node --import tsx tools/s1-settings-fixture.mts
 */
import { mkdir, rm, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { JsonSettingsRepository } from '../server/src/persistence/settingsRepository.ts'
import {
  SettingsService,
  applySettingsPatch,
  assertNoSecretsInPayload,
} from '../server/src/persistence/settingsService.ts'
import type { AiProvider } from '../server/src/providers/aiProvider.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIR = path.join(ROOT, '.tmp', `s1-settings-${Date.now().toString(36)}`)
const FILE = path.join(DIR, 'settings.json')

type Result = { name: string; ok: boolean; detail?: string }
const results: Result[] = []

function record(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

function mockAi(configured: boolean): AiProvider {
  return {
    getState: () => ({
      mode: configured ? 'openai' : 'not-configured',
      label: configured ? 'OpenAI · Configured' : 'OpenAI · Not configured',
      configured,
      providerName: 'openai',
      model: configured ? 'gpt-4o-mini' : undefined,
    }),
    isConfigured: () => configured,
    chat: async () => {
      throw new Error('no live calls')
    },
  }
}

const mockSearch = {
  id: 'fixture-search',
  label: 'Fixture Search',
  isAvailable: () => true,
}

async function main() {
  await mkdir(DIR, { recursive: true })

  // TEST A — OpenAI configured / unconfigured
  {
    const repo = new JsonSettingsRepository(FILE)
    const svcOn = new SettingsService(repo, mockAi(true), mockSearch)
    const boardOn = await svcOn.buildBoard()
    const svcOff = new SettingsService(repo, mockAi(false), {
      ...mockSearch,
      isAvailable: () => false,
    })
    const boardOff = await svcOff.buildBoard()
    record(
      'TEST A openai configured/unconfigured',
      boardOn.runtime.openai.configured === true &&
        boardOff.runtime.openai.configured === false &&
        boardOn.status.find((s) => s.id === 'openai')?.value === '설정됨' &&
        boardOff.status.find((s) => s.id === 'openai')?.value === '미설정',
      `on=${boardOn.runtime.openai.configured} off=${boardOff.runtime.openai.configured}`,
    )
  }

  // TEST B — Codex available/unavailable (from real resolve; accept either but structure present)
  {
    const repo = new JsonSettingsRepository(FILE)
    const svc = new SettingsService(repo, mockAi(false), mockSearch)
    const board = await svc.buildBoard()
    record(
      'TEST B codex status shape',
      typeof board.runtime.codex.available === 'boolean' &&
        (board.runtime.codex.authMode === 'api-key' ||
          board.runtime.codex.authMode === 'local-login') &&
        typeof board.runtime.codex.sandboxPolicy === 'string',
      `available=${board.runtime.codex.available} auth=${board.runtime.codex.authMode}`,
    )
  }

  // TEST C — Agent Registry (expect filesystem 279 or mock fallback > 0)
  {
    const repo = new JsonSettingsRepository(FILE)
    const svc = new SettingsService(repo, mockAi(false), mockSearch)
    const board = await svc.buildBoard()
    record(
      'TEST C agent registry',
      board.runtime.agents.total > 0 &&
        board.status.find((s) => s.id === 'agents')?.value ===
          String(board.runtime.agents.total),
      `total=${board.runtime.agents.total} source=${board.runtime.agents.source}`,
    )
  }

  // TEST D — Settings save / reload
  {
    const repo = new JsonSettingsRepository(FILE)
    const svc = new SettingsService(repo, mockAi(true), mockSearch)
    await svc.update({ openai: { model: 'gpt-4.1-mini', enabled: true } })
    const reloaded = await new JsonSettingsRepository(FILE).load()
    const raw = await readFile(FILE, 'utf8')
    record(
      'TEST D settings persistence',
      reloaded.openai.model === 'gpt-4.1-mini' &&
        JSON.parse(raw).openai.model === 'gpt-4.1-mini',
      `model=${reloaded.openai.model}`,
    )
  }

  // TEST E — Model Profile change
  {
    const repo = new JsonSettingsRepository(FILE)
    const svc = new SettingsService(repo, mockAi(true), mockSearch)
    await svc.update({
      modelProfiles: {
        FAST: { model: 'gpt-4o-mini' },
        REASONING: { model: 'gpt-4.1' },
      },
    })
    const s = await svc.get()
    record(
      'TEST E model profiles',
      s.modelProfiles.FAST.model === 'gpt-4o-mini' &&
        s.modelProfiles.REASONING.model === 'gpt-4.1' &&
        s.modelProfiles.STANDARD.roles.includes('research'),
      `fast=${s.modelProfiles.FAST.model} reasoning=${s.modelProfiles.REASONING.model}`,
    )
  }

  // TEST F — Search fallback settings
  {
    const repo = new JsonSettingsRepository(FILE)
    const svc = new SettingsService(repo, mockAi(true), mockSearch)
    await svc.update({
      webSearch: {
        failPolicy: 'allow-continue-without',
        providers: [
          { id: 'openai-web-search', enabled: false },
          { id: 'steam', enabled: true },
          { id: 'duckduckgo', enabled: true },
        ],
      },
    })
    const s = await svc.get()
    const steam = s.webSearch.providers.find((p) => p.id === 'steam')
    const openai = s.webSearch.providers.find((p) => p.id === 'openai-web-search')
    record(
      'TEST F search fallback',
      s.webSearch.failPolicy === 'allow-continue-without' &&
        steam?.enabled === true &&
        openai?.enabled === false,
      `fail=${s.webSearch.failPolicy} steam=${steam?.enabled} oai=${openai?.enabled}`,
    )
  }

  // TEST G — Budget save
  {
    const repo = new JsonSettingsRepository(FILE)
    const svc = new SettingsService(repo, mockAi(true), mockSearch)
    await svc.update({
      budget: { maxCost: 25, maxTokens: 500_000, warningThreshold: 0.7 },
    })
    const s = await svc.get()
    record(
      'TEST G budget',
      s.budget.maxCost === 25 &&
        s.budget.maxTokens === 500_000 &&
        s.budget.warningThreshold === 0.7,
      `cost=${s.budget.maxCost} tokens=${s.budget.maxTokens}`,
    )
  }

  // TEST H — Secret not in API response / persisted file
  {
    const repo = new JsonSettingsRepository(FILE)
    const svc = new SettingsService(repo, mockAi(true), mockSearch)
    const board = await svc.buildBoard()
    let leaked = false
    try {
      assertNoSecretsInPayload(board)
    } catch {
      leaked = true
    }
    const raw = await readFile(FILE, 'utf8')
    const hasSecretValue =
      /sk-[a-zA-Z0-9]{20,}/.test(raw) ||
      /"OPENAI_API_KEY"\s*:\s*"[^"]{8,}"/.test(raw)
    record(
      'TEST H no secrets exposed',
      !leaked &&
        !hasSecretValue &&
        board.runtime.openai.apiKeyConfigured ===
          Boolean(process.env.OPENAI_API_KEY?.trim()) &&
        !('apiKey' in (board.runtime.openai as object)),
      `leaked=${leaked} fileSecret=${hasSecretValue}`,
    )
  }

  // TEST I — Safety required cannot disable
  {
    const current = await new JsonSettingsRepository(FILE).load()
    const { settings, rejectedSafety } = applySettingsPatch(current, {
      safety: {
        humanApproval: false,
        verifyAfterCodeChange: false,
        codeReview: false,
      },
    })
    record(
      'TEST I safety lock',
      settings.safety.humanApproval === true &&
        settings.safety.verifyAfterCodeChange === true &&
        settings.safety.codeReview === false &&
        rejectedSafety.includes('humanApproval') &&
        rejectedSafety.includes('verifyAfterCodeChange'),
      `rejected=${rejectedSafety.join(',')}`,
    )

    const repo = new JsonSettingsRepository(FILE)
    const svc = new SettingsService(repo, mockAi(true), mockSearch)
    const updated = await svc.update({
      safety: { humanApproval: false, verifyAfterCodeChange: false },
    })
    record(
      'TEST I safety persist lock',
      updated.settings.safety.humanApproval === true &&
        updated.settings.safety.verifyAfterCodeChange === true &&
        updated.rejectedSafety.length >= 2,
      `rejected=${updated.rejectedSafety.join(',')}`,
    )
  }

  // Connection test skip
  {
    const repo = new JsonSettingsRepository(FILE)
    const svc = new SettingsService(repo, mockAi(true), mockSearch)
    const t = svc.connectionTestOpenAI()
    record(
      'TEST connection test skipped',
      t.skipped === true && t.ran === false,
      t.reason.slice(0, 40),
    )
  }

  console.log('\n========== S1 SUMMARY ==========')
  const pass = results.filter((r) => r.ok).length
  const fail = results.filter((r) => !r.ok).length
  console.log(`pass=${pass} fail=${fail} dir=${DIR}`)
  for (const r of results) {
    console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}`)
  }

  await rm(DIR, { recursive: true, force: true }).catch(() => undefined)
  if (fail > 0) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
