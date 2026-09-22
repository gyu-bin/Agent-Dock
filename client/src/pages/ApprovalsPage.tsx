import { useEffect, useMemo } from 'react'
import { CheckCircle2, Clock } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { EmptyState } from '../components/EmptyState'
import { StatusBadge } from '../components/Status'
import {
  approvalKindLabel,
  formatWaitingDuration,
  userFacingWorkflowLabel,
} from '../domain/taskDisplay'
import { TaskDetailPanel } from '../panels/TaskDetailPanel'
import {
  selectPendingApprovals,
  useDeckStore,
} from '../store/useDeckStore'
import md from './MasterDetail.module.css'

export function ApprovalsPage() {
  const items = useDeckStore(useShallow(selectPendingApprovals))
  const projects = useDeckStore((s) => s.projects)
  const selectedTaskId = useDeckStore((s) => s.selectedTaskId)
  const selectTask = useDeckStore((s) => s.selectTask)

  const enriched = useMemo(
    () =>
      items.map((t) => ({
        task: t,
        projectName:
          projects.find((p) => p.id === t.projectId)?.name ?? '프로젝트',
        kind: approvalKindLabel(t.approval?.kind),
        waited: formatWaitingDuration(t.approval?.requestedAt ?? t.updatedAt),
      })),
    [items, projects],
  )

  useEffect(() => {
    if (enriched.length === 0) {
      if (selectedTaskId) selectTask(null)
      return
    }
    const still = enriched.some(({ task }) => task.id === selectedTaskId)
    if (!still) selectTask(enriched[0]!.task.id)
  }, [enriched, selectedTaskId, selectTask])

  return (
    <div className={md.split}>
      <div className={md.listPane}>
        <header className={md.head}>
          <h1>승인 대기</h1>
          <p>계획 · 코드 변경 승인을 여기서 바로 처리합니다.</p>
        </header>

        {enriched.length === 0 ? (
          <EmptyState
            icon={<CheckCircle2 size={20} strokeWidth={1.5} />}
            title="현재 승인할 작업이 없습니다"
            description="작업이 승인 단계에 도달하면 여기에 표시됩니다."
          />
        ) : (
          <ul className={md.list}>
            {enriched.map(({ task, projectName, kind, waited }) => (
              <li key={task.id}>
                <button
                  type="button"
                  className={
                    selectedTaskId === task.id ? md.rowOn : md.row
                  }
                  onClick={() => selectTask(task.id)}
                >
                  <StatusBadge tone="warning">{kind}</StatusBadge>
                  <strong>{task.title}</strong>
                  <span className={md.meta}>
                    {projectName} · {userFacingWorkflowLabel(task)} ·{' '}
                    <Clock size={11} style={{ verticalAlign: '-1px' }} />{' '}
                    {waited}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={md.detailPane}>
        {enriched.length === 0 ? (
          <EmptyState
            title="승인 항목을 선택하세요"
            description="무엇을 승인하는지, 왜 필요한지, 무엇이 바뀌는지 확인한 뒤 처리합니다."
          />
        ) : (
          <TaskDetailPanel embedded />
        )}
      </div>
    </div>
  )
}
