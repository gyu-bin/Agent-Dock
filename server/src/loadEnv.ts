import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** True when running on Vercel (or AGENT_DECK_CLOUD=1). */
export function isCloudRuntime(): boolean {
  return (
    Boolean(process.env.VERCEL) || process.env.AGENT_DECK_CLOUD === '1'
  )
}

/**
 * Cloud data paths. Everything lives under one root (default /tmp/agent-deck);
 * when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set, storage/dataFs.ts
 * persists that root to Supabase instead of the ephemeral per-instance /tmp.
 */
export function applyCloudDataDefaults(): void {
  if (!isCloudRuntime()) return
  const root = (process.env.AGENT_DECK_CLOUD_ROOT ??= '/tmp/agent-deck')
  process.env.AGENT_DECK_DATA_FILE ??= `${root}/projects.json`
  process.env.AGENT_DECK_ARTIFACTS_DIR ??= `${root}/artifacts`
  process.env.AGENT_DECK_KNOWLEDGE_DIR ??= `${root}/knowledge`
  process.env.AGENT_DECK_USAGE_DIR ??= `${root}/usage`
  process.env.AGENT_DECK_SETTINGS_FILE ??= `${root}/settings.json`
  process.env.AGENT_DECK_SESSION_FILE ??= `${root}/.local-session`
  process.env.AGENT_DECK_OPERATIONS_DIR ??= `${root}/operations`
  process.env.AGENT_DECK_MARKETING_DIR ??= `${root}/marketing`
  process.env.AGENT_DECK_SOCIAL_DIR ??= `${root}/social`
  process.env.AGENT_DECK_MEDIA_DELIVERY_DIR ??= `${root}/media-delivery`
  process.env.AGENT_DECK_GENERATED_DIR ??= `${root}/generated`
  process.env.AGENT_DECK_ATTACHMENTS_DIR ??= `${root}/attachments`
  process.env.AGENT_DECK_ATTACHMENTS_META_DIR ??= `${root}/attachments-meta`
  process.env.AGENT_DECK_CREDENTIALS_DIR ??= `${root}/credentials`
}

/** Load .env from repo root / server without printing values. */
export function loadDotEnv(): void {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const candidates = [
    path.resolve(here, '../../.env'),
    path.resolve(here, '../.env'),
    path.resolve(process.cwd(), '.env'),
  ]
  for (const file of candidates) {
    if (!existsSync(file)) continue
    const text = readFileSync(file, 'utf8')
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq <= 0) continue
      const key = trimmed.slice(0, eq).trim()
      let val = trimmed.slice(eq + 1).trim()
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1)
      }
      if (process.env[key] === undefined) process.env[key] = val
    }
    break
  }
  applyCloudDataDefaults()
}
