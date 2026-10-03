import { create } from 'zustand'
import { SEED_AI_PROVIDER, SEED_CHAT, SEED_USER } from '../data/seed'
import { MOCK_REGISTRY, MOCK_REGISTRY_COUNT } from '../data/mockRegistry'
import { isFixtureProjectName } from '../domain/demoData'
import type {
  Agent,
  AgentRun,
  AiProviderState,
  ChatMessage,
  CodexRun,
  DivisionId,
  ExecutionMode,
  PipelineStep,
  Project,
  RoutePlan,
  Task,
  TaskPriority,
  WeeklyGoal,
} from '../domain/types'
import {
  defaultRuntimeForNewTeam,
  mergeTeamAgents,
  type AgentRuntime,
} from '../domain/teamRuntime'
import type { ProjectsSnapshot } from '../api/client'
import { pickDefaultCrew } from '../office/pixel/defaultCrew'
import {
  createProject as createProjectApi,
  deleteTask as deleteTaskApi,
  fetchProjects,
  rollbackCodexSnapshot,
  saveWorkState,
  fetchProjectArtifacts,
  createArtifact,
  acquireExecutionLock,
  releaseExecutionLock,
  getExecutionLockState,
  setWorkStateRevision,
  bindAttachmentsToTask,
} from '../api/client'
import { persistCodexArtifact } from '../domain/artifactActions'
import { deckEvents } from '../domain/events'
import {
  planTask,
  materializeTaskFromPlan,
  planFingerprint,
} from '../domain/taskPlanning'
import { getTemplateById } from '../domain/workflowTemplates'
import { createMockExecutionEngine } from '../engine/mockExecutionEngine'
import { createRealAIExecutionEngine } from '../engine/realAiExecutionEngine'
import { taskProgress, type ExecutionEngine } from '../engine/types'

export type NavId =
  | 'home'
  | 'projects'
  | 'agents'
  | 'departments'
  | 'tasks'
  | 'documents'
  | 'knowledge'
  | 'usage'
  | 'approvals'
  | 'settings'

export type ThemeMode = 'light' | 'dark'

const THEME_KEY = 'agent-deck-theme'

function readStoredTheme(): ThemeMode {
  try {
    const v = localStorage.getItem(THEME_KEY)
    if (v === 'light' || v === 'dark') return v
  } catch {
    /* ignore */
  }
  return 'dark'
}

function applyThemeAttr(theme: ThemeMode) {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', theme)
  }
}

interface DeckState {
  projects: Project[]
  activeProjectId: string | null
  tasks: Task[]
  pipelineSteps: PipelineStep[]
  agentRuns: AgentRun[]
  codexRuns: CodexRun[]
  goals: WeeklyGoal[]
  chat: ChatMessage[]
  registry: Agent[]
  registryTotal: number
  registrySource: 'mock' | 'filesystem' | 'bundled'
  agentRuntime: Record<string, AgentRuntime>
  aiProvider: AiProviderState
  executionMode: ExecutionMode
  /** Developer Settings only — required before MOCK mode can be selected. */
  developerAllowMock: boolean
  theme: ThemeMode
  user: typeof SEED_USER
  hydrated: boolean
  executionSpeed: 1 | 2 | 4

  activeNav: NavId
  chatTab: 'chat' | 'history'
  selectedAgentId: string | null
  selectedDepartment: DivisionId | null
  selectedTaskId: string | null
  selectedArtifactId: string | null
  selectedKnowledgeId: string | null
  selectedExecutionId: string | null
  wizardOpen: boolean
  manageTeamOpen: boolean
  workRequestOpen: boolean

  setNav: (nav: NavId) => void
  setChatTab: (tab: 'chat' | 'history') => void
  setTheme: (theme: ThemeMode) => void
  toggleTheme: () => void
  selectAgent: (id: string | null) => void
  selectDepartment: (id: DivisionId | null) => void
  selectTask: (id: string | null) => void
  selectArtifact: (id: string | null) => void
  selectKnowledge: (id: string | null) => void
  selectExecution: (id: string | null) => void
  openWizard: () => void
  closeWizard: () => void
  openManageTeam: () => void
  closeManageTeam: () => void
  openWorkRequest: () => void
  closeWorkRequest: () => void
  setExecutionSpeed: (speed: 1 | 2 | 4) => void
  setExecutionMode: (mode: ExecutionMode) => void
  setDeveloperAllowMock: (allowed: boolean) => void
  setAiProvider: (state: AiProviderState) => void

  hydrateRegistry: (payload: {
    agents: Agent[]
    source: 'mock' | 'filesystem' | 'bundled'
    total: number
  }) => void
  applyProjectsSnapshot: (snap: ProjectsSnapshot) => void
  /** Boot-only: mark running tasks whose owning tab is gone (no live lock) as interrupted. */
  recoverAbandonedRuns: () => Promise<number>
  /** Delete a finished task; an in-flight task is cancelled first. */
  deleteTask: (taskId: string) => Promise<void>
  setAgentRuntime: (agentId: string, patch: AgentRuntime) => void
  upsertAgentRun: (run: AgentRun) => void
  upsertCodexRun: (run: CodexRun) => void

  proposeWorkFromChat: (
    text: string,
    opts?: { attachmentIds?: string[]; attachmentStagingId?: string; skipUserLine?: boolean },
  ) => void
  appendChat: (msg: Omit<ChatMessage, 'id' | 'createdAt'> & { id?: string }) => void
  createAndStartTask: (input: {
    title: string
    description?: string
    priority?: TaskPriority
    preferredAgentId?: string
    simulateFailure?: boolean
    autoStart?: boolean
    routePlan?: RoutePlan
    executionMode?: ExecutionMode
    workflowTemplateId?: string
    /** Must match proposeWorkFromChat plan when provided */
    planFingerprint?: string
    source?: import('../domain/operations').TaskSource
    attachmentIds?: string[]
    attachmentStagingId?: string
    /** A chat proposal can create only one task during this app session. */
    proposalMessageId?: string
  }) => string | null
  startTask: (taskId: string) => void
  pauseTask: (taskId: string) => void
  resumeTask: (taskId: string) => void
  cancelTask: (taskId: string) => void
  retryTask: (taskId: string) => void
  /** Retry only the failed step; keep completed artifacts/steps */
  retryFailedStep: (taskId: string) => void
  /** Re-queue from the step before the failed one */
  retryFromPreviousStep: (taskId: string) => void
  markSimulateFailure: (taskId: string) => void
  /** W1 search failure choices */
  retryWebSearch: (taskId: string) => void
  continueWithoutWebSearch: (taskId: string) => void
  approveTaskChanges: (taskId: string) => Promise<void>
  rejectTaskChanges: (taskId: string) => Promise<void>
  requestTaskChanges: (taskId: string, feedback: string) => Promise<void>
}

