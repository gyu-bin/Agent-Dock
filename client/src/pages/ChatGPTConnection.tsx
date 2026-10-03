import { useCallback, useEffect, useState } from 'react'
import { disconnectChatGPT, fetchChatGPTModels, fetchChatGPTStatus, startChatGPTSignIn } from '../api/client'
import type { ChatGPTAuthStatus, ChatGPTModel } from '../domain/types'
import styles from './SettingsPage.module.css'

export function ChatGPTConnection({onChange, onModels}: {onChange: () => Promise<void>; onModels: (models: ChatGPTModel[]) => void}) {
  const [status, setStatus] = useState<ChatGPTAuthStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const refresh = useCallback(async () => {
    const next = await fetchChatGPTStatus()
    setStatus(next)
    if (next.planUsageEnabled) onModels(await fetchChatGPTModels())
    else onModels([])
    return next
  }, [onModels])
  useEffect(() => { void refresh().catch(e => setMessage(e.message)) }, [refresh])
  useEffect(() => {
    if (!status?.loginPending) return
    const timer = window.setInterval(() => {
      void refresh().then(async next => {
        if (!next.loginPending) {
          setMessage(next.lastError?.message ?? (next.planUsageEnabled ? 'ChatGPT 플랜이 연결되었습니다.' : '플랜 사용 권한을 확인해주세요.'))
          await onChange()
        }
      }).catch(e => setMessage(e.message))
    }, 2000)
    return () => window.clearInterval(timer)
  }, [status?.loginPending, refresh, onChange])
  async function signIn(newAccount = false) {
    setBusy(true)
    try {
      await startChatGPTSignIn(newAccount)
      setMessage('열린 브라우저에서 직접 로그인하고 플랜 사용을 승인해주세요.')
      await refresh()
    } catch (e) { setMessage(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  async function disconnect() {
    setBusy(true)
    try {
      const result = await disconnectChatGPT()
      setMessage(result.message ?? '이 컴퓨터의 연결을 해제했습니다.')
      await refresh(); await onChange()
    } catch (e) { setMessage(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  return <section className={styles.card}>
    <h2>ChatGPT 플랜 연결</h2>
    <p className={styles.hint}>일반 채팅과 분석은 연결한 ChatGPT 플랜의 사용량을 사용합니다. 이미지 생성은 별도 API 설정이 필요합니다.</p>
    <p className={status?.planUsageEnabled ? styles.ok : styles.off}>
      {status?.planUsageEnabled ? '● 플랜 사용 가능' : status?.signedIn ? '로그인됨 · 플랜 권한 필요' : '○ 로그인 필요'}
    </p>
    {status?.account ? <p>{status.account.name ?? status.account.email ?? 'ChatGPT 계정'}{status.account.name && status.account.email ? ` · ${status.account.email}` : ''}</p> : null}
    {status && !status.supported ? <p className={styles.hint}>Vercel에서는 이 로컬 로그인 방식을 사용할 수 없습니다. 이 컴퓨터에서 실행한 Agent Deck에서 연결해주세요. Vercel에서 AI를 실행하려면 OpenAI API 모드를 선택하고 별도 API 잔액을 준비해주세요.</p> : null}
    <div className={styles.modeRow}>
      <button className={styles.primary} disabled={!status?.supported || busy || status.loginPending} onClick={() => void signIn()}>Continue with ChatGPT</button>
      {status?.signedIn ? <><button className={styles.ghost} disabled={busy} onClick={() => void signIn(true)}>계정 변경</button><button className={styles.ghost} disabled={busy} onClick={() => void disconnect()}>연결 해제</button></> : null}
    </div>
    {status?.lastError ? <p className={styles.error}>{status.lastError.message}</p> : null}
    {message ? <p className={styles.hint} role="status">{message}</p> : null}
  </section>
}
