/**
 * File-backed CredentialRepository.
 * Path: server/data/credentials/{provider}__{accountKey}.json
 * Mode 0o600. Never mixed into projects.json / social / marketing.
 */

import { mkdir, readFile, writeFile, readdir, unlink, chmod } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { rename } from 'node:fs/promises'
import type {
  CredentialProviderId,
  CredentialPublicMeta,
  CredentialRepository,
  StoredCredential,
} from './types.js'

function defaultDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url))
  return (
    process.env.AGENT_DECK_CREDENTIALS_DIR ??
    path.resolve(here, '../../data/credentials')
  )
}

function safePart(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120) || 'default'
}

export class FileCredentialStore implements CredentialRepository {
  private chains = new Map<string, Promise<void>>()

  constructor(private readonly dir = defaultDir()) {}

  private fileFor(provider: CredentialProviderId, accountKey: string): string {
    return path.join(
      this.dir,
      `${safePart(provider)}__${safePart(accountKey)}.json`,
    )
  }

  private enqueue(key: string, fn: () => Promise<void>): Promise<void> {
    const prev = this.chains.get(key) ?? Promise.resolve()
    const next = prev.then(fn, fn)
    this.chains.set(
      key,
      next.then(
        () => undefined,
        () => undefined,
      ),
    )
    return next
  }

  async get(
    provider: CredentialProviderId,
    accountKey: string,
  ): Promise<StoredCredential | null> {
    try {
      const raw = await readFile(this.fileFor(provider, accountKey), 'utf8')
      const parsed = JSON.parse(raw) as StoredCredential
      if (!parsed?.secret?.accessToken || !parsed?.meta) return null
      return parsed
    } catch (err) {
      const code =
        err && typeof err === 'object' && 'code' in err
          ? (err as { code?: string }).code
          : ''
      if (code === 'ENOENT') return null
      throw err
    }
  }

  async getMeta(
    provider: CredentialProviderId,
    accountKey: string,
  ): Promise<CredentialPublicMeta | null> {
    const full = await this.get(provider, accountKey)
    return full?.meta ?? null
  }

  async save(credential: StoredCredential): Promise<void> {
    const key = `${credential.meta.provider}__${credential.meta.accountKey}`
    await this.enqueue(key, async () => {
      await mkdir(this.dir, { recursive: true, mode: 0o700 })
      try {
        await chmod(this.dir, 0o700)
      } catch {
        // best-effort on platforms that ignore mode
      }
      const file = this.fileFor(
        credential.meta.provider,
        credential.meta.accountKey,
      )
      const tmp = `${file}.${process.pid}.tmp`
      const body = JSON.stringify(credential, null, 2)
      await writeFile(tmp, body, { mode: 0o600 })
      try {
        await chmod(tmp, 0o600)
      } catch {
        // ignore
      }
      await rename(tmp, file)
      try {
        await chmod(file, 0o600)
      } catch {
        // ignore
      }
    })
  }

  async delete(
    provider: CredentialProviderId,
    accountKey: string,
  ): Promise<void> {
    const key = `${provider}__${accountKey}`
    await this.enqueue(key, async () => {
      try {
        await unlink(this.fileFor(provider, accountKey))
      } catch {
        // ignore missing
      }
    })
  }

  async listMeta(
    provider?: CredentialProviderId,
  ): Promise<CredentialPublicMeta[]> {
    try {
      await mkdir(this.dir, { recursive: true, mode: 0o700 })
      const files = await readdir(this.dir)
      const out: CredentialPublicMeta[] = []
      for (const f of files) {
        if (!f.endsWith('.json')) continue
        if (provider && !f.startsWith(`${provider}__`)) continue
        const [prov, ...rest] = f.replace(/\.json$/, '').split('__')
        const accountKey = rest.join('__') || 'global'
        const meta = await this.getMeta(
          prov as CredentialProviderId,
          accountKey,
        )
        if (meta) out.push(meta)
      }
      return out
    } catch {
      return []
    }
  }
}

export const credentialStore = new FileCredentialStore()