function createDeckStore() {
  let persistTimer: ReturnType<typeof setTimeout> | null = null
  let eventsWired = false
  const proposalTasks = new Map<string, string>()
  const pendingStarts = new Map<string, symbol>()

  const store = create<DeckState>((set, get) => {
    // Saves are serialized: overlapping PUTs would carry the same expectedRevision
    // and the later one would 409, silently dropping a state transition.
    let saving: Promise<void> | null = null
    let dirty = false
    const persist = (): Promise<void> => {
      if (saving) {
        dirty = true
        return saving
      }
      saving = (async () => {
        do {
          dirty = false
          const { tasks, pipelineSteps, agentRuns, codexRuns } = get()
          try {
            await saveWorkState({ tasks, pipelineSteps, agentRuns, codexRuns })
          } catch (err) {
            console.error('[persist]', err)
            if ((err as { code?: string }).code === 'PERSISTENCE_CONFLICT') {
              // Another writer bumped the revision: pick up the latest revision and retry once.
              try {
                await fetchProjects()
                const latest = get()
                await saveWorkState({ tasks: latest.tasks, pipelineSteps: latest.pipelineSteps, agentRuns: latest.agentRuns, codexRuns: latest.codexRuns })
              } catch (retryErr) {
                console.error('[persist] retry failed', retryErr)
              }
            }
          }
        } while (dirty)
      })().finally(() => {
        saving = null
      })
      return saving
    }

    const persistSoon = () => {
      if (persistTimer) clearTimeout(persistTimer)
      persistTimer = setTimeout(() => void persist(), 400)
    }

    /** Critical transitions (step/task start, complete, fail, cancel) are saved immediately. */
    const persistNow = () => {
      if (persistTimer) clearTimeout(persistTimer)
      persistTimer = null
      return persist()
    }

    const storeAccess = () => ({
      getTasks: () => get().tasks,
      getSteps: () => get().pipelineSteps,
      getAgentRuntime: () => get().agentRuntime,
      getAgentRuns: () => get().agentRuns,
      getCodexRuns: () => get().codexRuns,
      getProjects: () => get().projects,
      getActiveProjectId: () => get().activeProjectId,
      getRegistry: () => get().registry,
      patchTask: (taskId: string, patch: Partial<Task>) =>
        set((s) => ({
          tasks: s.tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t)),
        })),
      patchStep: (stepId: string, patch: Partial<PipelineStep>) =>
        set((s) => ({
          pipelineSteps: s.pipelineSteps.map((st) =>
            st.id === stepId ? { ...st, ...patch } : st,
          ),
        })),
      setAgentRuntime: (agentId: string, patch: AgentRuntime) =>
        set((s) => ({
          agentRuntime: {
            ...s.agentRuntime,
            [agentId]: { ...s.agentRuntime[agentId], ...patch },
          },
        })),
      upsertAgentRun: (run: AgentRun) => get().upsertAgentRun(run),
      upsertCodexRun: (run: CodexRun) => get().upsertCodexRun(run),
      replaceStepsForTask: (taskId: string, steps: PipelineStep[]) =>
        set((s) => ({
          pipelineSteps: [
            ...s.pipelineSteps.filter((st) => st.taskId !== taskId),
            ...steps,
          ],
        })),
      persistSoon,
    })

    const CLIENT_ID =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `tab_${Date.now().toString(36)}`

    // Execution ownership: this tab runs the task and proves it is alive by
    // refreshing the server lock every 10s; on any terminal transition it releases it.
    const heartbeats = new Map<string, ReturnType<typeof setInterval>>()
    const startHeartbeat = (projectId: string, taskId: string) => {
      const prev = heartbeats.get(taskId)
      if (prev) clearInterval(prev)
      heartbeats.set(
        taskId,
        setInterval(() => {
          void acquireExecutionLock({ projectId, taskId, clientId: CLIENT_ID }).catch(() => undefined)
        }, 10_000),
      )
    }
    const stopHeartbeat = (taskId: string) => {
      const timer = heartbeats.get(taskId)
      if (timer) clearInterval(timer)
      heartbeats.delete(taskId)
      const task = get().tasks.find((t) => t.id === taskId)
      if (task) void releaseExecutionLock({ projectId: task.projectId, clientId: CLIENT_ID, taskId })
    }

    const engines: Partial<Record<ExecutionMode, ExecutionEngine>> = {}

    const ensureEngineForTask = (taskId: string) => {
      const task = get().tasks.find((t) => t.id === taskId)
      const mode: ExecutionMode =
        task?.executionMode ?? get().executionMode
      let eng = engines[mode]
      if (!eng) {
        const access = storeAccess()
        eng =
          mode === 'REAL_AI'
            ? createRealAIExecutionEngine(access)
            : createMockExecutionEngine(access)
        engines[mode] = eng
        if (mode === 'MOCK') eng.setSpeed(get().executionSpeed)
      }
      return eng
    }

    /** @deprecated use ensureEngineForTask — kept for speed setting */
    const ensureEngine = () => {
      const mode = get().executionMode
      let eng = engines[mode]
      if (!eng) {
        const access = storeAccess()
        eng =
          mode === 'REAL_AI'
            ? createRealAIExecutionEngine(access)
            : createMockExecutionEngine(access)
        engines[mode] = eng
        if (mode === 'MOCK') eng.setSpeed(get().executionSpeed)
      }
      return eng
    }

    // Flush pending work-state on page hide / unload
    if (typeof window !== 'undefined' && !(window as unknown as { __adFlush?: boolean }).__adFlush) {
      ;(window as unknown as { __adFlush?: boolean }).__adFlush = true
      const flush = () => {
        const s = get()
        void saveWorkState({
          tasks: s.tasks,
          pipelineSteps: s.pipelineSteps,
          agentRuns: s.agentRuns,
          codexRuns: s.codexRuns,
        }).catch(() => undefined)
      }
      window.addEventListener('pagehide', flush)
      window.addEventListener('beforeunload', flush)
    }

    if (!eventsWired) {
      eventsWired = true
      deckEvents.subscribe((ev) => {
        if (ev.type === 'task.completed' || ev.type === 'task.failed' || ev.type === 'task.cancelled' || ev.type === 'task.paused') {
          stopHeartbeat(ev.taskId)
        }
        if (ev.type.startsWith('task.') || ev.type.startsWith('pipeline.step.')) {
          void persistNow()
        }
        if (ev.type === 'task.completed') {
          const task = get().tasks.find((t) => t.id === ev.taskId)
          if (!task?.finalResult && task?.executionMode !== 'REAL_AI') return
          if (task?.finalResult) {
            void (async () => {
              let artifactLines = ''
              try {
                if (task.executionMode !== 'REAL_AI') {
                  await createArtifact(task.projectId, {
                    type: 'report',
                    title: `${task.title} — 결과`,
                    content: task.finalResult!,
                    taskId: task.id,
                    status: 'final',
                  })
                }
                const arts = await fetchProjectArtifacts(task.projectId, {
                  taskId: task.id,
                })
                if (arts.length) {
                  artifactLines =
                    '\n\n생성된 결과물:\n' +
                    arts
                      .slice(0, 8)
                      .map((a) => `- ${a.title} (v${a.version})`)
                      .join('\n')
                }
              } catch {
                // ignore
              }
              get().appendChat({
                role: 'assistant',
                content: `작업 완료\n\n요약:\n${task.finalResult.slice(0, 400)}${
                  task.finalResult.length > 400 ? '…' : ''
                }${artifactLines}`,
                taskResult: {
                  taskId: task.id,
                  title: task.title,
                  summary: task.finalResult.slice(0, 280),
                },
              })
            })()
          }
        }
        if (ev.type === 'task.failed') {
          const task = get().tasks.find((t) => t.id === ev.taskId)
          if (task?.executionMode === 'REAL_AI') {
            get().appendChat({
              role: 'assistant',
              content:
                '작업을 이어가지 못했습니다.\n\n다시 시도하거나 작업 상세에서 확인해 주세요.',
            })
          }
        }
      })
    }

    return {
      projects: [],
      activeProjectId: null,
      tasks: [],
      pipelineSteps: [],
      agentRuns: [],
      codexRuns: [],
      goals: [],
      chat: SEED_CHAT,
      registry: MOCK_REGISTRY,
      registryTotal: MOCK_REGISTRY_COUNT,
      registrySource: 'mock',
      agentRuntime: {},
      aiProvider: SEED_AI_PROVIDER,
      executionMode: 'REAL_AI',
      developerAllowMock: false,
      theme: readStoredTheme(),
      user: SEED_USER,
      hydrated: false,
      executionSpeed: 1,

      activeNav: 'home',
      chatTab: 'chat',
      selectedAgentId: null,
      selectedDepartment: null,
      selectedTaskId: null,
      selectedArtifactId: null,
      selectedKnowledgeId: null,
      selectedExecutionId: null,
      wizardOpen: false,
      manageTeamOpen: false,
      workRequestOpen: false,

      setNav: (nav) => set({ activeNav: nav }),
      setChatTab: (tab) => set({ chatTab: tab }),
      setTheme: (theme) => {
        try {
          localStorage.setItem(THEME_KEY, theme)
        } catch {
          /* ignore */
        }
        applyThemeAttr(theme)
        set({ theme })
      },
      toggleTheme: () => {
        const next: ThemeMode = get().theme === 'dark' ? 'light' : 'dark'
        get().setTheme(next)
      },
      selectAgent: (id) => set({ selectedAgentId: id }),
      selectDepartment: (id) => set({ selectedDepartment: id }),
      selectTask: (id) => set({ selectedTaskId: id }),
      selectArtifact: (id) => set({ selectedArtifactId: id }),
      selectKnowledge: (id) => set({ selectedKnowledgeId: id }),
      selectExecution: (id) => set({ selectedExecutionId: id }),
      openWizard: () => set({ wizardOpen: true }),
      closeWizard: () => set({ wizardOpen: false }),
      openManageTeam: () => set({ manageTeamOpen: true }),
      closeManageTeam: () => set({ manageTeamOpen: false }),
      openWorkRequest: () => set({ workRequestOpen: true }),
      closeWorkRequest: () => set({ workRequestOpen: false }),
      setExecutionSpeed: (speed) => {
        set({ executionSpeed: speed })
        if (get().executionMode === 'MOCK') ensureEngine().setSpeed(speed)
      },
      setDeveloperAllowMock: (allowed) => {
        set({
          developerAllowMock: allowed,
          ...(allowed
            ? {}
            : { executionMode: 'REAL_AI' as ExecutionMode }),
        })
      },
      setExecutionMode: (mode) => {
        if (mode === 'MOCK' && !get().developerAllowMock) return
        if (mode === 'REAL_AI' && !get().aiProvider.configured) {
          // Still allow selecting REAL as default policy; runs are gated at start
        }
        set({ executionMode: mode })
      },
      setAiProvider: (aiProvider) => set({ aiProvider }),

      hydrateRegistry: ({ agents, source, total }) =>
        set({ registry: agents, registrySource: source, registryTotal: total }),

      applyProjectsSnapshot: (snap) =>
        set((state) => {
          if (typeof snap.revision === 'number') {
            setWorkStateRevision(snap.revision)
          }
          const active =
            snap.projects.find((p) => p.id === snap.activeProjectId) ?? null
          const switched = state.activeProjectId !== snap.activeProjectId
          let nextRuntime = state.agentRuntime
          if (!active) {
            nextRuntime = {}
          } else if (switched || Object.keys(state.agentRuntime).length === 0) {
            nextRuntime = defaultRuntimeForNewTeam(active.agentIds)
          } else {
            const keep: typeof state.agentRuntime = {}
            for (const id of active.agentIds) {
              keep[id] = state.agentRuntime[id] ?? { status: 'idle' }
            }
            // Keep specialists outside the team while they still hold a task.
            for (const [id, r] of Object.entries(state.agentRuntime)) {
              if (!keep[id] && r && (r.currentTaskId || !['idle', 'waiting', 'offline'].includes(r.status))) keep[id] = r
            }
            nextRuntime = keep
          }

          // Hydration shows server state as-is. Recovering runs abandoned by a
          // closed/reloaded tab is a separate, boot-only step (recoverAbandonedRuns).
          const tasks = snap.tasks ?? state.tasks
          const pipelineSteps = snap.pipelineSteps ?? state.pipelineSteps
          const agentRuns = snap.agentRuns ?? state.agentRuns
          const codexRuns = snap.codexRuns ?? state.codexRuns

          return {
            projects: snap.projects,
            activeProjectId: snap.activeProjectId,
            agentRuntime: nextRuntime,
            hydrated: true,
            goals: active ? state.goals : [],
            tasks,
            pipelineSteps,
            agentRuns,
            codexRuns,
          }
        }),

      deleteTask: async (taskId) => {
        const task = get().tasks.find((t) => t.id === taskId)
        if (!task) return
        const terminal = ['completed', 'failed', 'cancelled', 'rejected', 'interrupted']
        if (!terminal.includes(task.status)) get().cancelTask(taskId)
        // The server only deletes terminal tasks: make sure it has the latest status first.
        await persistNow()
        const snap = await deleteTaskApi(task.projectId, taskId)
        if (get().selectedTaskId === taskId) set({ selectedTaskId: null })
        get().applyProjectsSnapshot(snap)
      },

      recoverAbandonedRuns: async () => {
        const running = get().tasks.filter((t) => t.status === 'running' || t.status === 'verifying')
        if (!running.length) return 0
        const abandoned = new Set<string>()
        for (const projectId of new Set(running.map((t) => t.projectId))) {
          const lock = await getExecutionLockState(projectId).catch(() => null)
          if (!lock) {
            console.warn(`[AgentDeck] execution lock state unknown for ${projectId}; skipping recovery`)
            continue
          }
          for (const t of running) {
            if (t.projectId !== projectId) continue
            if (!(lock.alive && lock.taskId === t.id)) abandoned.add(t.id)
          }
        }
        if (!abandoned.size) return 0
        const at = new Date().toISOString()
        set((s) => ({
          tasks: s.tasks.map((t) => (abandoned.has(t.id) ? { ...t, status: 'interrupted' as const, updatedAt: at } : t)),
          pipelineSteps: s.pipelineSteps.map((st) =>
            abandoned.has(st.taskId) && (st.status === 'running' || st.status === 'reviewing') ? { ...st, status: 'waiting' as const } : st,
          ),
          agentRuns: s.agentRuns.map((r) =>
            abandoned.has(r.taskId) && r.status === 'running'
              ? { ...r, status: 'failed' as const, error: r.error ?? 'Interrupted: the tab running this task was closed or reloaded', completedAt: r.completedAt ?? at }
              : r,
          ),
          codexRuns: s.codexRuns.map((r) =>
            abandoned.has(r.taskId) && (r.status === 'running' || r.status === 'queued')
              ? { ...r, status: 'cancelled' as const, error: r.error ?? 'Interrupted: the tab running this task was closed or reloaded', completedAt: r.completedAt ?? at }
              : r,
          ),
        }))
        await persistNow()
        return abandoned.size
      },

      setAgentRuntime: (agentId, patch) =>
        set((state) => ({
          agentRuntime: {
            ...state.agentRuntime,
            [agentId]: { ...state.agentRuntime[agentId], ...patch },
          },
        })),

      upsertAgentRun: (run) =>
        set((s) => {
          const idx = s.agentRuns.findIndex((r) => r.id === run.id)
          if (idx >= 0) {
            const next = s.agentRuns.slice()
            next[idx] = run
            return { agentRuns: next }
          }
          return { agentRuns: [...s.agentRuns, run] }
        }),

      upsertCodexRun: (run) =>
        set((s) => {
          const idx = s.codexRuns.findIndex((r) => r.id === run.id)
          if (idx >= 0) {
            const next = s.codexRuns.slice()
            next[idx] = run
            return { codexRuns: next }
          }
          return { codexRuns: [...s.codexRuns, run] }
        }),

      appendChat: (msg) =>
        set((s) => ({
          chat: [
            ...s.chat,
            {
              id: msg.id ?? `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              createdAt: new Date().toISOString(),
              role: msg.role,
              content: msg.content,
              suggestedAgents: msg.suggestedAgents,
              workProposal: msg.workProposal,
              taskResult: msg.taskResult,
            },
          ],
        })),

      proposeWorkFromChat: (text, opts) => {
        const trimmed = text.trim()
        if (!trimmed && !(opts?.attachmentIds?.length)) return
        const state = get()
        const project = selectActiveProject(state)
        const userLine =
          trimmed ||
          (opts?.attachmentIds?.length
            ? `(첨부 ${opts.attachmentIds.length}개)`
            : '')
        if (!opts?.skipUserLine) get().appendChat({ role: 'user', content: userLine })

        if (!project) {
          // No project yet: spin up a default workspace with the office's preview crew,
          // then continue with the same request instead of refusing it.
          const crew = pickDefaultCrew(state.registry).map((a) => a.id)
          if (!crew.length) {
            get().appendChat({
              role: 'assistant',
              content: '에이전트 레지스트리가 비어 있어 기본 작업공간을 만들 수 없습니다. 설정에서 에이전트 경로를 확인해 주세요.',
            })
            return
          }
          void (async () => {
            try {
              const snap = await createProjectApi({
                name: '기본 작업공간',
                type: 'custom',
                agentIds: crew,
                status: 'active',
              })
              get().applyProjectsSnapshot(snap)
              if (!selectActiveProject(get())) throw new Error('기본 작업공간이 활성화되지 않았습니다.')
              get().appendChat({
                role: 'assistant',
                content: `프로젝트가 없어 기본 직원 ${crew.length}명으로 「기본 작업공간」을 만들었어요. 이어서 요청을 정리할게요.`,
              })
              get().proposeWorkFromChat(text, { ...opts, skipUserLine: true })
            } catch (err) {
              get().appendChat({
                role: 'assistant',
                content: `기본 작업공간을 만들지 못했습니다: ${err instanceof Error ? err.message : String(err)}`,
              })
            }
          })()
          return
        }

        if (state.executionMode === 'REAL_AI' && !state.aiProvider.configured) {
          get().appendChat({
            role: 'assistant',
            content:
              'Real AI Mode이지만 OpenAI가 Not configured 상태입니다.\n\n서버에 OPENAI_API_KEY를 설정한 뒤 다시 시도하세요.\n자동으로 Mock으로 전환하지 않습니다.',
          })
          return
        }

        const team = selectTeamAgents(state)
        const requestText = trimmed || userLine
        const plan = planTask({
          project: {
            id: project.id,
            type: project.type,
            name: project.name,
          },
          request: requestText,
          source: { type: 'user' },
          team,
          registry: state.registry,
          executionMode: state.executionMode,
          attachmentHints: opts?.attachmentIds?.length
            ? {
                summary: `Attachments present: ${opts.attachmentIds.length} item(s).`,
              }
            : undefined,
        })
        const preview = plan.preview
        if (plan.steps.length === 0) {
          get().appendChat({ role: 'assistant', content: plan.rationale })
          return
        }
        const templateMeta = getTemplateById(plan.workflowTemplateId)
        get().appendChat({
          role: 'assistant',
          content: `${plan.rationale}\n\n${preview.join('\n')}`,
          workProposal: {
            title: requestText,
            description: requestText,
            workflow: plan.workflowKind,
            assignedAgentIds: [
              ...new Set(plan.steps.map((s) => s.agentId)),
            ],
            recommendedExtraAgentIds: [],
            stepLabels: plan.steps.map((s) => s.label),
            executionMode: state.executionMode,
            workflowTemplateId: plan.workflowTemplateId,
            workflowTemplateName:
              templateMeta?.nameKo ?? plan.workflowTemplateId,
            workflowPreview: preview,
            planFingerprint: planFingerprint(plan),
            attachmentIds: opts?.attachmentIds,
            attachmentStagingId: opts?.attachmentStagingId,
          },
        })
      },

      createAndStartTask: (input) => {
        const state = get()
        if (input.proposalMessageId) {
          const existingId = proposalTasks.get(input.proposalMessageId)
          if (existingId && state.tasks.some((task) => task.id === existingId)) {
            return existingId
          }
        }
        const project = selectActiveProject(state)
        if (!project) return null

        const mode: ExecutionMode =
          input.executionMode ?? state.executionMode

        if (mode === 'REAL_AI' && !state.aiProvider.configured) {
          get().appendChat({
            role: 'assistant',
            content:
              'Real AI Mode · Not configured\n\nOPENAI_API_KEY가 없어 시작할 수 없습니다.',
          })
          return null
        }

        const team = selectTeamAgents(state)
        const requestText = `${input.title}\n${input.description ?? ''}`.trim()

        const plan = planTask({
          project: {
            id: project.id,
            type: project.type,
            name: project.name,
          },
          request: requestText,
          source: input.source ?? { type: 'user' },
          preferredTemplateId: input.workflowTemplateId,
          preferredAgentId: input.preferredAgentId,
          team,
          registry: state.registry,
          executionMode: mode,
          attachmentHints: input.attachmentIds?.length
            ? {
                summary: `Attachments present: ${input.attachmentIds.length} item(s).`,
              }
            : undefined,
        })
        if (plan.steps.length === 0) {
          get().appendChat({ role: 'assistant', content: plan.rationale })
          return null
        }

        if (
          input.planFingerprint &&
          input.planFingerprint !== planFingerprint(plan)
        ) {
          get().appendChat({
            role: 'assistant',
            content:
              '미리보기와 실행 계획이 일치하지 않습니다. 다시 「무엇을 시킬까요?」로 요청해 주세요.',
          })
          return null
        }

        const now = new Date().toISOString()
        const taskId = `task_${Date.now().toString(36)}`
        const { task: planned, steps: plannedSteps } = materializeTaskFromPlan({
          plan,
          taskId,
          projectId: project.id,
          title: input.title,
          description: input.description ?? '',
          now,
          priority: input.priority ?? 'normal',
          preferredAgentId: input.preferredAgentId,
          executionMode: mode,
        })

        const task: Task = {
          ...planned,
          simulateFailure: input.simulateFailure === true,
          source: planned.source,
          attachmentIds: input.attachmentIds,
          attachmentStagingId: input.attachmentStagingId,
        }
        const steps: PipelineStep[] = plannedSteps.map((s) => ({
          ...s,
          role: s.role as import('../domain/workflowTemplates').WorkflowRoleKey | undefined,
          outputArtifactType: s.outputArtifactType as
            | import('../domain/types').ArtifactType
            | undefined,
          inputArtifactTypes: s.inputArtifactTypes as
            | import('../domain/types').ArtifactType[]
            | undefined,
        }))

        if (input.proposalMessageId) proposalTasks.set(input.proposalMessageId, taskId)
        set((s) => ({
          tasks: [task, ...s.tasks],
          pipelineSteps: [...s.pipelineSteps, ...steps],
          selectedTaskId: taskId,

          workRequestOpen: false,
          activeNav: s.activeNav === 'home' ? 'home' : 'projects',
        }))
        deckEvents.emit({
          type: 'task.created',
          taskId,
          projectId: project.id,
        })
        persist()

        if (input.attachmentIds?.length) {
          void bindAttachmentsToTask(
            project.id,
            taskId,
            input.attachmentIds,
          ).catch(() => undefined)
        }

        if (input.autoStart !== false) {
          get().startTask(taskId)
        }
        return taskId
      },

      startTask: (taskId) => {
        const task = get().tasks.find((t) => t.id === taskId)
        if (!task || pendingStarts.has(taskId) || task.status === 'cancelled' || task.status === 'completed') return
        const attempt = Symbol(taskId)
        pendingStarts.set(taskId, attempt)
        void (async () => {
          const lock = await acquireExecutionLock({
            projectId: task.projectId,
            taskId,
            clientId: CLIENT_ID,
          })
          const current = get().tasks.find((t) => t.id === taskId)
          const valid = pendingStarts.get(taskId) === attempt &&
            current?.status === task.status && current.updatedAt === task.updatedAt
          if (pendingStarts.get(taskId) === attempt) pendingStarts.delete(taskId)
          if (!valid) {
            if (lock.ok) {
              await releaseExecutionLock({ projectId: task.projectId, clientId: CLIENT_ID, taskId })
            }
            return
          }
          if (!lock.ok) {
            get().appendChat({
              role: 'assistant',
              content: lock.error ?? '다른 탭에서 이미 실행 중입니다.',
            })
            return
          }
          startHeartbeat(task.projectId, taskId)
          ensureEngineForTask(taskId).execute(taskId)
        })().catch(() => {
          if (pendingStarts.get(taskId) !== attempt) return
          pendingStarts.delete(taskId)
          get().appendChat({ role: 'assistant', content: '작업 시작 연결에 실패했습니다. 작업 기록에서 다시 시도해 주세요.' })
        })
      },
      pauseTask: (taskId) => {
        pendingStarts.delete(taskId)
        ensureEngineForTask(taskId).pause(taskId)
        const task = get().tasks.find((t) => t.id === taskId)
        if (task) {
          void releaseExecutionLock({
            projectId: task.projectId,
            clientId: CLIENT_ID,
            taskId,
          })
        }
      },
      resumeTask: (taskId) => {
        ensureEngineForTask(taskId).resume(taskId)
      },
      cancelTask: (taskId) => {
        pendingStarts.delete(taskId)
        ensureEngineForTask(taskId).cancel(taskId)
        const task = get().tasks.find((t) => t.id === taskId)
        if (task) {
          void releaseExecutionLock({
            projectId: task.projectId,
            clientId: CLIENT_ID,
            taskId,
          })
        }
      },
      retryTask: (taskId) => {
        const steps = get().pipelineSteps.filter((s) => s.taskId === taskId)
        const failed = steps.find((s) => s.status === 'failed' || s.status === 'blocked')
        if (failed) {
          set((s) => ({
            pipelineSteps: s.pipelineSteps.map((st) =>
              st.id === failed.id
                ? { ...st, status: 'waiting', completedAt: undefined, errorCode: undefined, userMessage: undefined, technicalSummary: undefined }
                : st,
            ),
            tasks: s.tasks.map((t) =>
              t.id === taskId
                ? {
                    ...t,
                    status: 'paused',
                    simulateFailure: false,
                    verificationFailed: false,
                    errorCode: undefined,
                    userMessage: undefined,
                    technicalSummary: undefined,
                    updatedAt: new Date().toISOString(),
                    progress: taskProgress(taskId, s.pipelineSteps),
                  }
                : t,
            ),
            agentRuntime: {
              ...s.agentRuntime,
              [failed.agentId]: {
                status: 'waiting',
                currentTaskId: taskId,
                currentTaskLabel: failed.label,
              },
            },
          }))
        }
        get().resumeTask(taskId)
      },

      retryFailedStep: (taskId) => {
        get().retryTask(taskId)
      },

      retryFromPreviousStep: (taskId) => {
        const steps = get()
          .pipelineSteps.filter((s) => s.taskId === taskId)
          .sort((a, b) => a.order - b.order)
        const failedIdx = steps.findIndex(
          (s) => s.status === 'failed' || s.status === 'blocked',
        )
        if (failedIdx < 0) {
          get().retryTask(taskId)
          return
        }
        const fromIdx = Math.max(0, failedIdx - 1)
        const requeueIds = new Set(steps.slice(fromIdx).map((s) => s.id))
        const now = new Date().toISOString()
        set((s) => ({
          pipelineSteps: s.pipelineSteps.map((st) =>
            requeueIds.has(st.id)
              ? {
                  ...st,
                  status: 'queued' as const,
                  startedAt: undefined,
                  completedAt: undefined,
                  errorCode: undefined,
                  userMessage: undefined,
                  technicalSummary: undefined,
                }
              : st,
          ),
          tasks: s.tasks.map((t) =>
            t.id === taskId
              ? {
                  ...t,
                  status: 'paused' as const,
                  verificationFailed: false,
                  errorCode: undefined,
                  userMessage: undefined,
                  technicalSummary: undefined,
                  updatedAt: now,
                }
              : t,
          ),
        }))
        persistSoon()
        get().resumeTask(taskId)
      },

      markSimulateFailure: (taskId) => {
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === taskId ? { ...t, simulateFailure: true } : t,
          ),
        }))
      },

      retryWebSearch: (taskId) => {
        const now = new Date().toISOString()
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === taskId
              ? {
                  ...t,
                  webSearchFailure: undefined,
                  status: 'paused' as const,
                  updatedAt: now,
                }
              : t,
          ),
          pipelineSteps: s.pipelineSteps.map((st) =>
            st.taskId === taskId &&
            (st.status === 'failed' || st.status === 'blocked')
              ? {
                  ...st,
                  status: 'queued' as const,
                  startedAt: undefined,
                  completedAt: undefined,
                }
              : st,
          ),
        }))
        persistSoon()
        get().resumeTask(taskId)
      },

      continueWithoutWebSearch: (taskId) => {
        const task = get().tasks.find((t) => t.id === taskId)
        const failStepId = task?.webSearchFailure?.stepId
        const now = new Date().toISOString()
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === taskId
              ? {
                  ...t,
                  webSearchFailure: undefined,
                  status: 'paused' as const,
                  updatedAt: now,
                }
              : t,
          ),
          pipelineSteps: s.pipelineSteps.map((st) => {
            if (failStepId && st.id === failStepId) {
              return {
                ...st,
                requiresWebSearch: false,
                status: 'queued' as const,
                startedAt: undefined,
                completedAt: undefined,
              }
            }
            if (
              st.taskId === taskId &&
              (st.status === 'failed' || st.status === 'blocked')
            ) {
              return {
                ...st,
                requiresWebSearch: false,
                status: 'queued' as const,
                startedAt: undefined,
                completedAt: undefined,
              }
            }
            return st
          }),
        }))
        persistSoon()
        get().resumeTask(taskId)
      },

      approveTaskChanges: async (taskId) => {
        const state = get()
        const task = state.tasks.find((t) => t.id === taskId)
        if (!task || task.status !== 'awaiting_approval') return
        const now = new Date().toISOString()
        const approvalStepId = task.approval?.stepId
        const kind = task.approval?.kind ?? 'change'
        const runId = task.approval?.runId
        const implementRun =
          kind === 'change'
            ? runId
              ? state.codexRuns.find((r) => r.id === runId)
              : state.codexRuns
                  .filter((r) => r.taskId === taskId && r.mode === 'implement')
                  .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
                  .at(-1)
            : undefined
        const implementStep = implementRun
          ? state.pipelineSteps.find((s) => s.id === implementRun.stepId)
          : undefined

        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === taskId
              ? {
                  ...t,
                  status: 'running' as const,
                  updatedAt: now,
                  pendingImplementFeedback: undefined,
                  approval: {
                    ...(t.approval ?? {
                      status: 'pending',
                      stepId: approvalStepId ?? '',
                    }),
                    status: 'approved' as const,
                    kind,
                    decidedAt: now,
                  },
                  implementationIterations:
                    kind === 'change'
                      ? (t.implementationIterations ?? []).map((it, idx, arr) =>
                          idx === arr.length - 1
                            ? { ...it, status: 'approved' as const }
                            : it,
                        )
                      : t.implementationIterations,
                }
              : t,
          ),
          pipelineSteps: s.pipelineSteps.map((st) =>
            st.id === approvalStepId
              ? {
                  ...st,
                  status: 'completed' as const,
                  completedAt: now,
                }
              : st,
          ),
        }))

        if (kind === 'change' && implementRun && implementStep) {
          try {
            await persistCodexArtifact({
              projectId: task.projectId,
              task,
              step: implementStep,
              run: implementRun,
              approved: true,
            })
          } catch (err) {
            console.warn('[F2] approved code-change artifact failed', err)
          }
        }

        persistSoon()
        ensureEngineForTask(taskId).execute(taskId)
      },

      rejectTaskChanges: async (taskId) => {
        const state = get()
        const task = state.tasks.find((t) => t.id === taskId)
        if (!task || task.status !== 'awaiting_approval') return
        const kind = task.approval?.kind ?? 'change'
        const snapshotId = task.approval?.snapshotId
        if (kind === 'change' && snapshotId) {
          const project = get().projects.find((p) => p.id === task.projectId)
          if (!project?.path) {
            get().appendChat({
              role: 'assistant',
              content: '변경 거절 롤백 실패: 프로젝트 경로가 없습니다.',
            })
            return
          }
          const result = await rollbackCodexSnapshot(snapshotId, {
            projectId: task.projectId,
            projectPath: project.path,
          })
          if (!result.ok) {
            get().appendChat({
              role: 'assistant',
              content: `변경 거절 롤백 실패: ${result.error ?? 'unknown'}`,
            })
            return
          }
        }
        const now = new Date().toISOString()
        const approvalStepId = task.approval?.stepId
        set((s) => {
          const runtime = { ...s.agentRuntime }
          for (const st of s.pipelineSteps.filter((x) => x.taskId === taskId)) {
            runtime[st.agentId] = {
              ...runtime[st.agentId],
              status: 'idle',
              currentTaskId: undefined,
              currentTaskLabel: undefined,
              speech: undefined,
            }
          }
          return {
            agentRuntime: runtime,
            tasks: s.tasks.map((t) =>
              t.id === taskId
                ? {
                    ...t,
                    status: 'rejected' as const,
                    updatedAt: now,
                    completedAt: now,
                    approval: {
                      ...(t.approval ?? { status: 'pending', stepId: approvalStepId ?? '' }),
                      status: 'rejected' as const,
                      decidedAt: now,
                    },
                    implementationIterations: (t.implementationIterations ?? []).map(
                      (it, idx, arr) =>
                        idx === arr.length - 1
                          ? { ...it, status: 'rejected' as const }
                          : it,
                    ),
                  }
                : t,
            ),
            pipelineSteps: s.pipelineSteps.map((st) =>
              st.taskId === taskId && st.status !== 'completed'
                ? { ...st, status: 'blocked' as const }
                : st,
            ),
          }
        })
        persistSoon()
      },

      requestTaskChanges: async (taskId, feedback) => {
        const state = get()
        const task = state.tasks.find((t) => t.id === taskId)
        const trimmed = feedback.trim()
        if (!trimmed) return
        if (!task || (task.status !== 'awaiting_approval' && !task.verificationFailed))
          return
        if (task.verificationFailed && task.status !== 'awaiting_approval') {
          // Re-queue implement after verify failure (human requested fix)
          const now = new Date().toISOString()
          const implementStep = state.pipelineSteps
            .filter((s) => s.taskId === taskId && s.mode === 'implement')
            .sort((a, b) => b.order - a.order)[0]
          const approvalStep = state.pipelineSteps.find(
            (s) => s.taskId === taskId && s.provider === 'human',
          )
          set((s) => ({
            tasks: s.tasks.map((t) =>
              t.id === taskId
                ? {
                    ...t,
                    status: 'running' as const,
                    verificationFailed: false,
                    pendingImplementFeedback: trimmed,
                    updatedAt: now,
                  }
                : t,
            ),
            pipelineSteps: s.pipelineSteps.map((st) => {
              if (implementStep && st.id === implementStep.id) {
                return {
                  ...st,
                  status: 'queued' as const,
                  completedAt: undefined,
                  startedAt: undefined,
                }
              }
              if (approvalStep && st.id === approvalStep.id) {
                return {
                  ...st,
                  status: 'queued' as const,
                  completedAt: undefined,
                }
              }
              if (st.mode === 'verify' && st.status === 'failed') {
                return {
                  ...st,
                  status: 'queued' as const,
                  completedAt: undefined,
                }
              }
              return st
            }),
          }))
          persistSoon()
          ensureEngineForTask(taskId).execute(taskId)
          return
        }
        if (task.status !== 'awaiting_approval') return
        const now = new Date().toISOString()
        const approvalStepId = task.approval?.stepId

        // Plan approval 수정 요청 — plan step만 재실행 (이전 Artifact 유지)
        if (task.approval?.kind === 'plan') {
          const planApproval = state.pipelineSteps.find(
            (s) => s.id === approvalStepId,
          )
          const planStep = state.pipelineSteps
            .filter(
              (s) =>
                s.taskId === taskId &&
                s.order < (planApproval?.order ?? 999) &&
                s.provider === 'openai' &&
                (s.outputArtifactType === 'plan' ||
                  /계획|plan/i.test(s.label)),
            )
            .sort((a, b) => b.order - a.order)[0]
          set((s) => ({
            tasks: s.tasks.map((t) =>
              t.id === taskId
                ? {
                    ...t,
                    status: 'running' as const,
                    pendingImplementFeedback: trimmed,
                    updatedAt: now,
                    approval: {
                      ...(t.approval ?? {
                        status: 'pending',
                        stepId: approvalStepId ?? '',
                      }),
                      status: 'changes_requested' as const,
                      feedback: trimmed,
                      decidedAt: now,
                    },
                  }
                : t,
            ),
            pipelineSteps: s.pipelineSteps.map((st) => {
              if (planStep && st.id === planStep.id) {
                return {
                  ...st,
                  status: 'queued' as const,
                  startedAt: undefined,
                  completedAt: undefined,
                }
              }
              if (st.id === approvalStepId) {
                return {
                  ...st,
                  status: 'queued' as const,
                  startedAt: undefined,
                  completedAt: undefined,
                }
              }
              return st
            }),
          }))
          persistSoon()
          ensureEngineForTask(taskId).execute(taskId)
          return
        }

        // Re-queue implement step; keep approval pending until next iteration
        const implementStep = state.pipelineSteps
          .filter((s) => s.taskId === taskId && s.mode === 'implement')
          .sort((a, b) => b.order - a.order)[0]

        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === taskId
              ? {
                  ...t,
                  status: 'running' as const,
                  updatedAt: now,
                  pendingImplementFeedback: trimmed,
                  approval: {
                    ...(t.approval ?? { status: 'pending', stepId: approvalStepId ?? '' }),
                    status: 'changes_requested' as const,
                    decidedAt: now,
                    feedback: trimmed,
                  },
                  implementationIterations: (t.implementationIterations ?? []).map(
                    (it, idx, arr) =>
                      idx === arr.length - 1
                        ? {
                            ...it,
                            status: 'changes_requested' as const,
                            feedback: trimmed,
                          }
                        : it,
                  ),
                }
              : t,
          ),
          pipelineSteps: s.pipelineSteps.map((st) => {
            if (implementStep && st.id === implementStep.id) {
              return {
                ...st,
                status: 'queued' as const,
                completedAt: undefined,
                startedAt: undefined,
              }
            }
            if (approvalStepId && st.id === approvalStepId) {
              return {
                ...st,
                status: 'queued' as const,
                completedAt: undefined,
              }
            }
            return st
          }),
        }))
        persistSoon()
        ensureEngineForTask(taskId).execute(taskId)
      },
    }
  })

  return store
}

type DeckStore = ReturnType<typeof createDeckStore>

const globalKey = '__agentDeckStore' as const

function getStore(): DeckStore {
  const g = globalThis as typeof globalThis & {
    [globalKey]?: DeckStore
  }
  // Always recreate when shape changes (Phase 3-A)
  if (!g[globalKey] || !('executionMode' in g[globalKey].getState())) {
    g[globalKey] = createDeckStore()
  }
  return g[globalKey]
}

export const useDeckStore: DeckStore = getStore()

export function selectActiveProject(state: DeckState): Project | null {
  if (!state.activeProjectId) return null
  return state.projects.find((p) => p.id === state.activeProjectId) ?? null
}

const EMPTY_PROJECTS: Project[] = []
const EMPTY_TASKS: Task[] = []
const EMPTY_STEPS: PipelineStep[] = []
const EMPTY_RUNS: AgentRun[] = []
const EMPTY_CODEX: CodexRun[] = []

let visibleProjectsKey = ''
let visibleProjectsCache: Project[] = EMPTY_PROJECTS

/** Demo UI list — excludes fixture/e2e project names. Stable reference when unchanged. */
export function selectVisibleProjects(state: DeckState): Project[] {
  const key = state.projects.map((p) => `${p.id}:${p.name}`).join('|')
  if (key === visibleProjectsKey) return visibleProjectsCache
  visibleProjectsKey = key
  const next = state.projects.filter((p) => !isFixtureProjectName(p.name))
  visibleProjectsCache = next.length === 0 ? EMPTY_PROJECTS : next
  return visibleProjectsCache
}

let teamCacheKey = ''
let teamCache: Agent[] = []

export function selectTeamAgents(state: DeckState): Agent[] {
  const project = selectActiveProject(state)
  // Persisted step state is the source of truth for who is busy; the in-memory runtime
  // only adds detail (speech). Without this, a reload or a lost runtime update shows
  // the whole office idle while a step is actually running.
  const runtime = { ...state.agentRuntime }
  if (project) {
    const liveTasks = new Map(
      state.tasks
        .filter((t) => t.projectId === project.id && ['running', 'verifying'].includes(t.status))
        .map((t) => [t.id, t]),
    )
    for (const step of state.pipelineSteps) {
      if (!liveTasks.has(step.taskId) || !step.agentId) continue
      const status = step.status === 'running' ? 'working' : step.status === 'reviewing' ? 'reviewing' : null
      if (!status) continue
      const cur = runtime[step.agentId]
      if (!cur || cur.status === 'idle' || cur.status === 'waiting') {
        runtime[step.agentId] = { ...cur, status, currentTaskId: step.taskId, currentTaskLabel: step.label }
      }
    }
  }
  const runtimeKey = Object.keys(runtime)
    .sort()
    .map((id) => {
      const r = runtime[id]
      return `${id}:${r?.status ?? ''}:${r?.currentTaskLabel ?? ''}:${r?.speech ?? ''}`
    })
    .join('|')
  const key = [
    state.registryTotal,
    state.registrySource,
    state.activeProjectId ?? '',
    project?.agentIds.join(',') ?? '',
    runtimeKey,
  ].join('::')
  if (key === teamCacheKey) return teamCache
  teamCacheKey = key
  teamCache = mergeTeamAgents(state.registry, project, runtime)
  return teamCache
}

export function selectActiveAgentCount(state: DeckState): number {
  return selectTeamAgents(state).filter(
    (a) =>
      a.status === 'working' ||
      a.status === 'reviewing' ||
      a.status === 'verifying',
  ).length
}

let breakdownCacheKey = ''
let breakdownCache = {
  total: 0,
  working: 0,
  waiting: 0,
  reviewing: 0,
  verifying: 0,
  idle: 0,
  offline: 0,
  blocked: 0,
}

export function selectStatusBreakdown(state: DeckState) {
  const team = selectTeamAgents(state)
  const key = `${teamCacheKey}::len${team.length}`
  if (key === breakdownCacheKey) return breakdownCache
  const counts = {
    working: 0,
    waiting: 0,
    reviewing: 0,
    verifying: 0,
    idle: 0,
    offline: 0,
    blocked: 0,
  }
  for (const a of team) {
    counts[a.status] += 1
  }
  breakdownCacheKey = key
  breakdownCache = {
    total: team.length,
    working: counts.working,
    waiting: counts.waiting,
    reviewing: counts.reviewing,
    verifying: counts.verifying,
    idle: counts.idle,
    offline: counts.offline,
    blocked: counts.blocked,
  }
  return breakdownCache
}

let tasksForActiveKey = ''
let tasksForActiveCache: Task[] = EMPTY_TASKS

export function selectTasksForActive(state: DeckState): Task[] {
  const project = selectActiveProject(state)
  if (!project) {
    tasksForActiveKey = ''
    tasksForActiveCache = EMPTY_TASKS
    return EMPTY_TASKS
  }
  const key = `${project.id}::${state.tasks
    .map((t) => `${t.id}:${t.status}:${t.progress}:${t.updatedAt}`)
    .join('|')}`
  if (key === tasksForActiveKey) return tasksForActiveCache
  tasksForActiveKey = key
  const next = state.tasks.filter((t) => t.projectId === project.id)
  tasksForActiveCache = next.length === 0 ? EMPTY_TASKS : next
  return tasksForActiveCache
}

export function selectStepsForTask(
  state: DeckState,
  taskId: string | null,
): PipelineStep[] {
  if (!taskId) return EMPTY_STEPS
  const next = state.pipelineSteps
    .filter((s) => s.taskId === taskId)
    .sort((a, b) => a.order - b.order)
  return next.length === 0 ? EMPTY_STEPS : next
}

export function selectSelectedTask(state: DeckState): Task | null {
  if (!state.selectedTaskId) return null
  return state.tasks.find((t) => t.id === state.selectedTaskId) ?? null
}

export function selectRunsForTask(
  state: DeckState,
  taskId: string | null,
): AgentRun[] {
  if (!taskId) return EMPTY_RUNS
  const next = state.agentRuns.filter((r) => r.taskId === taskId)
  return next.length === 0 ? EMPTY_RUNS : next
}

export function selectCodexRunsForTask(
  state: DeckState,
  taskId: string | null,
): CodexRun[] {
  if (!taskId) return EMPTY_CODEX
  const next = state.codexRuns.filter((r) => r.taskId === taskId)
  return next.length === 0 ? EMPTY_CODEX : next
}

/** Tasks waiting for plan or change approval (Simplify-1 inbox). */
let pendingApprovalsKey = ''
let pendingApprovalsCache: Task[] = EMPTY_TASKS

export function selectPendingApprovals(state: DeckState): Task[] {
  const key = state.tasks
    .map(
      (t) =>
        `${t.id}:${t.status}:${t.approval?.status ?? ''}:${t.updatedAt}`,
    )
    .join('|')
  if (key === pendingApprovalsKey) return pendingApprovalsCache
  pendingApprovalsKey = key
  const next = state.tasks
    .filter(
      (t) =>
        t.status === 'awaiting_approval' &&
        (t.approval?.status === 'pending' || !t.approval),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  pendingApprovalsCache = next.length === 0 ? EMPTY_TASKS : next
  return pendingApprovalsCache
}

/** Stable primitive for badge/subscribe (avoids getSnapshot infinite loop). */
export function selectPendingApprovalCount(state: DeckState): number {
  return state.tasks.filter(
    (t) =>
      t.status === 'awaiting_approval' &&
      (t.approval?.status === 'pending' || !t.approval),
  ).length
}
