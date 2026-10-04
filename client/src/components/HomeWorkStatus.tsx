import { Activity, ArrowUpRight, CheckCircle2, CirclePause, Clock3, Square } from 'lucide-react'
import { displayAgentName } from '../i18n/agentNames'
import { useDeckStore } from '../store/useDeckStore'
import { activityLine, isFinalizing, liveTaskPercent, taskTokens, useStepProgress } from '../domain/liveProgress'
import type { PipelineStep } from '../domain/types'
import { userFacingTaskStatus } from '../domain/taskDisplay'
import styles from './HomeWorkStatus.module.css'

const ACTIVE = new Set(['running', 'review', 'verifying', 'awaiting_approval', 'queued', 'paused', 'interrupted'])
export function HomeWorkStatus() {
  const projectId = useDeckStore(s => s.activeProjectId)
  const tasks = useDeckStore(s => s.tasks)
  const steps = useDeckStore(s => s.pipelineSteps)
  const registry = useDeckStore(s => s.registry)
  const runtime = useDeckStore(s => s.agentRuntime)
  const agentRuns = useDeckStore(s => s.agentRuns)
  const selectTask = useDeckStore(s => s.selectTask)
  const setNav = useDeckStore(s => s.setNav)
  const cancelTask = useDeckStore(s => s.cancelTask)
  const projectTasks = tasks.filter(t => t.projectId === projectId).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt))
  const active = projectTasks.filter(t => ACTIVE.has(t.status)).sort((a,b) => {
    const rank = (status: string) => ['running','review','verifying'].includes(status) ? 0 : status === 'awaiting_approval' ? 1 : 2
    return rank(a.status) - rank(b.status) || b.updatedAt.localeCompare(a.updatedAt)
  })
  // Live shows only work that is in flight or needs action; terminal tasks
  // (completed/failed/cancelled/rejected) live in the project's task history.
  const visible = active.slice(0, 4)
  // Busy = agents on a running step (persisted SoT), same as the office counts.
  const workers = [...new Set(steps.filter(s => active.some(t => t.id === s.taskId && ['running','verifying'].includes(t.status)) && ['running','reviewing'].includes(s.status)).map(s => s.agentId))]
  function openTask(id: string) { selectTask(id); setNav('tasks') }
  return <section className={styles.panel} aria-label="실시간 작업 현황">
    <header><div><Activity size={16}/><h2>실시간 작업</h2><span className={styles.live}>LIVE</span></div><span>{workers.length}명 작업 중 · {active.length}개 진행</span></header>
    {visible.length ? <div className={styles.cards}>{visible.map(task => {
      const taskSteps = steps.filter(s => s.taskId === task.id)
      const current = taskSteps.find(s => ['running','reviewing','verifying'].includes(s.status)) ?? taskSteps.find(s => s.status === 'awaiting_approval')
      const taskWorkers = Object.entries(runtime).filter(([,r]) => r.currentTaskId === task.id)
      const workerIds = [...new Set([...taskWorkers.map(([id]) => id), ...(current && current.provider !== 'human' ? [current.agentId] : [])])]
      const names = workerIds.map(id => displayAgentName(id, registry.find(a => a.id === id)?.name ?? id))
      const label = userFacingTaskStatus(task, current)
      const Icon = task.status === 'completed' ? CheckCircle2 : task.status === 'awaiting_approval' ? Clock3 : ACTIVE.has(task.status) ? Activity : CirclePause
      return <article key={task.id} className={styles.card}>
        <button className={styles.taskLink} onClick={() => openTask(task.id)} aria-label={`${task.title} 작업 상세 보기`}>
        <LiveProgress steps={taskSteps} current={current} fallback={task.progress} taskStatus={task.status}>{(progress, activity) => <>
        <div className={styles.cardTop}><span><Icon size={13}/>{label}</span><b>{progress}%</b></div>
        <strong>{task.title}</strong>
        <p>{taskTokens(agentRuns, task.id) ? <span className={styles.tokens}>토큰 {taskTokens(agentRuns, task.id).toLocaleString()}</span> : null}{names.length ? `${names.join(', ')}${['paused','interrupted'].includes(task.status) ? ' · 작업 중단됨' : ''}` : task.status === 'awaiting_approval' ? '승인을 기다리고 있어요' : task.status === 'queued' ? '담당자 배정 대기' : '현재 작업 중인 담당자 없음'}</p>
        <div className={styles.detail}><span>{current ? `${current.label}${activity ? ` · ${activity}` : ''}` : activity ? activity : task.status === 'completed' ? '결과물을 확인해주세요' : '작업 기록 보기'}</span><ArrowUpRight size={14}/></div>
        <div className={styles.track}><i style={{width:`${progress}%`}}/></div>
        </>}</LiveProgress>
        </button>
        {ACTIVE.has(task.status) ? <button type="button" className={styles.stop} onClick={() => cancelTask(task.id)} aria-label={`${task.title} 작업 중단`}><Square size={11}/>작업 중단</button> : null}
      </article>
    })}</div> : <div className={styles.empty}>아직 진행 중인 작업이 없어요. 오른쪽에서 요청하면 담당자와 진행 상황이 여기에 표시됩니다.</div>}
  </section>
}

/** Polls the running step so the card shows live progress instead of jumping per finished step. */
function LiveProgress({ steps, current, fallback, taskStatus, children }: { steps: PipelineStep[]; current?: PipelineStep; fallback: number; taskStatus: string; children: (percent: number, activity: string | null) => React.ReactNode }) {
  const p = useStepProgress(current?.id, current?.status === 'running')
  const activity = isFinalizing(steps, taskStatus) ? '최종 결과를 정리하는 중' : activityLine(p)
  return <>{children(steps.length ? liveTaskPercent(steps, current, p, taskStatus) : fallback, activity)}</>
}
