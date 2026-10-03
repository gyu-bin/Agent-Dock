import { Activity, ArrowUpRight, CheckCircle2, CirclePause, Clock3 } from 'lucide-react'
import { useDeckStore } from '../store/useDeckStore'
import { taskProgress } from '../engine/types'
import { userFacingTaskStatus } from '../domain/taskDisplay'
import styles from './HomeWorkStatus.module.css'

const ACTIVE = new Set(['running', 'review', 'verifying', 'awaiting_approval', 'queued', 'paused', 'interrupted'])
export function HomeWorkStatus() {
  const projectId = useDeckStore(s => s.activeProjectId)
  const tasks = useDeckStore(s => s.tasks)
  const steps = useDeckStore(s => s.pipelineSteps)
  const registry = useDeckStore(s => s.registry)
  const runtime = useDeckStore(s => s.agentRuntime)
  const selectTask = useDeckStore(s => s.selectTask)
  const setNav = useDeckStore(s => s.setNav)
  const projectTasks = tasks.filter(t => t.projectId === projectId).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt))
  const active = projectTasks.filter(t => ACTIVE.has(t.status)).sort((a,b) => {
    const rank = (status: string) => ['running','review','verifying'].includes(status) ? 0 : status === 'awaiting_approval' ? 1 : 2
    return rank(a.status) - rank(b.status) || b.updatedAt.localeCompare(a.updatedAt)
  })
  const recent = projectTasks.filter(t => !ACTIVE.has(t.status)).slice(0, 3)
  const visible = [...active, ...recent].slice(0, 4)
  const workers = Object.entries(runtime).filter(([,r]) => r.currentTaskId && active.some(t => t.id === r.currentTaskId) && ['working','reviewing','verifying'].includes(r.status ?? ''))
  function openTask(id: string) { selectTask(id); setNav('tasks') }
  return <section className={styles.panel} aria-label="실시간 작업 현황">
    <header><div><Activity size={16}/><h2>실시간 작업</h2><span className={styles.live}>LIVE</span></div><span>{workers.length}명 작업 중 · {active.length}개 진행</span></header>
    {visible.length ? <div className={styles.cards}>{visible.map(task => {
      const taskSteps = steps.filter(s => s.taskId === task.id)
      const current = taskSteps.find(s => ['running','reviewing','verifying'].includes(s.status)) ?? taskSteps.find(s => s.status === 'awaiting_approval')
      const taskWorkers = Object.entries(runtime).filter(([,r]) => r.currentTaskId === task.id)
      const workerIds = [...new Set([...taskWorkers.map(([id]) => id), ...(current && current.provider !== 'human' ? [current.agentId] : [])])]
      const names = workerIds.map(id => registry.find(a => a.id === id)?.name ?? id)
      const progress = taskSteps.length ? taskProgress(task.id, steps) : task.progress
      const label = userFacingTaskStatus(task, current)
      const Icon = task.status === 'completed' ? CheckCircle2 : task.status === 'awaiting_approval' ? Clock3 : ACTIVE.has(task.status) ? Activity : CirclePause
      return <button key={task.id} className={styles.card} onClick={() => openTask(task.id)}>
        <div className={styles.cardTop}><span><Icon size={13}/>{label}</span><b>{progress}%</b></div>
        <strong>{task.title}</strong>
        <p>{names.length ? `${names.join(', ')}${['paused','interrupted'].includes(task.status) ? ' · 작업 중단됨' : ''}` : task.status === 'awaiting_approval' ? '승인을 기다리고 있어요' : task.status === 'queued' ? '담당자 배정 대기' : '현재 작업 중인 담당자 없음'}</p>
        <div className={styles.detail}><span>{current?.label ?? (task.status === 'completed' ? '결과물을 확인해주세요' : '작업 기록 보기')}</span><ArrowUpRight size={14}/></div>
        <div className={styles.track}><i style={{width:`${progress}%`}}/></div>
      </button>
    })}</div> : <div className={styles.empty}>아직 진행 중인 작업이 없어요. 오른쪽에서 요청하면 담당자와 진행 상황이 여기에 표시됩니다.</div>}
  </section>
}
