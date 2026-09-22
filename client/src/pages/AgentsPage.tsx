import { useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, Search } from 'lucide-react'
import type { DivisionId } from '../domain/types'
import { DEPARTMENTS, getDepartment } from '../domain/departments'
import { groupAgentsByDepartment } from '../domain/groupAgents'
import { setProjectTeam } from '../api/client'
import { displayAgentDescription, displayAgentName } from '../i18n'
import { t } from '../i18n/ko'
import {
  useDeckStore,
  selectActiveProject,
} from '../store/useDeckStore'
import styles from './Pages.module.css'

function statusLabel(status: string): string {
  const key = `status.${status}`
  const translated = t(key)
  return translated === key ? status : translated
}

export function AgentsPage() {
  const registry = useDeckStore((s) => s.registry)
  const project = useDeckStore(selectActiveProject)
  const applyProjectsSnapshot = useDeckStore((s) => s.applyProjectsSnapshot)
  const selectAgent = useDeckStore((s) => s.selectAgent)
  const agentRuntime = useDeckStore((s) => s.agentRuntime)

  const [query, setQuery] = useState('')
  const [division, setDivision] = useState<DivisionId | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'team' | 'idle'>('all')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())

  const team = useMemo(() => new Set(project?.agentIds ?? []), [project])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return registry.filter((a) => {
      if (division !== 'all' && a.division !== division) return false
      if (statusFilter === 'team' && !team.has(a.id)) return false
      if (statusFilter === 'idle' && team.has(a.id)) return false
      if (!q) return true
      const label = displayAgentName(a.id, a.name).toLowerCase()
      return (
        label.includes(q) ||
        a.name.toLowerCase().includes(q) ||
        a.id.includes(q) ||
        a.description.toLowerCase().includes(q)
      )
    })
  }, [registry, query, division, statusFilter, team])

  const groups = useMemo(
    () => groupAgentsByDepartment(filtered),
    [filtered],
  )

  async function addToTeam(id: string) {
    if (!project || team.has(id)) return
    setBusyId(id)
    try {
      const snap = await setProjectTeam(project.id, [...project.agentIds, id])
      applyProjectsSnapshot(snap)
    } finally {
      setBusyId(null)
    }
  }

  async function removeFromTeam(id: string) {
    if (!project || !team.has(id)) return
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

  function toggleGroup(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className={styles.page}>
      <header className={styles.pageHead}>
        <div>
          <h1>{t('nav.agents')}</h1>
          <p>
            레지스트리 {registry.length}명 · 표시 {filtered.length}명 · 부서{' '}
            {groups.length}개
          </p>
        </div>
      </header>

      <div className={styles.filters}>
        <label className={styles.search}>
          <Search size={14} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="검색…"
          />
        </label>
        <select
          value={division}
          onChange={(e) =>
            setDivision(e.target.value as DivisionId | 'all')
          }
        >
          <option value="all">모든 부서</option>
          {DEPARTMENTS.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) =>
            setStatusFilter(e.target.value as typeof statusFilter)
          }
        >
          <option value="all">전체</option>
          <option value="team">현재 프로젝트</option>
          <option value="idle">미배정</option>
        </select>
      </div>

      <div className={styles.agentGroups}>
        {groups.map((g) => {
          const isCollapsed = collapsed.has(g.division)
          const inTeamCount = g.agents.filter((a) => team.has(a.id)).length
          return (
            <section key={g.division} className={styles.agentGroup}>
              <button
                type="button"
                className={styles.agentGroupHead}
                style={{ ['--dept' as string]: g.color }}
                onClick={() => toggleGroup(g.division)}
                aria-expanded={!isCollapsed}
              >
                <span className={styles.agentGroupDot} />
                <strong>{g.label}</strong>
                <em>
                  {g.agents.length}명
                  {inTeamCount > 0 ? ` · 팀 ${inTeamCount}` : ''}
                </em>
                {isCollapsed ? (
                  <ChevronDown size={14} />
                ) : (
                  <ChevronUp size={14} />
                )}
              </button>

              {!isCollapsed ? (
                <ul className={styles.agentTable}>
                  {g.agents.map((a) => {
                    const dept = getDepartment(a.division)
                    const inTeam = team.has(a.id)
                    const status =
                      agentRuntime[a.id]?.status ??
                      (inTeam ? 'idle' : 'offline')
                    return (
                      <li key={a.id}>
                        <button
                          type="button"
                          className={styles.agentRow}
                          onClick={() => selectAgent(a.id)}
                        >
                          <span
                            className={styles.avatar}
                            style={{
                              background: `${dept.color}22`,
                              color: dept.color,
                            }}
                          >
                            {displayAgentName(a.id, a.name).slice(0, 1)}
                          </span>
                          <span className={styles.agentInfo}>
                            <strong>
                              {displayAgentName(a.id, a.name)}
                            </strong>
                            <span>
                              {displayAgentDescription(
                                a.id,
                                a.name,
                                a.description,
                                dept.label,
                              )}
                            </span>
                          </span>
                          <span
                            className={styles.statusPill}
                            data-status={status}
                          >
                            {inTeam ? statusLabel(status) : '미배정'}
                          </span>
                        </button>
                        {project ? (
                          inTeam ? (
                            <div className={styles.hireActions}>
                              <span className={styles.inTeamBadge}>
                                팀 소속
                              </span>
                              <button
                                type="button"
                                className={styles.releaseBtn}
                                disabled={busyId === a.id}
                                onClick={() => void removeFromTeam(a.id)}
                              >
                                제외
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              className={styles.hireBtn}
                              disabled={busyId === a.id}
                              onClick={() => void addToTeam(a.id)}
                            >
                              채용
                            </button>
                          )
                        ) : null}
                      </li>
                    )
                  })}
                </ul>
              ) : null}
            </section>
          )
        })}
      </div>
    </div>
  )
}
