import { useState } from 'react'
import { sendMagicLink, signOut, useAuthStore } from './cloudAuth'
import styles from './LoginScreen.module.css'

export function LoginScreen() {
  const status = useAuthStore((s) => s.status)
  const email = useAuthStore((s) => s.email)
  const [value, setValue] = useState('')
  const [phase, setPhase] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [message, setMessage] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!value.trim()) return
    setPhase('sending')
    const r = await sendMagicLink(value)
    if ('message' in r) {
      setPhase('error')
      setMessage(r.message)
    } else {
      setPhase('sent')
    }
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <div className={styles.brand}>
          <span className={styles.logo} aria-hidden="true" />
          <div>
            <b>Agent Deck</b>
            <span>클라우드 스튜디오</span>
          </div>
        </div>

        {status === 'checking' ? <p className={styles.muted}>로그인 상태를 확인하는 중…</p> : null}

        {status === 'misconfigured' ? (
          <div className={styles.notice}>
            <b>로그인 설정이 아직 안 되어 있어요</b>
            <p>
              Vercel 환경변수에 <code>SUPABASE_URL</code>, <code>SUPABASE_ANON_KEY</code>,{' '}
              <code>SUPABASE_SERVICE_ROLE_KEY</code>, <code>AGENT_DECK_ALLOWED_EMAILS</code>를 넣고 다시 배포해 주세요.
            </p>
          </div>
        ) : null}

        {status === 'not-allowed' ? (
          <div className={styles.notice}>
            <b>접근 권한이 없는 계정이에요</b>
            <p>{email ?? '이 계정'}은(는) 허용 목록에 없어요. 허용된 이메일로 다시 로그인해 주세요.</p>
            <button type="button" className={styles.secondary} onClick={() => void signOut()}>
              다른 이메일로 로그인
            </button>
          </div>
        ) : null}

        {status === 'signed-out' ? (
          phase === 'sent' ? (
            <div className={styles.sent}>
              <b>메일을 보냈어요</b>
              <p>
                <strong>{value.trim()}</strong> 메일함에서 로그인 링크를 눌러 주세요. 이 탭으로 돌아오면 바로 들어가져요.
              </p>
              <button type="button" className={styles.secondary} onClick={() => setPhase('idle')}>
                이메일 다시 입력
              </button>
            </div>
          ) : (
            <form onSubmit={submit} className={styles.form}>
              <h1>로그인</h1>
              <p className={styles.muted}>이메일로 로그인 링크를 보내 드려요. 비밀번호는 필요 없어요.</p>
              <label htmlFor="login-email">이메일</label>
              <input
                id="login-email"
                type="email"
                autoComplete="email"
                required
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="you@example.com"
              />
              <button type="submit" disabled={phase === 'sending'}>
                {phase === 'sending' ? '보내는 중…' : '로그인 링크 받기'}
              </button>
              {phase === 'error' ? <p className={styles.error}>{message}</p> : null}
            </form>
          )
        ) : null}
      </div>
    </div>
  )
}
