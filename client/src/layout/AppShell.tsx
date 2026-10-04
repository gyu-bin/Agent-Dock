import { useEffect, useRef, useState } from 'react'
import {
  useDeckStore,
  selectActiveProject,
} from '../store/useDeckStore'
import { fetchRegistry, fetchProjects, fetchProvider } from '../api/client'
import { ensureSession, useAuthStore } from '../auth/cloudAuth'
import { LoginScreen } from '../auth/LoginScreen'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { PixelOfficeScene } from '../office/pixel/PixelOfficeScene'
import { HomeWorkStatus } from '../components/HomeWorkStatus'
import { AiChatPanel } from '../panels/AiChatPanel'
import { ProjectWizard } from '../components/ProjectWizard'
import { ManageTeamModal } from '../components/ManageTeamModal'
import { WorkRequestModal } from '../components/WorkRequestModal'
import { ProjectsPage } from '../pages/ProjectsPage'
import { AgentsPage } from '../pages/AgentsPage'
import { SettingsPage } from '../pages/SettingsPage'
import { ArtifactsPage } from '../pages/ArtifactsPage'
import { UsagePage } from '../pages/UsagePage'
import { ApprovalsPage } from '../pages/ApprovalsPage'
import { TasksPage } from '../pages/TasksPage'
import { DepartmentsPage } from '../pages/DepartmentsPage'
import styles from './AppShell.module.css'

export function AppShell() {
  const activeNav = useDeckStore((s) => s.activeNav)
  const project = useDeckStore(selectActiveProject)
  const hydrated = useDeckStore((s) => s.hydrated)
  const theme = useDeckStore((s) => s.theme)
  const sidebarCollapsed = useDeckStore((s) => s.sidebarCollapsed)

  const authStatus = useAuthStore((s) => s.status)
  const [chatWidth, setChatWidth] = useState(readChatWidth)
  const drag = useRef<{ x: number; w: number } | null>(null)
  function saveChatWidth(w: number) {
    const next = clampChatWidth(w)
    setChatWidth(next)
    try { localStorage.setItem(CHAT_W_KEY, String(next)) } catch { /* per-viewer convenience only */ }
  }
  function startResize(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault()
    drag.current = { x: e.clientX, w: chatWidth }
    document.body.style.userSelect = 'none'
    const move = (ev: PointerEvent) => { if (drag.current) setChatWidth(clampChatWidth(drag.current.w + (drag.current.x - ev.clientX))) }
    const up = (ev: PointerEvent) => {
      if (drag.current) saveChatWidth(drag.current.w + (drag.current.x - ev.clientX))
      drag.current = null
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.body.style.cursor = 'col-resize'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('settings') === 'sns') useDeckStore.getState().setNav('settings')
  }, [])
  const isHome = activeNav === 'home'

  useEffect(() => {
    // The whole app follows the theme; only the pixel art keeps its own colors.
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  useEffect(() => {
    let cancelled = false

    async function boot() {
      try {
        const ready = await ensureSession()
        if (!ready || cancelled) return
        const [reg, projects, provider] = await Promise.all([
          fetchRegistry(),
          fetchProjects(),
          fetchProvider(),
        ])
        if (cancelled) return
        const store = useDeckStore.getState()
        store.hydrateRegistry({
          agents: reg.agents,
          source: reg.source,
          total: reg.total,
        })
        store.setAiProvider(provider)
        store.applyProjectsSnapshot(projects)
        // Boot-only recovery: a task left "running" by a closed/reloaded tab has no
        // live execution lock any more — mark it interrupted so it can be resumed.
        const recovered = await store.recoverAbandonedRuns().catch(() => 0)
        if (recovered) console.info(`[AgentDeck] recovered ${recovered} abandoned run(s) as interrupted`)
      } catch (err) {
        console.error('[AgentDeck] hydrate failed', err)
        if (!cancelled) {
          useDeckStore.getState().applyProjectsSnapshot({
            version: 3,
            activeProjectId: null,
            projects: [],
            tasks: [],
            pipelineSteps: [],
            agentRuns: [],
          })
        }
      }
    }

    void boot()
    return () => {
      cancelled = true
    }
  }, [])

  if (authStatus === 'signed-out' || authStatus === 'not-allowed' || authStatus === 'misconfigured') {
    return <LoginScreen />
  }

  return (
    <div className={styles.shell} style={sidebarCollapsed ? { gridTemplateColumns: '64px minmax(0, 1fr)' } : undefined}>
      <Sidebar />
      <div className={styles.main}>
        <TopBar />
        {isHome ? (
          <div className={styles.workspace} style={{ gridTemplateColumns: `minmax(0, 1fr) 6px ${chatWidth}px` }}>
            <section className={styles.officePane} aria-label="2D Office">
              <div className={styles.officeScene}>
              {!hydrated ? (
                <div className={styles.placeholderTab}>
                  <p>불러오는 중…</p>
                </div>
              ) : !project ? (
                <PixelOfficeScene preview />
              ) : (
                <PixelOfficeScene />
              )}
              </div>
              <HomeWorkStatus />
            </section>
            <div
              className={styles.resizer}
              role="separator"
              aria-orientation="vertical"
              aria-label="채팅 영역 너비 조절"
              title="끌어서 채팅 영역 너비 조절 · 두 번 클릭하면 기본값"
              onPointerDown={startResize}
              onDoubleClick={() => saveChatWidth(DEFAULT_CHAT_W)}
            />
            <AiChatPanel />
          </div>
        ) : (
          <div className={styles.pagePane}>
            {activeNav === 'projects' ? <ProjectsPage /> : null}
            {activeNav === 'tasks' ? <TasksPage /> : null}
            {activeNav === 'documents' ? <ArtifactsPage /> : null}
            {activeNav === 'approvals' ? <ApprovalsPage /> : null}
            {activeNav === 'settings' ? <SettingsPage /> : null}
            {activeNav === 'agents' ? <AgentsPage /> : null}
            {activeNav === 'usage' ? <UsagePage /> : null}
            {activeNav === 'departments' ? <DepartmentsPage /> : null}
          </div>
        )}
      </div>
      <ProjectWizard />
      <ManageTeamModal />
      <WorkRequestModal />
    </div>
  )
}

const CHAT_W_KEY = 'agentdeck.chatWidth'
const DEFAULT_CHAT_W = 380
function clampChatWidth(w: number): number {
  const max = Math.max(360, Math.min(900, window.innerWidth - 520))
  return Math.round(Math.min(max, Math.max(300, w)))
}
function readChatWidth(): number {
  try {
    const v = Number(localStorage.getItem(CHAT_W_KEY))
    return v ? clampChatWidth(v) : DEFAULT_CHAT_W
  } catch {
    return DEFAULT_CHAT_W
  }
}
