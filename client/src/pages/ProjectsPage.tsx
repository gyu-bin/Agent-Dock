import { FolderKanban, Plus, Trash2, Users } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import {
  deleteProject,
  fetchProjectArtifacts,
  fetchProjectKnowledge,
  fetchProjectOperations,
  fetchProjectUsage,
  fetchMarketingCampaigns,
  createMarketingCampaign,
  approveMarketingCampaign,
  fetchPublishPreview,
  publishMarketingContent,
  publishToBuffer,
  fetchProjectDistribution,
  updateProjectDistribution,
  patchProjectRoutine,
  runProjectRoutine,
  setActiveProject,
  setProjectTeam,
  updateProjectContext,
  createProjectGoal,
  patchProjectGoal,
  fetchBufferStatus,
  fetchImageToolStatus,
  fetchProvider,
  fetchSettingsBoard,
} from '../api/client'
import { AiChatPanel } from '../panels/AiChatPanel'
import { resolveProjectToolPolicy } from '../domain/projectToolPolicy'
import { ARTIFACT_TYPE_LABEL } from '../domain/artifactUi'
import { groupAgentsByDepartment } from '../domain/groupAgents'
import {
  KNOWLEDGE_STATUS_FILTERS,
  KNOWLEDGE_STATUS_LABEL,
} from '../domain/knowledgeUi'
import type {
  Artifact,
  KnowledgeItem,
  KnowledgeStatus,
  ProjectContext,
  UsageAggregation,
} from '../domain/types'
import type { OperationsSnapshot } from '../domain/operations'
import type { MarketingCampaign } from '../domain/marketing'
import { formatCost, formatTokens } from '../domain/usageUi'
import { userFacingTaskStatus } from '../domain/taskDisplay'
import { displayAgentDescription, displayAgentName } from '../i18n'
import { t } from '../i18n/ko'
import { AgentDetailPanel } from '../panels/AgentDetailPanel'
import { KnowledgeDetailPanel } from '../panels/KnowledgeDetailPanel'
import {
  selectPendingApprovalCount,
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

type DetailTab =
  | 'overview'
  | 'work'
  | 'team'
  | 'tasks'
  | 'artifacts'
  | 'knowledge'
  | 'operations'
  | 'tools'
  | 'settings'

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
  const selectTask = useDeckStore((s) => s.selectTask)
  const selectArtifact = useDeckStore((s) => s.selectArtifact)
  const selectedAgentId = useDeckStore((s) => s.selectedAgentId)
  const selectedKnowledgeId = useDeckStore((s) => s.selectedKnowledgeId)
  const [selectedId, setSelectedId] = useState<string | null>(activeProjectId)
  const [tab, setTab] = useState<DetailTab>('overview')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [knowledgeFilter, setKnowledgeFilter] = useState<
    'all' | KnowledgeStatus
  >('all')
  const [artifacts, setArtifacts] = useState<Artifact[]>([])

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
  const createAndStartTask = useDeckStore((s) => s.createAndStartTask)
  const [knowledge, setKnowledge] = useState<KnowledgeItem[]>([])
  const [operations, setOperations] = useState<OperationsSnapshot | null>(null)
  const [opsBusy, setOpsBusy] = useState(false)
  const [campaigns, setCampaigns] = useState<MarketingCampaign[]>([])
  const [distributionProvider, setDistributionProvider] = useState<
    'manual' | 'buffer'
  >('manual')
  const pendingApprovals = useDeckStore(selectPendingApprovalCount)
  const aiProvider = useDeckStore((s) => s.aiProvider)
  const [toolRuntime, setToolRuntime] = useState<{
    openai: boolean
    codex: boolean
    webSearch: boolean
    image: boolean
    buffer: boolean
  }>({
    openai: false,
    codex: false,
    webSearch: false,
    image: false,
    buffer: false,
  })

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
    setTab('overview')
    selectAgent(null)
    selectKnowledge(null)
  }, [selected?.id, selected?.context, selectAgent, selectKnowledge])

  useEffect(() => {
    if (!selected) {
      setUsage(null)
      setKnowledge([])
      setArtifacts([])
      setOperations(null)
      setCampaigns([])
      setDistributionProvider('manual')
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
    void fetchProjectArtifacts(selected.id)
      .then((list) => {
        if (!cancelled) setArtifacts(list)
      })
      .catch(() => {
        if (!cancelled) setArtifacts([])
      })
    void fetchProjectOperations(selected.id)
      .then((board) => {
        if (!cancelled) setOperations(board)
      })
      .catch(() => {
        if (!cancelled) setOperations(null)
      })
    void fetchMarketingCampaigns(selected.id)
      .then((list) => {
        if (!cancelled) setCampaigns(list)
      })
      .catch(() => {
        if (!cancelled) setCampaigns([])
      })
    void fetchProjectDistribution(selected.id)
      .then((r) => {
        if (!cancelled) setDistributionProvider(r.distribution.provider)
      })
      .catch(() => {
        if (!cancelled) setDistributionProvider('manual')
      })
    void Promise.all([
      fetchProvider().catch(() => null),
      fetchImageToolStatus().catch(() => null),
      fetchBufferStatus().catch(() => null),
      fetchSettingsBoard().catch(() => null),
    ]).then(([prov, img, buf, board]) => {
      if (cancelled) return
      setToolRuntime({
        openai: Boolean(prov?.configured ?? aiProvider.configured),
        codex: Boolean(prov?.codex?.available ?? aiProvider.codex?.available),
        webSearch: Boolean(board?.runtime?.webSearch?.configured),
        image: Boolean(img?.available && img?.configured),
        buffer: Boolean(buf?.available),
      })
    })
    return () => {
      cancelled = true
    }
  }, [selected?.id, tasks.length, aiProvider.configured, aiProvider.codex?.available])

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
          <h1>Project Control Center</h1>
          <p>프로젝트를 열고 일을 시킵니다. 팀·목표·자동화·마케팅·도구를 한곳에서 관리합니다.</p>
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
                    {' · '}
                    {selected.status === 'active'
                      ? '진행 중'
                      : selected.status === 'planning'
                        ? '기획'
                        : selected.status === 'paused'
                          ? '일시정지'
                          : selected.status === 'completed'
                            ? '완료'
                            : selected.status}
                    {isActive ? ' · 활성' : ''}
                  </p>
                  <h2>{selected.name}</h2>
                  <p className={proj.path}>
                    Path: {selected.path || '미설정'}
                  </p>
                  <p className={proj.path}>
                    GitHub:{' '}
                    {selected.context?.githubUrl?.trim()
                      ? selected.context.githubUrl
                      : '미연결'}
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
              {(
                [
                  ['overview', '개요'],
                  ['work', '작업 요청'],
                  ['team', `팀 · ${selected.agentIds.length}`],
                  ['tasks', `작업 · ${projectTasks.length}`],
                  ['artifacts', `결과물 · ${artifacts.length}`],
                  ['knowledge', `지식 · ${knowledge.length}`],
                  [
                    'operations',
                    `운영 · ${(operations?.routines.length ?? 0) + (operations?.goals.length ?? 0)}`,
                  ],
                  ['tools', '도구'],
                  ['settings', '설정'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={tab === id ? proj.tabOn : proj.tab}
                  onClick={() => setTab(id)}
                >
                  {label}
                </button>
              ))}
            </nav>

            <div className={proj.body}>
              {tab === 'overview' ? (
                <>
                  <section className={proj.section}>
                    <h3>무엇을 시킬까요?</h3>
                    <p className={proj.sectionHint}>
                      자연어로 요청하면 Agent Deck이 Agent·Tool·Workflow를
                      자동 결정합니다. 첨부는 작업 요청 탭에서도 가능합니다.
                    </p>
                    {isActive ? (
                      <AiChatPanel embedded />
                    ) : (
                      <p className={styles.muted}>
                        활성 프로젝트로 전환하면 Work Composer를 사용할 수
                        있습니다.{' '}
                        <button
                          type="button"
                          className={proj.teamBtn}
                          onClick={() => void activate(selected.id)}
                        >
                          이 프로젝트 활성화
                        </button>
                      </p>
                    )}
                  </section>
                  <section className={proj.section}>
                    <h3>상태 요약</h3>
                    <ul className={proj.taskList}>
                      <li>
                        <strong>Task</strong>
                        <span>{projectTasks.length}건</span>
                      </li>
                      <li>
                        <strong>Approval</strong>
                        <span>
                          {pendingApprovals > 0
                            ? `${pendingApprovals}건 대기`
                            : '없음'}
                        </span>
                      </li>
                      <li>
                        <strong>Team</strong>
                        <span>
                          Core {selected.agentIds.length} · 부서{' '}
                          {teamGroups.length}
                        </span>
                      </li>
                      <li>
                        <strong>Artifact</strong>
                        <span>{artifacts.length}건</span>
                      </li>
                      <li>
                        <strong>Routine</strong>
                        <span>
                          {(operations?.routines ?? []).filter(
                            (r) => r.status === 'active',
                          ).length}
                          개 활성 / {(operations?.routines ?? []).length}개
                        </span>
                      </li>
                      <li>
                        <strong>Knowledge</strong>
                        <span>{knowledge.length}건</span>
                      </li>
                      <li>
                        <strong>Distribution</strong>
                        <span>
                          {distributionProvider === 'buffer'
                            ? 'Buffer'
                            : 'Manual'}
                        </span>
                      </li>
                    </ul>
                  </section>
                  <section className={proj.section}>
                    <h3>최근 작업</h3>
                    {recentTasks.length === 0 ? (
                      <p className={styles.muted}>
                        아직 진행한 작업이 없습니다.
                      </p>
                    ) : (
                      <ul className={proj.taskList}>
                        {recentTasks.map((task) => (
                          <li key={task.id}>
                            <button
                              type="button"
                              onClick={() => {
                                selectTask(task.id)
                                setTab('tasks')
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
                    <h3>최근 결과물</h3>
                    {artifacts.length === 0 ? (
                      <p className={styles.muted}>아직 결과물이 없습니다.</p>
                    ) : (
                      <ul className={proj.taskList}>
                        {artifacts.slice(0, 5).map((a) => (
                          <li key={a.id}>
                            <button
                              type="button"
                              onClick={() => {
                                selectArtifact(a.id)
                                setTab('artifacts')
                              }}
                            >
                              <strong>{a.title}</strong>
                              <span>
                                {ARTIFACT_TYPE_LABEL[a.type] ?? a.type} · v
                                {a.version}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                  <section className={proj.section}>
                    <h3>팀 요약</h3>
                    <p className={proj.sectionHint}>
                      Core Team {selected.agentIds.length}명 · Specialist는
                      작업 계획 시 자동 투입됩니다.
                    </p>
                    <button
                      type="button"
                      className={proj.teamBtn}
                      onClick={() => setTab('team')}
                    >
                      <Users size={14} /> 팀 탭으로
                    </button>
                  </section>
                </>
              ) : null}

              {tab === 'work' ? (
                <section className={proj.section}>
                  <h3>Work Composer</h3>
                  <p className={proj.sectionHint}>
                    Text / Image / File / Folder / GitHub / Web URL 첨부 지원.
                    활성 프로젝트에 자동 연결됩니다.
                  </p>
                  {isActive ? (
                    <AiChatPanel embedded />
                  ) : (
                    <p className={styles.muted}>
                      이 프로젝트를 활성화한 뒤 요청하세요.
                    </p>
                  )}
                </section>
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
                  {selectedAgentId ? (
                    <AgentDetailPanel embedded agentId={selectedAgentId} />
                  ) : null}
                </section>
              ) : null}

              {tab === 'tasks' ? (
                <section className={proj.section}>
                  <h3>프로젝트 작업</h3>
                  {projectTasks.length === 0 ? (
                    <p className={styles.muted}>
                      아직 작업이 없습니다.{' '}
                      <button
                        type="button"
                        className={styles.ghost}
                        onClick={() => setNav('home')}
                      >
                        홈에서 작업 요청
                      </button>
                    </p>
                  ) : (
                    <ul className={proj.taskList}>
                      {projectTasks
                        .slice()
                        .sort((a, b) =>
                          b.updatedAt.localeCompare(a.updatedAt),
                        )
                        .map((task) => (
                          <li key={task.id}>
                            <button
                              type="button"
                              onClick={() => {
                                selectTask(task.id)
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
              ) : null}

              {tab === 'artifacts' ? (
                <section className={proj.section}>
                  <h3>결과물</h3>
                  {artifacts.length === 0 ? (
                    <p className={styles.muted}>
                      완료된 작업의 결과물이 여기에 저장됩니다.
                    </p>
                  ) : (
                    <ul className={proj.taskList}>
                      {artifacts.map((a) => (
                        <li key={a.id}>
                          <button
                            type="button"
                            onClick={() => {
                              selectArtifact(a.id)
                              setNav('documents')
                            }}
                          >
                            <strong>{a.title}</strong>
                            <span>
                              {ARTIFACT_TYPE_LABEL[a.type] ?? a.type} · v
                              {a.version}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              ) : null}

              {tab === 'knowledge' ? (
                <section className={proj.section}>
                  <h3>프로젝트 지식</h3>
                  <div className={md.filters} style={{ padding: '0 0 12px', border: 0 }}>
                    {KNOWLEDGE_STATUS_FILTERS.map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        className={
                          knowledgeFilter === f.id ? md.filterOn : md.filter
                        }
                        onClick={() => setKnowledgeFilter(f.id)}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                  {knowledge.filter(
                    (k) =>
                      knowledgeFilter === 'all' ||
                      k.status === knowledgeFilter,
                  ).length === 0 ? (
                    <p className={styles.muted}>
                      등록된 지식이 없습니다. 결과물에서 「프로젝트 지식으로
                      확정」하면 여기에 모입니다.
                    </p>
                  ) : (
                    <ul className={proj.taskList}>
                      {knowledge
                        .filter(
                          (k) =>
                            knowledgeFilter === 'all' ||
                            k.status === knowledgeFilter,
                        )
                        .map((k) => (
                          <li key={k.id}>
                            <button
                              type="button"
                              onClick={() => selectKnowledge(k.id)}
                            >
                              <strong>{k.title}</strong>
                              <span>
                                {KNOWLEDGE_STATUS_LABEL[k.status]} ·{' '}
                                {k.content.slice(0, 80)}
                                {k.content.length > 80 ? '…' : ''}
                              </span>
                            </button>
                          </li>
                        ))}
                    </ul>
                  )}
                  {selectedKnowledgeId ? (
                    <KnowledgeDetailPanel embedded />
                  ) : null}
                </section>
              ) : null}

              {tab === 'operations' ? (
                <section className={proj.section}>
                  <h3>운영</h3>
                  <p className={proj.sectionHint}>
                    Goal → Routine → Marketing Campaign. SNS 실게시는 다음
                    Phase.
                  </p>
                  <h4 style={{ marginTop: 16 }}>Marketing Campaigns</h4>
                  <div
                    style={{
                      marginBottom: 8,
                      display: 'flex',
                      gap: 8,
                      flexWrap: 'wrap',
                      alignItems: 'center',
                    }}
                  >
                    <span className={styles.muted}>게시 방식</span>
                    <button
                      type="button"
                      className={proj.teamBtn}
                      disabled={opsBusy || !selected || distributionProvider === 'manual'}
                      onClick={() => {
                        if (!selected) return
                        setOpsBusy(true)
                        void updateProjectDistribution(selected.id, {
                          provider: 'manual',
                        })
                          .then((r) =>
                            setDistributionProvider(r.distribution.provider),
                          )
                          .finally(() => setOpsBusy(false))
                      }}
                    >
                      Manual{distributionProvider === 'manual' ? ' ✓' : ''}
                    </button>
                    <button
                      type="button"
                      className={proj.teamBtn}
                      disabled={opsBusy || !selected || distributionProvider === 'buffer'}
                      onClick={() => {
                        if (!selected) return
                        setOpsBusy(true)
                        void updateProjectDistribution(selected.id, {
                          provider: 'buffer',
                        })
                          .then((r) =>
                            setDistributionProvider(r.distribution.provider),
                          )
                          .finally(() => setOpsBusy(false))
                      }}
                    >
                      Buffer{distributionProvider === 'buffer' ? ' ✓' : ''}
                    </button>
                  </div>
                  <div style={{ marginBottom: 8 }}>
                    <button
                      type="button"
                      className={proj.teamBtn}
                      disabled={opsBusy || !selected}
                      onClick={() => {
                        if (!selected) return
                        setOpsBusy(true)
                        void createMarketingCampaign(selected.id, {
                          request: '이 앱 마케팅해줘.',
                          objective: 'awareness',
                          teamAgentIds: selected.agentIds,
                          allowWithoutSearch: true,
                          searchAvailable: false,
                          fixtureSources: [
                            {
                              id: 'src_ui_threads',
                              title: 'Threads short-form trends',
                              url: 'https://example.com/threads-trends',
                              domain: 'example.com',
                              snippet:
                                'Conversational threads posts and instagram reels for mobile apps; reddit communities discuss competitors',
                            },
                          ],
                        })
                          .then(() => fetchMarketingCampaigns(selected.id))
                          .then(setCampaigns)
                          .finally(() => setOpsBusy(false))
                      }}
                    >
                      마케팅 캠페인 실행
                    </button>
                  </div>
                  {campaigns.length === 0 ? (
                    <p className={styles.muted}>아직 Campaign이 없습니다.</p>
                  ) : (
                    <ul className={proj.taskList}>
                      {campaigns.slice(0, 6).map((c) => (
                        <li key={c.id}>
                          <strong>{c.title}</strong>
                          <span>
                            {c.status} ·{' '}
                            {c.channels
                              .filter((ch) => ch.enabled)
                              .map((ch) => ch.channel)
                              .join(', ') || 'no channels'}
                          </span>
                          <span>
                            contents {c.contentIds.length} · sources{' '}
                            {c.sourceIds.length}
                          </span>
                          {c.publishPackage?.unavailableActions?.length ? (
                            <span>
                              unavailable:{' '}
                              {c.publishPackage.unavailableActions
                                .map((u) => u.capability)
                                .join(', ')}
                            </span>
                          ) : null}
                          <span>
                            images:{' '}
                            {c.artifactIds?.filter((id) =>
                              id.startsWith('art_'),
                            ).length
                              ? `${c.artifactIds.length} artifact(s) · creative via content`
                              : '—'}
                          </span>
                          {c.status === 'awaiting_approval' ? (
                            <button
                              type="button"
                              className={proj.teamBtn}
                              disabled={opsBusy}
                              onClick={() => {
                                const ok = window.confirm(
                                  `게시 패키지를 승인할까요?\n\n캠페인: ${c.title}\n채널: ${c.channels
                                    .filter((ch) => ch.enabled)
                                    .map((ch) => ch.channel)
                                    .join(', ')}\n\n승인 후에도 실제 SNS 게시는 별도 Publish 단계입니다.`,
                                )
                                if (!ok) return
                                setOpsBusy(true)
                                void approveMarketingCampaign(c.id, {
                                  projectId: c.projectId,
                                })
                                  .then(() =>
                                    selected
                                      ? fetchMarketingCampaigns(selected.id)
                                      : [],
                                  )
                                  .then(setCampaigns)
                                  .finally(() => setOpsBusy(false))
                              }}
                            >
                              게시 패키지 승인
                            </button>
                          ) : null}
                          {c.status === 'approved' ||
                          c.status === 'partially_published' ? (
                            <button
                              type="button"
                              className={proj.teamBtn}
                              disabled={opsBusy}
                              onClick={() => {
                                const contentId = c.contentIds[0]
                                if (!contentId || !selected) return
                                setOpsBusy(true)
                                void fetchPublishPreview(contentId, selected.id)
                                  .then((preview) => {
                                    const ok = window.confirm(
                                      `Threads 게시를 진행할까요?\n\n계정: ${
                                        preview.account?.username
                                          ? `@${preview.account.username}`
                                          : preview.account?.connected
                                            ? '연결됨'
                                            : '미연결'
                                      }\n승인: ${preview.approvalStatus}\n\n본문:\n${preview.body.slice(0, 500)}`,
                                    )
                                    if (!ok) return null
                                    return publishMarketingContent(contentId, {
                                      projectId: selected.id,
                                      campaignId: c.id,
                                    })
                                  })
                                  .then(() =>
                                    fetchMarketingCampaigns(selected.id),
                                  )
                                  .then(setCampaigns)
                                  .catch((err) => {
                                    window.alert(
                                      err instanceof Error
                                        ? err.message
                                        : String(err),
                                    )
                                  })
                                  .finally(() => setOpsBusy(false))
                              }}
                            >
                              Threads 게시
                            </button>
                          ) : null}
                          {c.status === 'approved' ||
                          c.status === 'partially_published' ? (
                            <>
                              <button
                                type="button"
                                className={proj.teamBtn}
                                disabled={opsBusy}
                                onClick={() => {
                                  const contentId = c.contentIds[0]
                                  if (!contentId || !selected) return
                                  const ok = window.confirm(
                                    'Buffer 초안으로 보낼까요?\n승인된 콘텐츠만 전송됩니다.',
                                  )
                                  if (!ok) return
                                  setOpsBusy(true)
                                  void approveMarketingCampaign(c.id, {
                                    projectId: selected.id,
                                    publishMode: 'draft',
                                  })
                                    .then(() =>
                                      publishToBuffer({
                                        projectId: selected.id,
                                        contentId,
                                        campaignId: c.id,
                                        mode: 'draft',
                                      }),
                                    )
                                    .then((r) => {
                                      window.alert(
                                        `Buffer 초안 저장됨 · ${r.publishedPostStatus} · ${r.bufferPostId}`,
                                      )
                                      return fetchMarketingCampaigns(
                                        selected.id,
                                      )
                                    })
                                    .then(setCampaigns)
                                    .catch((err) => {
                                      window.alert(
                                        err instanceof Error
                                          ? err.message
                                          : String(err),
                                      )
                                    })
                                    .finally(() => setOpsBusy(false))
                                }}
                              >
                                Buffer 초안
                              </button>
                              <button
                                type="button"
                                className={proj.teamBtn}
                                disabled={opsBusy}
                                onClick={() => {
                                  const contentId = c.contentIds[0]
                                  if (!contentId || !selected) return
                                  const ok = window.confirm(
                                    'Buffer Queue에 넣을까요?\n즉시 SNS에 올라가지 않습니다.',
                                  )
                                  if (!ok) return
                                  setOpsBusy(true)
                                  void approveMarketingCampaign(c.id, {
                                    projectId: selected.id,
                                    publishMode: 'queue',
                                  })
                                    .then(() =>
                                      publishToBuffer({
                                        projectId: selected.id,
                                        contentId,
                                        campaignId: c.id,
                                        mode: 'queue',
                                      }),
                                    )
                                    .then((r) => {
                                      window.alert(
                                        `Buffer Queue · ${r.publishedPostStatus} · ${r.bufferPostId}`,
                                      )
                                      return fetchMarketingCampaigns(
                                        selected.id,
                                      )
                                    })
                                    .then(setCampaigns)
                                    .catch((err) => {
                                      window.alert(
                                        err instanceof Error
                                          ? err.message
                                          : String(err),
                                      )
                                    })
                                    .finally(() => setOpsBusy(false))
                                }}
                              >
                                Buffer Queue
                              </button>
                              <button
                                type="button"
                                className={proj.teamBtn}
                                disabled={opsBusy}
                                onClick={() => {
                                  const contentId = c.contentIds[0]
                                  if (!contentId || !selected) return
                                  const dueLocal = window.prompt(
                                    '예약 시각 (Asia/Seoul, YYYY-MM-DD HH:mm)',
                                  )
                                  if (!dueLocal) return
                                  const m = dueLocal
                                    .trim()
                                    .match(
                                      /^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})/,
                                    )
                                  if (!m) {
                                    window.alert('형식이 올바르지 않습니다.')
                                    return
                                  }
                                  // Convert via server ISO — client builds UTC approx then re-approve
                                  const dueAt = new Date(
                                    `${m[1]}T${m[2]}:00+09:00`,
                                  ).toISOString()
                                  const ok = window.confirm(
                                    `Buffer에 예약할까요?\n${dueLocal} (Seoul) → ${dueAt}`,
                                  )
                                  if (!ok) return
                                  setOpsBusy(true)
                                  void approveMarketingCampaign(c.id, {
                                    projectId: selected.id,
                                    publishMode: 'scheduled',
                                    dueAt,
                                  })
                                    .then(() =>
                                      publishToBuffer({
                                        projectId: selected.id,
                                        contentId,
                                        campaignId: c.id,
                                        mode: 'scheduled',
                                        dueAt,
                                      }),
                                    )
                                    .then((r) => {
                                      window.alert(
                                        `Buffer 예약 · ${r.publishedPostStatus} · due ${r.dueAt ?? dueAt}`,
                                      )
                                      return fetchMarketingCampaigns(
                                        selected.id,
                                      )
                                    })
                                    .then(setCampaigns)
                                    .catch((err) => {
                                      window.alert(
                                        err instanceof Error
                                          ? err.message
                                          : String(err),
                                      )
                                    })
                                    .finally(() => setOpsBusy(false))
                                }}
                              >
                                Buffer 예약
                              </button>
                            </>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                  <h4 style={{ marginTop: 16 }}>Marketing Package</h4>
                  <p className={proj.sectionHint}>
                    채널별 콘텐츠 · Copy / Artifact / Image / Buffer. 승인 후에만
                    외부 배포.
                  </p>
                  {campaigns.length === 0 ? (
                    <p className={styles.muted}>최근 캠페인이 없습니다.</p>
                  ) : (
                    <ul className={proj.taskList}>
                      {campaigns.slice(0, 3).map((c) => (
                        <li key={`pkg_${c.id}`}>
                          <strong>{c.title}</strong>
                          <span>
                            {(c.channels ?? [])
                              .filter((ch) => ch.enabled)
                              .map((ch) => ch.channel)
                              .join(', ') || 'channels n/a'}{' '}
                            · {c.status} · dist {distributionProvider}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <h4 style={{ marginTop: 16 }}>Goals</h4>
                  <div style={{ marginBottom: 8 }}>
                    <button
                      type="button"
                      className={proj.teamBtn}
                      disabled={opsBusy || !selected}
                      onClick={() => {
                        if (!selected) return
                        const title = window.prompt('Goal 제목')
                        if (!title?.trim()) return
                        setOpsBusy(true)
                        void createProjectGoal(selected.id, {
                          type: 'development',
                          title: title.trim(),
                        })
                          .then(() => fetchProjectOperations(selected.id))
                          .then(setOperations)
                          .finally(() => setOpsBusy(false))
                      }}
                    >
                      Goal 추가
                    </button>
                  </div>
                  {(operations?.goals.length ?? 0) === 0 ? (
                    <p className={styles.muted}>아직 Goal이 없습니다.</p>
                  ) : (
                    <ul className={proj.taskList}>
                      {operations!.goals.map((g) => (
                        <li key={g.id}>
                          <strong>{g.title}</strong>
                          <span>
                            {g.type} · {g.status}
                          </span>
                          <button
                            type="button"
                            className={proj.teamBtn}
                            disabled={opsBusy}
                            onClick={() => {
                              setOpsBusy(true)
                              void patchProjectGoal(g.id, {
                                status:
                                  g.status === 'paused' ? 'active' : 'paused',
                              })
                                .then(() =>
                                  fetchProjectOperations(selected!.id),
                                )
                                .then(setOperations)
                                .finally(() => setOpsBusy(false))
                            }}
                          >
                            {g.status === 'paused' ? '재개' : '일시정지'}
                          </button>
                          <button
                            type="button"
                            className={proj.teamBtn}
                            disabled={opsBusy || g.status === 'completed'}
                            onClick={() => {
                              setOpsBusy(true)
                              void patchProjectGoal(g.id, {
                                status: 'completed',
                              })
                                .then(() =>
                                  fetchProjectOperations(selected!.id),
                                )
                                .then(setOperations)
                                .finally(() => setOpsBusy(false))
                            }}
                          >
                            완료
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <h4 style={{ marginTop: 16 }}>Routines</h4>
                  {(operations?.routines.length ?? 0) === 0 ? (
                    <p className={styles.muted}>아직 Routine이 없습니다.</p>
                  ) : (
                    <ul className={proj.taskList}>
                      {operations!.routines.map((r) => (
                        <li key={r.id}>
                          <div
                            style={{
                              display: 'flex',
                              gap: 8,
                              flexWrap: 'wrap',
                              alignItems: 'center',
                            }}
                          >
                            <strong>{r.name}</strong>
                            <span>
                              {r.status} · {r.trigger}
                            </span>
                            {r.nextRunAt ? (
                              <span>
                                다음 실행{' '}
                                {new Date(r.nextRunAt).toLocaleString()}
                              </span>
                            ) : null}
                            {(() => {
                              const last = operations?.runs.find(
                                (run) => run.routineId === r.id,
                              )
                              return last ? (
                                <span>
                                  최근 {last.status}
                                  {last.triggerSource
                                    ? ` · ${last.triggerSource}`
                                    : ''}
                                </span>
                              ) : null
                            })()}
                            <button
                              type="button"
                              className={proj.teamBtn}
                              disabled={opsBusy}
                              onClick={() => {
                                if (!selected) return
                                setOpsBusy(true)
                                void patchProjectRoutine(r.id, {
                                  projectId: selected.id,
                                  status:
                                    r.status === 'paused' ? 'active' : 'paused',
                                })
                                  .then(() =>
                                    fetchProjectOperations(selected.id),
                                  )
                                  .then(setOperations)
                                  .finally(() => setOpsBusy(false))
                              }}
                            >
                              {r.status === 'paused' ? '재개' : '일시정지'}
                            </button>
                            <button
                              type="button"
                              className={proj.teamBtn}
                              disabled={opsBusy || r.status === 'archived'}
                              onClick={() => {
                                if (!selected) return
                                setOpsBusy(true)
                                void runProjectRoutine(r.id, {
                                  projectId: selected.id,
                                  teamAgentIds: selected.agentIds,
                                })
                                  .then((result) => {
                                    if (
                                      result.run.status === 'blocked' ||
                                      !result.taskSeed
                                    ) {
                                      return fetchProjectOperations(
                                        selected.id,
                                      ).then(setOperations)
                                    }
                                    const taskId = createAndStartTask({
                                      title: result.taskSeed.title,
                                      description: result.taskSeed.description,
                                      workflowTemplateId:
                                        result.taskSeed.workflowTemplateId,
                                      autoStart: false,
                                      source: {
                                        type: 'routine',
                                        routineId: r.id,
                                        routineRunId: result.run.id,
                                      },
                                    })
                                    return fetchProjectOperations(
                                      selected.id,
                                    ).then((board) => {
                                      setOperations(board)
                                      if (taskId) {
                                        selectTask(taskId)
                                      }
                                    })
                                  })
                                  .finally(() => setOpsBusy(false))
                              }}
                            >
                              수동 실행
                            </button>
                          </div>
                          {r.futureCapabilities &&
                          r.futureCapabilities.length > 0 ? (
                            <span>
                              future: {r.futureCapabilities.join(', ')}
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                  <h4 style={{ marginTop: 16 }}>최근 Routine Runs</h4>
                  {(operations?.runs.length ?? 0) === 0 ? (
                    <p className={styles.muted}>실행 기록이 없습니다.</p>
                  ) : (
                    <ul className={proj.taskList}>
                      {operations!.runs.slice(0, 8).map((run) => (
                        <li key={run.id}>
                          <strong>{run.status}</strong>
                          <span>
                            {run.summary ?? run.id}
                            {run.missingCapabilities?.length
                              ? ` · missing: ${run.missingCapabilities.join(', ')}`
                              : ''}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              ) : null}

              {tab === 'tools' ? (
                <section className={proj.section}>
                  <h3>프로젝트 도구</h3>
                  <p className={proj.sectionHint}>
                    Global Default ← Project Override. 실제 runtime
                    availability를 반영합니다. API Key는 표시하지 않습니다.
                  </p>
                  {(() => {
                    const resolved = resolveProjectToolPolicy({
                      global: toolRuntime,
                      project: selected.context?.toolPolicy,
                    })
                    const rows: Array<{
                      key: keyof typeof resolved
                      label: string
                    }> = [
                      { key: 'openai', label: 'OpenAI' },
                      { key: 'codex', label: 'Codex' },
                      { key: 'webSearch', label: 'Web Search' },
                      { key: 'image', label: 'Image' },
                      { key: 'buffer', label: 'Buffer' },
                    ]
                    return (
                      <ul className={proj.taskList}>
                        {rows.map((r) => (
                          <li key={r.key}>
                            <strong>{r.label}</strong>
                            <span>
                              {resolved[r.key].effective === 'enabled'
                                ? '● 사용 가능'
                                : '○ 사용 불가'}{' '}
                              · {resolved[r.key].source}
                              {!toolRuntime[r.key]
                                ? ' · Global unavailable'
                                : ''}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )
                  })()}
                  {!toolRuntime.buffer ? (
                    <p className={styles.muted} style={{ marginTop: 8 }}>
                      Buffer unavailable — Settings → SNS에서 BUFFER_API_KEY
                      연결을 확인하세요.
                    </p>
                  ) : null}
                  {!toolRuntime.image ? (
                    <p className={styles.muted}>
                      Image unavailable — OpenAI Image 설정을 확인하세요.
                    </p>
                  ) : null}
                  {!toolRuntime.openai ? (
                    <p className={styles.muted}>
                      Provider unavailable — OPENAI_API_KEY가 필요합니다.
                    </p>
                  ) : null}
                </section>
              ) : null}

              {tab === 'settings' ? (
                <>
                  <section className={proj.section}>
                    <h3>프로젝트 설정</h3>
                    <p className={proj.sectionHint}>
                      Path / GitHub / Tool Policy는 프로젝트 단위입니다. AI
                      Key·테마·Safety 기본값은 Global Settings에 있습니다.
                    </p>
                    <p className={proj.sectionHint}>
                      경로: {selected.path || '미설정'}
                    </p>
                    <h3 style={{ marginTop: 20 }}>{t('project.context')}</h3>
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
                        GitHub URL
                        <textarea
                          value={ctx.githubUrl ?? ''}
                          onChange={(e) =>
                            setCtx((c) => ({
                              ...c,
                              githubUrl: e.target.value,
                            }))
                          }
                          rows={1}
                          placeholder="https://github.com/org/repo"
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
                    <h4 style={{ marginTop: 16 }}>Tool Policy Override</h4>
                    <p className={proj.sectionHint}>
                      inherit = Global Default. Task Requirement가 가장
                      우선하지만 availability를 발명하지는 않습니다.
                    </p>
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 8,
                        marginBottom: 12,
                      }}
                    >
                      {(
                        [
                          'openai',
                          'codex',
                          'webSearch',
                          'image',
                          'buffer',
                        ] as const
                      ).map((key) => (
                        <label key={key} style={{ fontSize: 12 }}>
                          {key}{' '}
                          <select
                            value={ctx.toolPolicy?.[key] ?? 'inherit'}
                            onChange={(e) => {
                              const v = e.target.value as
                                | 'inherit'
                                | 'enabled'
                                | 'disabled'
                              setCtx((c) => ({
                                ...c,
                                toolPolicy: {
                                  ...c.toolPolicy,
                                  [key]: v,
                                },
                              }))
                            }}
                          >
                            <option value="inherit">inherit</option>
                            <option value="enabled">enabled</option>
                            <option value="disabled">disabled</option>
                          </select>
                        </label>
                      ))}
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
                      <p>
                        프로젝트와 연결된 작업·결과물·지식이 함께 삭제됩니다.
                      </p>
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
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
