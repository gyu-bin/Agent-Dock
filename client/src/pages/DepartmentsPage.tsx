import { useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { ArrowLeft, Users } from 'lucide-react'
import { setProjectTeam } from '../api/client'
import { DEPARTMENTS, getDepartment } from '../domain/departments'
import type { Agent } from '../domain/types'
import { displayAgentDescription, displayAgentName } from '../i18n'
import { t } from '../i18n/ko'
import {
  useDeckStore,
  selectActiveProject,
  selectTeamAgents,
} from '../store/useDeckStore'
import md from './MasterDetail.module.css'
import styles from './Pages.module.css'

export function DepartmentsPage() {
  const registry = useDeckStore((s) => s.registry)
  const selectedDepartment = useDeckStore((s) => s.selectedDepartment)
  const selectDepartment = useDeckStore((s) => s.selectDepartment)
  const selectAgent = useDeckStore((s) => s.selectAgent)
  const openManageTeam = useDeckStore((s) => s.openManageTeam)
  const applyProjectsSnapshot = useDeckStore((s) => s.applyProjectsSnapshot)
  const project = useDeckStore(selectActiveProject)
  const team = useDeckStore(useShallow(selectTeamAgents))
  const setNav = useDeckStore((s) => s.setNav)
  const [busyId, setBusyId] = useState<string | null>(null)

  const teamIds = useMemo(
    () => new Set(project?.agentIds ?? []),
    [project?.agentIds],
  )

  const stats = useMemo(() => {
    return DEPARTMENTS.map((d) => {
      const all = registry.filter((a) => a.division === d.id)
      const inProject = team.filter((a) => a.division === d.id)
      return {
        ...d,
        total: all.length,
        active: inProject.length,
        working: inProject.filter((a) => a.status === 'working').length,
        idle: inProject.filter(
          (a) => a.status === 'idle' || a.status === 'waiting',
        ).length,
      }
    }).filter((d) => d.total > 0 || d.priority)
  }, [registry, team])

  const selected =
    stats.find((d) => d.id === selectedDepartment) ?? stats[0] ?? null

  const { hired, available } = useMemo(() => {
    if (!selected) return { hired: [] as Agent[], available: [] as Agent[] }
    const inDept = registry.filter((a) => a.division === selected.id)
    const hiredList: Agent[] = []
    const availableList: Agent[] = []
    for (const a of inDept) {
      if (teamIds.has(a.id)) hiredList.push(a)
      else availableList.push(a)
    }
    return { hired: hiredList, available: availableList }
  }, [registry, selected, teamIds])

  async function hire(id: string) {
    if (!project || teamIds.has(id)) return
    setBusyId(id)
    try {
      const snap = await setProjectTeam(project.id, [...project.agentIds, id])
      applyProjectsSnapshot(snap)
    } finally {
      setBusyId(null)
    }
  }

  async function release(id: string) {
    if (!project || !teamIds.has(id)) return
    setBusyId(id)
    try {
      const snap = await setProjectTeam(
        project.id,
        project.agentIds.filter((x) => x !== id),
      )
      applyProjectsSnapshot(snap)
    } finally {
      setBusyId(null)
    }
  }

  function renderAgentRow(a: Agent, inTeam: boolean) {
    if (!selected) return null
    const label = displayAgentName(a.id, a.name)
    const koDesc = displayAgentDescription(
      a.id,
      a.name,
      a.description,
      getDepartment(selected.id).label,
    )
    return (
      <li key={a.id} className={styles.agentListItem}>
        <button
          type="button"
          className={styles.deptAgentRow}
          onClick={() => selectAgent(a.id)}
        >
          <span className={styles.agentInfo}>
            <strong>{label}</strong>
            {a.name !== label ? <em>{a.name}</em> : null}
            <span>{koDesc}</span>
          </span>
        </button>
        {project ? (
          inTeam ? (
            <div className={styles.hireActions}>
              <span className={styles.inTeamBadge}>팀 소속</span>
              <button
                type="button"
                className={styles.releaseBtn}
                disabled={busyId === a.id}
                onClick={() => void release(a.id)}
              >
                제외
              </button>
            </div>
          ) : (
            <button
              type="button"
              className={styles.hireBtn}
              disabled={busyId === a.id}
              onClick={() => void hire(a.id)}
            >
              채용
            </button>
          )
        ) : null}
      </li>
    )
  }

  return (
    <div className={md.split}>
      <div className={md.listPane}>
        <header className={md.head}>
          <button
            type="button"
            className={styles.ghost}
            style={{ marginBottom: 10 }}
            onClick={() => setNav('home')}
          >
            <ArrowLeft size={14} style={{ verticalAlign: '-2px' }} /> 오피스로
          </button>
          <h1>{t('nav.departments')}</h1>
          <p>
            {project
              ? `${project.name} 팀 · 부서별 에이전트`
              : '부서를 선택하면 소속 에이전트를 볼 수 있습니다.'}
          </p>
        </header>

        {stats.length === 0 ? (
          <div className={md.empty}>
            <Users size={28} />
            <h2>표시할 부서가 없습니다</h2>
            <p>에이전트 레지스트리를 불러오면 여기에 나타납니다.</p>
          </div>
        ) : (
          <ul className={md.list}>
            {stats.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  className={
                    selected?.id === d.id ? md.rowOn : md.row
                  }
                  onClick={() => selectDepartment(d.id)}
                  style={{ borderLeft: `3px solid ${d.color}` }}
                >
                  <strong>{d.label}</strong>
                  <span className={md.meta}>
                    팀 {d.active} · 전체 {d.total}
                    {d.working > 0 ? ` · 작업 중 ${d.working}` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={md.detailPane}>
        {!selected ? (
          <div className={md.empty}>
            <p>부서를 선택하면 상세가 여기에 표시됩니다.</p>
          </div>
        ) : (
          <div className={md.detailBody}>
            <h2>{getDepartment(selected.id).label}</h2>
            <div className={md.detailMeta}>
              <span className={md.chip}>팀 {selected.active}명</span>
              <span className={md.chip}>미배정 {available.length}명</span>
              <span className={md.chip}>전체 {selected.total}명</span>
              <span className={md.chip}>
                {t('status.working')} {selected.working}
              </span>
            </div>

            <div className={md.filters} style={{ padding: '0 0 16px', border: 0 }}>
              <button
                type="button"
                className={md.filter}
                onClick={() => openManageTeam()}
              >
                팀 관리
              </button>
              <button
                type="button"
                className={md.filter}
                onClick={() => setNav('home')}
              >
                오피스에서 보기
              </button>
            </div>

            {!project ? (
              <p className={styles.muted}>
                채용하려면 먼저 프로젝트를 선택하세요.
              </p>
            ) : null}

            <section className={styles.deptCategory}>
              <header className={styles.deptCategoryHead} data-kind="hired">
                <strong>팀 소속</strong>
                <em>{hired.length}명</em>
              </header>
              {hired.length === 0 ? (
                <p className={styles.deptCategoryEmpty}>
                  아직 이 부서에서 채용한 팀원이 없습니다.
                </p>
              ) : (
                <ul className={styles.agentTable}>
                  {hired.map((a) => renderAgentRow(a, true))}
                </ul>
              )}
            </section>

            <section className={styles.deptCategory}>
              <header className={styles.deptCategoryHead} data-kind="available">
                <strong>미배정 · 채용 가능</strong>
                <em>{available.length}명</em>
              </header>
              {available.length === 0 ? (
                <p className={styles.deptCategoryEmpty}>
                  이 부서 에이전트는 모두 팀에 있습니다.
                </p>
              ) : (
                <ul className={styles.agentTable}>
                  {available.slice(0, 60).map((a) => renderAgentRow(a, false))}
                </ul>
              )}
              {available.length > 60 ? (
                <p className={styles.moreNote}>
                  +{available.length - 60}명 더 — 고급에서 Agent Directory 열기
                </p>
              ) : null}
            </section>
          </div>
        )}
      </div>
    </div>
  )
}
