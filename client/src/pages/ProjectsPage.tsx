import { FolderKanban, Plus, Trash2, Users } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import {
  deleteProject,
  fetchProjectKnowledge,
  fetchProjectUsage,
  setActiveProject,
  setProjectTeam,
  updateProjectContext,
} from '../api/client'
import { groupAgentsByDepartment } from '../domain/groupAgents'
import type {
  KnowledgeItem,
  ProjectContext,
  UsageAggregation,
} from '../domain/types'
import { formatCost, formatTokens } from '../domain/usageUi'
import { userFacingTaskStatus } from '../domain/taskDisplay'
import { displayAgentDescription, displayAgentName } from '../i18n'
import { t } from '../i18n/ko'
import {
  selectVisibleProjects,
  useDeckStore,
} from '../store/useDeckStore'
import md from './MasterDetail.module.css'
import styles from './Pages.module.css'
import proj from './ProjectsPage.module.css'

const TYPE_LABEL: Record<string, string> = {
  'steam-game': t('projectType.steam-game'),
  'mobile-game': t('projectType.mobile-game'),
  'mobile-app': t('projectType.mobile-app'),
  'web-app': t('projectType.web-app'),
  saas: t('projectType.saas'),
  website: t('projectType.website'),
  custom: t('projectType.custom'),
}

type DetailTab = 'info' | 'team' | 'knowledge'

