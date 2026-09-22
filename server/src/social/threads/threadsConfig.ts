/**
 * Threads app config from env — official Meta Threads API.
 * Docs: https://developers.facebook.com/docs/threads/
 */

export const THREADS_GRAPH_BASE = 'https://graph.threads.com'
export const THREADS_API_VERSION = 'v1.0'
export const THREADS_OAUTH_AUTHORIZE =
  'https://threads.com/oauth/authorize'
export const THREADS_SCOPES = ['threads_basic', 'threads_content_publish'] as const

export interface ThreadsAppConfig {
  appId: string
  appSecret: string
  redirectUri: string
  configured: boolean
}

export function getThreadsAppConfig(
  env: NodeJS.ProcessEnv = process.env,
): ThreadsAppConfig {
  const appId =
    env.THREADS_APP_ID?.trim() || env.THREADS_CLIENT_ID?.trim() || ''
  const appSecret =
    env.THREADS_APP_SECRET?.trim() || env.THREADS_CLIENT_SECRET?.trim() || ''
  const redirectUri =
    env.THREADS_REDIRECT_URI?.trim() ||
    `http://127.0.0.1:${env.PORT?.trim() || '8787'}/api/social/threads/oauth/callback`

  return {
    appId,
    appSecret,
    redirectUri,
    configured: Boolean(appId && appSecret),
  }
}

export function threadsGraphUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`
  if (p.startsWith('/oauth') || p.startsWith('/access_token') || p.startsWith('/refresh_access_token')) {
    return `${THREADS_GRAPH_BASE}${p}`
  }
  return `${THREADS_GRAPH_BASE}/${THREADS_API_VERSION}${p}`
}
