/**
 * Redact secrets from strings / objects before logging or API responses.
 */

const TOKEN_LIKE =
  /(access_token|refresh_token|client_secret|THREADS_APP_SECRET|Bearer\s+)[=:\s]*[A-Za-z0-9._\-/%+=]{8,}/gi

export function redactSecrets(text: string): string {
  return text.replace(TOKEN_LIKE, '$1=[REDACTED]')
}

export function assertNoTokenLeak(payload: unknown): void {
  const raw = JSON.stringify(payload)
  if (/access_token|refresh_token|client_secret/i.test(raw)) {
    // Allow keys that are explicitly null/false/boolean flags only if value empty — still block
    if (
      /"(access_token|refresh_token|client_secret)"\s*:\s*"[^"]+"/i.test(raw)
    ) {
      throw new Error('Refusing to serialize credential secret into response')
    }
  }
}
