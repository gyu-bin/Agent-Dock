import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle2, ExternalLink, Link2, RefreshCw, Unplug } from 'lucide-react'
import { directSocialAction, disconnectThreads, fetchSocialConnectors, startThreadsOAuth } from '../api/client'
import styles from './SocialConnections.module.css'

type Channel = 'threads' | 'instagram' | 'x' | 'youtube' | 'reddit'
type Connector = Awaited<ReturnType<typeof fetchSocialConnectors>>['connectors'][number]
const CHANNELS: Array<{ id: Channel; name: string; mark: string; description: string; portal: string }> = [
  { id: 'threads', name: 'Threads', mark: '@', description: 'Threads 계정 연결', portal: 'https://developers.facebook.com/docs/threads/' },
  { id: 'instagram', name: 'Instagram', mark: '◎', description: '프로페셔널 Instagram 계정 연결', portal: 'https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/' },
  { id: 'x', name: 'X', mark: '𝕏', description: 'X 계정 연결', portal: 'https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code' },
  { id: 'youtube', name: 'YouTube', mark: '▶', description: 'Google 계정으로 YouTube 연결', portal: 'https://developers.google.com/youtube/v3/guides/authentication' },
  { id: 'reddit', name: 'Reddit', mark: 'r/', description: 'Reddit 계정 연결', portal: 'https://github.com/reddit-archive/reddit/wiki/OAuth2' },
]
export function SocialConnections() {
  const [connectors, setConnectors] = useState<Connector[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<Channel | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search)
    return params.get('social') === 'connected' || params.get('threads') === 'connected' ? 'SNS 계정 연결이 완료되었습니다.' : ['denied','error'].includes(params.get('social') ?? '') || params.get('threads') === 'error' ? 'SNS 연결이 승인되지 않았습니다. 다시 연결해주세요.' : null
  })
  const mounted = useRef(true)
  const refresh = useCallback(async () => {
    try {
      const result = await fetchSocialConnectors()
      if (mounted.current) { setConnectors(result.connectors); setError(null) }
    } catch { if (mounted.current) setError('연결 상태를 불러오지 못했습니다. 다시 확인해주세요.') }
    finally { if (mounted.current) setLoading(false) }
  }, [])
  useEffect(() => {
    mounted.current = true
    const url = new URL(window.location.href)
    for (const key of ['settings','social','threads','user','msg']) url.searchParams.delete(key)
    window.history.replaceState(null, '', url.pathname + url.search + url.hash)
    void refresh()
    const onFocus = () => { void refresh() }
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisible)
    return () => { mounted.current = false; window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onVisible) }
  }, [refresh])

  async function connect(channel: Channel) {
    setBusy(channel); setError(null); setNotice(null)
    try {
      const result = channel === 'threads' ? await startThreadsOAuth() : await directSocialAction(channel, 'oauth/start')
      if (!result.authorizeUrl) throw new Error('로그인 주소를 받지 못했습니다. 연결을 다시 시도해주세요.')
      const url = new URL(result.authorizeUrl)
      if (url.protocol !== 'https:') throw new Error('올바른 SNS 로그인 주소가 아닙니다.')
      window.location.assign(url.href)
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : '연결을 시작하지 못했습니다.') }
    finally { if (mounted.current) setBusy(null) }
  }
  async function disconnect(channel: Channel) {
    setBusy(channel); setError(null); setNotice(null)
    try {
      if (channel === 'threads') await disconnectThreads()
      else await directSocialAction(channel, 'disconnect')
      if (mounted.current) setNotice(`${CHANNELS.find(item => item.id === channel)?.name} 연결을 해제했습니다.`)
      await refresh()
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : '연결을 해제하지 못했습니다.') }
    finally { if (mounted.current) setBusy(null) }
  }
  const connectedCount = CHANNELS.filter(channel => connectors.some(connector => connector.channel === channel.id && connector.connection?.status === 'connected')).length
  return <section className={styles.section} aria-label="SNS 계정 연결">
    <header className={styles.header}><div><span className={styles.eyebrow}>SOCIAL ACCOUNTS</span><h2>내 SNS 연결</h2><p>각 서비스에 직접 로그인하고 Agent Deck의 접근을 승인하세요.</p></div><button type="button" className={styles.refresh} onClick={() => void refresh()} disabled={busy !== null}><RefreshCw size={14} />상태 확인</button></header>
    <div className={styles.overview}><Link2 size={17} /><span><strong>{connectedCount} / {CHANNELS.length}</strong> 계정 연결</span><span>계정 승인 후 연결 상태가 표시됩니다.</span></div>
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
    {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
    <div className={styles.grid}>{CHANNELS.map(channel => {
      const candidates = connectors.filter(connector => connector.channel === channel.id)
      const connector = candidates.find(item => item.id === channel.id || item.id === `direct-${channel.id}` || item.id === `threads-real`) ?? candidates.find(item => !item.id.includes('buffer') && !item.id.includes('fake'))
      const connected = connector?.connection?.status === 'connected'
      const configured = connector?.configured ?? false
      const expired = connector?.connection?.status === 'expired'
      const state = loading ? '확인 중' : connected ? '연결됨' : expired ? '다시 로그인 필요' : configured ? '로그인 필요' : '앱 설정 필요'
      return <article key={channel.id} className={styles.card}>
        <div className={styles.cardHeading}><span className={styles.logo} data-channel={channel.id}>{channel.mark}</span><span className={styles.badge} data-connected={connected}>{connected ? <CheckCircle2 size={12} /> : null}{state}</span></div>
        <h3>{channel.name}</h3><p>{channel.description}</p>
        <div className={styles.account}>{connected ? connector?.connection?.username ?? '계정 연결 완료' : configured ? '계정을 선택해 연결하세요.' : '개발자 앱 인증 정보가 필요합니다.'}</div>
        <div className={styles.actions}><button type="button" className={styles.connect} disabled={loading || !configured || busy !== null} onClick={() => void connect(channel.id)}><Link2 size={14} />{busy === channel.id ? '처리 중…' : connected ? '계정 변경' : '연결하기'}</button>{connected || expired ? <button type="button" aria-label={`${channel.name} 연결 해제`} className={styles.disconnect} disabled={busy !== null} onClick={() => void disconnect(channel.id)}><Unplug size={14} /></button> : null}</div>
        {!configured && !loading ? <details className={styles.setup}><summary>연결 설정 방법</summary><p>서버에 {channel.name} 개발자 앱 인증 정보를 설정한 뒤 서버를 다시 시작하세요. {channel.id === 'threads' ? '실행할 서버 환경에 설정하세요.' : '현재 로컬 서버에서만 연결할 수 있습니다. Vercel 연결은 아직 지원하지 않습니다.'}</p><p><code>{channel.id === 'threads' ? 'THREADS_APP_ID · THREADS_APP_SECRET' : `${channel.id.toUpperCase()}_CLIENT_ID · ${channel.id.toUpperCase()}_CLIENT_SECRET`}</code><br /><code>{channel.id.toUpperCase()}_REDIRECT_URI</code></p><p>콜백 경로: <code>/api/social/{channel.id}/oauth/callback</code></p><a href={channel.portal} target="_blank" rel="noreferrer">공식 개발자 가이드 <ExternalLink size={12} /></a></details> : null}
        {connected ? <span className={styles.scopeNote}>{connector?.capabilities.length ? '사용 가능 기능: ' + connector.capabilities.map(capability => ({ 'text.publish': '텍스트 게시', 'image.publish': '이미지 게시', 'video.publish': '영상 게시', 'analytics.read': '성과 조회' }[capability] ?? capability)).join(' · ') : '계정 인증 완료 · 게시 기능은 별도로 확인됩니다.'}</span> : null}
      </article>
    })}</div>
    <p className={styles.footer}>Threads는 연결 후 게시할 수 있습니다. Instagram·X·YouTube·Reddit는 로컬 서버에서 계정 인증을 연결합니다. 해당 서비스의 게시 기능은 아직 제공하지 않습니다.</p>
  </section>
}
