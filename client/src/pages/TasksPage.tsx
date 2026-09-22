import { useEffect, useMemo, useState } from 'react'
import { ListTodo } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { EmptyState } from '../components/EmptyState'
import { TaskStatus } from '../components/Status'
import {
  userFacingTaskStatus,
  userFacingWorkflowLabel,
} from '../domain/taskDisplay'
import type { Task } from '../domain/types'
import { TaskDetailPanel } from '../panels/TaskDetailPanel'
import {
  selectTasksForActive,
  useDeckStore,
} from '../store/useDeckStore'
import md from './MasterDetail.module.css'

type TaskFilter = 'all' | 'active' | 'approval' | 'done' | 'failed'

const FILTERS: Array<{ id: TaskFilter; label: string }> = [
  { id: 'all', label: '전체' },
  { id: 'active', label: '진행 중' },
  { id: 'approval', label: '승인 대기' },
  { id: 'done', label: '완료' },
  { id: 'failed', label: '실패' },
]

function matchesFilter(task: Task, filter: TaskFilter): boolean {
  if (filter === 'all') return true
  const s = task.status
  if (filter === 'approval') return s === 'awaiting_approval'
  if (filter === 'done') return s === 'completed'
  if (filter === 'failed') {
    return (
      s === 'failed' ||
      s === 'blocked' ||
      s === 'rejected' ||
      s === 'cancelled'
    )
  }
  return (
    s === 'queued' ||
    s === 'running' ||
    s === 'paused' ||
    s === 'verifying' ||
    s === 'review' ||
    s === 'interrupted'
  )
}

export function TasksPage() {
  const tasks = useDeckStore(useShallow(selectTasksForActive))
  const selectedTaskId = useDeckStore((s) => s.selectedTaskId)
  const selectTask = useDeckStore((s) => s.selectTask)
  const setNav = useDeckStore((s) => s.setNav)
  const pipelineSteps = useDeckStore((s) => s.pipelineSteps)
  const [filter, setFilter] = useState<TaskFilter>('all')

  const filtered = useMemo(
    () => tasks.filter((t) => matchesFilter(t, filter)),
    [tasks, filter],
  )

  useEffect(() => {
    if (filtered.length === 0) {
      if (selectedTaskId) selectTask(null)
      return
    }
    const still = filtered.some((t) => t.id === selectedTaskId)
    if (!still) selectTask(filtered[0]!.id)
  }, [filtered, selectedTaskId, selectTask])

  function statusFor(task: Task) {
    const steps = pipelineSteps
      .filter((st) => st.taskId === task.id)
      .sort((a, b) => a.order - b.order)
    const current =
      steps.find(
        (st) =>
          st.status === 'running' ||
          st.status === 'reviewing' ||
          st.status === 'awaiting_approval',
      ) ?? null
    return userFacingTaskStatus(task, current)
  }

  return (
    <div className={md.split}>
      <div className={md.listPane}>
        <header className={md.head}>
          <h1>작업</h1>
          <p>진행 · 승인 · 완료 · 실패를 한곳에서 관리합니다.</p>
        </header>

        <div className={md.filters}>
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={filter === f.id ? md.filterOn : md.filter}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            icon={<ListTodo size={20} strokeWidth={1.5} />}
            title="아직 작업이 없습니다"
            description="홈에서 작업을 요청하면 여기에 표시됩니다."
            actionLabel="홈에서 작업 요청"
            onAction={() => setNav('home')}
          />
        ) : (
          <ul className={md.list}>
            {filtered.map((task) => (
              <li key={task.id}>
                <button
                  type="button"
                  className={
                    selectedTaskId === task.id ? md.rowOn : md.row
                  }
                  onClick={() => selectTask(task.id)}
                >
                  <TaskStatus
                    status={task.status}
                    label={statusFor(task)}
                  />
                  <strong>{task.title}</strong>
                  <span className={md.meta}>
                    {userFacingWorkflowLabel(task)} ·{' '}
                    {new Date(task.updatedAt).toLocaleString('ko-KR', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={md.detailPane}>
        {filtered.length === 0 ? (
          <EmptyState
            title="작업을 선택하세요"
            description="왼쪽 목록에서 작업을 고르면 상세가 여기에 표시됩니다."
          />
        ) : (
          <TaskDetailPanel embedded />
        )}
      </div>
    </div>
  )
}
