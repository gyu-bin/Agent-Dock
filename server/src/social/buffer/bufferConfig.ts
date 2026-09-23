/** Buffer env — secrets never returned via API. */

export const BUFFER_GRAPHQL_ENDPOINT = 'https://api.buffer.com'

export function getBufferApiKey(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const key = env.BUFFER_API_KEY?.trim()
  return key || undefined
}

export function hasBufferApiKey(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(getBufferApiKey(env))
}