export function ProjectsPage() {
  const projects = useDeckStore(selectVisibleProjects)
  const activeProjectId = useDeckStore((s) => s.activeProjectId)
  const tasks = useDeckStore((s) => s.tasks)
  const registry = useDeckStore((s) => s.registry)
  const applyProjectsSnapshot = useDeckStore((s) => s.applyProjectsSnapshot)
  const openWizard = useDeckStore((s) => s.openWizard)
  const openManageTeam = useDeckStore((s) => s.openManageTeam)
  const setNav = useDeckStore((s) => s.setNav)
  const selectAgent = useDeckStore((s) => s.selectAgent)
  const selectKnowledge = useDeckStore((s) => s.selectKnowledge)
  const [selectedId, setSelectedId] = useState<string | null>(activeProjectId)
  const [tab, setTab] = useState<DetailTab>('info')
  const [busyId, setBusyId] = useState<string | null>(null)

  const selected =
    projects.find((p) => p.id === selectedId) ??
    projects.find((p) => p.id === activeProjectId) ??
    projects[0] ??
    null

  const [ctx, setCtx] = useState<ProjectContext>({})
  const [ctxBusy, setCtxBusy] = useState(false)
  const [ctxMsg, setCtxMsg] = useState<string | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [usage, setUsage] = useState<{
    totalTasks: number
    aggregation: UsageAggregation
  } | null>(null)
  const [knowledge, setKnowledge] = useState<KnowledgeItem[]>([])

  const teamAgents = useMemo(() => {
    if (!selected) return []
    const set = new Set(selected.agentIds)
    return registry.filter((a) => set.has(a.id))
  }, [selected, registry])

  const teamGroups = useMemo(
    () => groupAgentsByDepartment(teamAgents),
    [teamAgents],
  )

  useEffect(() => {
    if (!selectedId && activeProjectId) setSelectedId(activeProjectId)
  }, [activeProjectId, selectedId])

  useEffect(() => {
    setCtx(selected?.context ?? {})
    setCtxMsg(null)
    setTab('info')
  }, [selected?.id, selected?.context])

  useEffect(() => {
    if (!selected) {
      setUsage(null)
      setKnowledge([])
      return
    }
    let cancelled = false
    void fetchProjectUsage(selected.id)
      .then((res) => {
        if (!cancelled)
          setUsage({
            totalTasks: res.totalTasks,
            aggregation: res.aggregation,
          })
      })
      .catch(() => {
        if (!cancelled) setUsage(null)
      })
    void fetchProjectKnowledge(selected.id)
      .then((list) => {
        if (!cancelled) setKnowledge(list)
      })
      .catch(() => {
        if (!cancelled) setKnowledge([])
      })
    return () => {
      cancelled = true
    }
  }, [selected?.id, tasks.length])

  async function activate(id: string) {
    const snap = await setActiveProject(id)
    applyProjectsSnapshot(snap)
    setSelectedId(id)
  }

  async function saveContext() {
    if (!selected) return
    setCtxBusy(true)
    setCtxMsg(null)
    try {
      const snap = await updateProjectContext(selected.id, ctx)
      applyProjectsSnapshot(snap)
      setCtxMsg('저장됨')
    } catch (err) {
      setCtxMsg(err instanceof Error ? err.message : String(err))
    } finally {
      setCtxBusy(false)
    }
  }

  async function removeProject() {
    if (!selected || deleteBusy) return
    const ok = window.confirm(
      `「${selected.name}」\n\n${t('project.deleteConfirm')}`,
    )
    if (!ok) return
    setDeleteBusy(true)
    try {
      const snap = await deleteProject(selected.id)
      applyProjectsSnapshot(snap)
      setSelectedId(snap.activeProjectId)
    } catch (err) {
      window.alert(err instanceof Error ? err.message : String(err))
    } finally {
      setDeleteBusy(false)
    }
  }

  async function release(id: string) {
    if (!selected) return
    setBusyId(id)
    try {
      const snap = await setProjectTeam(
        selected.id,
        selected.agentIds.filter((x) => x !== id),
      )
      applyProjectsSnapshot(snap)
    } finally {
      setBusyId(null)
    }
  }

  const projectTasks = selected
    ? tasks.filter((t) => t.projectId === selected.id)
    : []
  const recentTasks = projectTasks
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 5)
  const isActive = selected?.id === activeProjectId

  return (
    <div className={md.split}>
      <div className={md.listPane}>
        <header className={md.head}>
          <h1>{t('nav.projects')}</h1>
          <p>팀·지식·컨텍스트를 프로젝트 단위로 관리합니다.</p>
          <button
            type="button"
            className={md.emptyBtn}
            style={{ marginTop: 10 }}
            onClick={openWizard}
          >
            <Plus size={14} style={{ verticalAlign: '-2px' }} />{' '}
            {t('project.new')}
          </button>
        </header>

        {projects.length === 0 ? (
          <div className={md.empty}>
            <FolderKanban size={28} />
            <h2>아직 프로젝트가 없습니다</h2>
            <p>새 프로젝트를 만들어 첫 AI 팀을 구성하세요.</p>
            <button type="button" className={md.emptyBtn} onClick={openWizard}>
              {t('project.create')}
            </button>
          </div>
        ) : (
          <ul className={md.list}>
            {projects.map((p) => {
              const taskCount = tasks.filter((t) => t.projectId === p.id).length
              const isSel = selected?.id === p.id
              const active = p.id === activeProjectId
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    className={isSel ? md.rowOn : md.row}
                    onClick={() => void activate(p.id)}
                  >
                    <strong>
                      {p.name}
                      {active ? (
                        <span className={proj.activeDot} aria-label="활성" />
                      ) : null}
                    </strong>
                    <span className={md.meta}>
                      {TYPE_LABEL[p.type] ?? p.type} ·{' '}
                      <Users size={11} style={{ verticalAlign: '-1px' }} />{' '}
                      {p.agentIds.length} · {taskCount}개 작업
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div className={md.detailPane}>
        {!selected ? (
          <div className={md.empty}>
            <p>프로젝트를 선택하면 상세가 여기에 표시됩니다.</p>
          </div>
        ) : (
          <div className={proj.detail}>
            <header className={proj.hero}>
              <div className={proj.heroWash} aria-hidden />
              <div className={proj.heroTop}>
                <div>
                  <p className={proj.kicker}>
                    {TYPE_LABEL[selected.type] ?? selected.type}
                    {isActive ? ' · 활성 프로젝트' : ''}
                  </p>
                  <h2>{selected.name}</h2>
                  <p className={proj.path}>
                    {selected.path || '경로 미설정'}
                  </p>
                </div>
                <button
                  type="button"
                  className={proj.teamBtn}
                  onClick={() => {
                    if (selected.id !== activeProjectId) {
                      void activate(selected.id)
                    }
                    openManageTeam()
                  }}
                >
                  <Users size={14} /> 팀 편집
                </button>
              </div>

              <div className={proj.metrics}>
                <div>
                  <span>팀</span>
                  <strong>{selected.agentIds.length}</strong>
                </div>
                <div>
                  <span>부서</span>
                  <strong>{teamGroups.length}</strong>
                </div>
                <div>
                  <span>작업</span>
                  <strong>{usage?.totalTasks ?? projectTasks.length}</strong>
                </div>
                <div>
                  <span>토큰</span>
                  <strong>
                    {usage
                      ? formatTokens(usage.aggregation.totalTokens)
                      : '—'}
                  </strong>
                </div>
                <div>
                  <span>예상 비용</span>
                  <strong>
                    {usage ? formatCost(usage.aggregation) : '—'}
                  </strong>
                </div>
              </div>
            </header>

            <nav className={proj.tabs} aria-label="프로젝트 섹션">
              <button
                type="button"
                className={tab === 'info' ? proj.tabOn : proj.tab}
                onClick={() => setTab('info')}
              >
                정보
              </button>
              <button
                type="button"
                className={tab === 'team' ? proj.tabOn : proj.tab}
                onClick={() => setTab('team')}
              >
                팀 · {selected.agentIds.length}
              </button>
              <button
                type="button"
                className={tab === 'knowledge' ? proj.tabOn : proj.tab}
                onClick={() => setTab('knowledge')}
              >
                지식 · {knowledge.length}
              </button>
            </nav>

            <div className={proj.body}>
              {tab === 'info' ? (
                <>
                  <section className={proj.section}>
                    <h3>최근 작업</h3>
                    {recentTasks.length === 0 ? (
                      <p className={styles.muted}>
                        아직 진행한 작업이 없습니다. 상단에서 할 일을 요청해
                        보세요.
                      </p>
                    ) : (
                      <ul className={proj.taskList}>
                        {recentTasks.map((task) => (
                          <li key={task.id}>
                            <button
                              type="button"
                              onClick={() => {
                                useDeckStore.getState().selectTask(task.id)
                                setNav('tasks')
                              }}
                            >
                              <strong>{task.title}</strong>
                              <span>
                                {userFacingTaskStatus(task)} · {task.progress}%
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>

                  <section className={proj.section}>
                    <h3>{t('project.context')}</h3>
                    <p className={proj.sectionHint}>
                      에이전트가 참고할 프로젝트 배경을 적어 두세요.
                    </p>
                    <div className={proj.contextGrid}>
                      <label>
                        {t('project.contextDesc')}
                        <textarea
                          value={ctx.description ?? ''}
                          onChange={(e) =>
                            setCtx((c) => ({
                              ...c,
                              description: e.target.value,
                            }))
                          }
                          rows={3}
                        />
                      </label>
                      <label>
                        {t('project.contextGoals')}
                        <textarea
                          value={ctx.goals ?? ''}
                          onChange={(e) =>
                            setCtx((c) => ({ ...c, goals: e.target.value }))
                          }
                          rows={3}
                        />
                      </label>
                      <label>
                        {t('project.contextConstraints')}
                        <textarea
                          value={ctx.constraints ?? ''}
                          onChange={(e) =>
                            setCtx((c) => ({
                              ...c,
                              constraints: e.target.value,
                            }))
                          }
                          rows={2}
                        />
                      </label>
                      <label>
                        {t('project.contextTech')}
                        <textarea
                          value={ctx.techStack ?? ''}
                          onChange={(e) =>
                            setCtx((c) => ({
                              ...c,
                              techStack: e.target.value,
                            }))
                          }
                          rows={2}
                        />
                      </label>
                    </div>
                    <div className={proj.ctxActions}>
                      <button
                        type="button"
                        className={styles.primary}
                        disabled={ctxBusy}
                        onClick={() => void saveContext()}
                      >
                        {t('project.contextSave')}
                      </button>
                      {ctxMsg ? (
                        <span className={styles.muted}>{ctxMsg}</span>
                      ) : null}
                    </div>
                  </section>

                  <section className={proj.dangerZone}>
                    <div>
                      <h3>위험 구역</h3>
                      <p>프로젝트와 연결된 작업·결과물·지식이 함께 삭제됩니다.</p>
                    </div>
                    <button
                      type="button"
                      className={styles.dangerGhost}
                      disabled={deleteBusy}
                      onClick={() => void removeProject()}
                    >
                      <Trash2 size={13} style={{ verticalAlign: '-2px' }} />{' '}
                      {t('project.delete')}
                    </button>
                  </section>
                </>
              ) : null}

              {tab === 'team' ? (
                <section className={proj.section}>
                  <div className={proj.teamHead}>
                    <div>
                      <h3>팀 구성</h3>
                      <p className={proj.sectionHint}>
                        부서별로 묶여 있습니다. 인원을 바꾸려면 팀 편집을
                        여세요.
                      </p>
                    </div>
                    <button
                      type="button"
                      className={proj.teamBtn}
                      onClick={() => {
                        if (selected.id !== activeProjectId) {
                          void activate(selected.id)
                        }
                        openManageTeam()
                      }}
                    >
                      <Users size={14} /> 팀 편집
                    </button>
                  </div>

                  {teamGroups.length === 0 ? (
                    <div className={proj.emptyTeam}>
                      <Users size={22} />
                      <p>아직 채용한 팀원이 없습니다.</p>
                      <button
                        type="button"
                        className={styles.primary}
                        onClick={() => {
                          if (selected.id !== activeProjectId) {
                            void activate(selected.id)
                          }
                          openManageTeam()
                        }}
                      >
                        팀원 채용하기
                      </button>
                    </div>
                  ) : (
                    <div className={proj.groups}>
                      {teamGroups.map((g) => (
                        <div key={g.division} className={proj.group}>
                          <header
                            className={proj.groupHead}
                            style={{ ['--dept' as string]: g.color }}
                          >
                            <span className={proj.groupDot} />
                            <strong>{g.label}</strong>
                            <em>{g.agents.length}명</em>
                          </header>
                          <ul className={proj.memberList}>
                            {g.agents.map((a) => (
                              <li key={a.id}>
                                <button
                                  type="button"
                                  className={proj.member}
                                  onClick={() => selectAgent(a.id)}
                                >
                                  <span
                                    className={proj.avatar}
                                    style={{
                                      background: `${g.color}22`,
                                      color: g.color,
                                    }}
                                  >
                                    {displayAgentName(a.id, a.name).slice(0, 1)}
                                  </span>
                                  <span className={proj.memberInfo}>
                                    <strong>
                                      {displayAgentName(a.id, a.name)}
                                    </strong>
                                    <span>
                                      {displayAgentDescription(
                                        a.id,
                                        a.name,
                                        a.description,
                                        g.label,
                                      )}
                                    </span>
                                  </span>
                                </button>
                                <button
                                  type="button"
                                  className={styles.releaseBtn}
                                  disabled={busyId === a.id}
                                  onClick={() => void release(a.id)}
                                >
                                  제외
                                </button>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              ) : null}

              {tab === 'knowledge' ? (
                <section className={proj.section}>
                  <h3>프로젝트 지식</h3>
                  {knowledge.length === 0 ? (
                    <p className={styles.muted}>
                      등록된 지식이 없습니다. 결과물에서 「프로젝트 지식으로
                      확정」하면 여기에 모입니다.
                    </p>
                  ) : (
                    <ul className={proj.taskList}>
                      {knowledge.map((k) => (
                        <li key={k.id}>
                          <button
                            type="button"
                            onClick={() => selectKnowledge(k.id)}
                          >
                            <strong>{k.title}</strong>
                            <span>
                              {k.status} · {k.content.slice(0, 80)}
                              {k.content.length > 80 ? '…' : ''}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
