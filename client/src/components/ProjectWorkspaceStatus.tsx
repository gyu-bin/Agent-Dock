import { useEffect, useState } from 'react'
import { Cloud, LoaderCircle, RefreshCw } from 'lucide-react'
import { fetchProjectWorkspace, projectWorkspaceAction } from '../api/client'
import type { Project } from '../domain/types'
import styles from './ProjectWorkspaceStatus.module.css'

type Workspace = Awaited<ReturnType<typeof fetchProjectWorkspace>>
const BUSY = new Set(['provisioning', 'cloning', 'busy'])
const STATUS: Record<string, string> = {
  provisioning: '환경 준비 중', cloning: '저장소 가져오는 중', ready: 'Cloud Ready',
  busy: '환경 확인 중', failed: '문제 발생', expired: '환경 만료',
}
const RESULT: Record<string, string> = { passed: '통과', failed: '실패', skipped: '생략', running: '진행 중', pending: '대기' }

export function ProjectWorkspaceStatus({ project }: { project: Project }) {
  const [workspace, setWorkspace] = useState<Workspace>(null)
  const [loading, setLoading] = useState(true)
  const [action, setAction] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmDestroy, setConfirmDestroy] = useState(false)
  const busy = Boolean(action || (workspace && BUSY.has(workspace.status)))

  useEffect(() => {
    if (project.sourceType !== 'github') return
    let cancelled = false
    setLoading(true)
    void fetchProjectWorkspace(project.id).then((result) => {
      if (!cancelled) { setWorkspace(result); setError(null) }
    }).catch((err: unknown) => {
      if (!cancelled) setError(err instanceof Error ? err.message : '환경 상태를 가져오지 못했습니다.')
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [project.id, project.sourceType])

  useEffect(() => {
    if (!workspace || !BUSY.has(workspace.status)) return
    let cancelled = false
    let timer: number | undefined
    async function poll() {
      try {
        const result = await fetchProjectWorkspace(project.id)
        if (!cancelled) { setWorkspace(result); setError(null) }
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : '환경 상태 갱신에 실패했습니다.')
      } finally {
        if (!cancelled) timer = window.setTimeout(() => void poll(), 3000)
      }
    }
    timer = window.setTimeout(() => void poll(), 3000)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [project.id, workspace?.status])

  if (project.sourceType !== 'github') return null

  async function run(kind: 'provision' | 'verify' | 'destroy') {
    setAction(kind)
    setError(null)
    try {
      setWorkspace(await projectWorkspaceAction(project.id, kind))
      setConfirmDestroy(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : '환경 작업에 실패했습니다.')
    } finally { setAction(null) }
  }

  const verification = workspace?.verification
  return <section className={styles.panel} aria-label="프로젝트 Workspace">
    <header className={styles.head}>
      <h3><Cloud size={16} /> Workspace</h3>
      <span className={styles.status} data-status={workspace?.status ?? 'none'} aria-live="polite">
        {busy || loading ? <LoaderCircle size={13} className={styles.spin} /> : <span className={styles.dot} />}
        {loading ? '상태 확인 중' : workspace ? STATUS[workspace.status] ?? workspace.status : '환경 준비 필요'}
      </span>
    </header>
    <dl className={styles.metadata}>
      <div><dt>Repository</dt><dd>{project.repository?.fullName ?? '저장소 미연결'}</dd></div>
      <div><dt>Branch</dt><dd>{workspace?.branch ?? project.repository?.defaultBranch ?? '—'}</dd></div>
      <div><dt>Revision</dt><dd><code>{workspace?.revision?.slice(0, 12) ?? '—'}</code></dd></div>
    </dl>
    {verification && <div className={styles.results} aria-label="환경 확인 결과">
      {(['install', 'typecheck', 'build', 'test'] as const).map((name) => <div key={name} data-status={verification[name]?.status ?? 'pending'}>
        <span>{name}</span><strong>{RESULT[verification[name]?.status ?? 'pending'] ?? verification[name]?.status}</strong>
      </div>)}
    </div>}
    {(error || workspace?.error) && <p className={styles.error} role="alert">{error ?? workspace?.error?.message}</p>}
    <div className={styles.actions}>
      <button type="button" disabled={busy || loading} onClick={() => void run('provision')}>{action === 'provision' ? '준비 중…' : workspace?.status === 'ready' ? '환경 재연결' : '환경 준비'}</button>
      <button type="button" disabled={busy || loading || workspace?.status !== 'ready'} onClick={() => void run('verify')}><RefreshCw size={13} />환경 확인</button>
      {workspace && <button type="button" className={styles.destroy} disabled={busy || loading} onClick={() => setConfirmDestroy(true)}>환경 종료</button>}
    </div>
    {confirmDestroy && <div className={styles.confirm}>
      <p>Sandbox 환경과 연결 정보를 종료합니다. GitHub 저장소·브랜치·커밋은 그대로 유지됩니다.</p>
      <button type="button" disabled={busy} onClick={() => void run('destroy')}>환경 종료 확인</button>
      <button type="button" disabled={busy} onClick={() => setConfirmDestroy(false)}>돌아가기</button>
    </div>}
    <p className={styles.note}>환경 확인은 저장소의 install·typecheck·build·test를 실행합니다. Cloud Codex와 ChatGPT 플랜 인증은 다음 단계에서 연결합니다.</p>
  </section>
}
