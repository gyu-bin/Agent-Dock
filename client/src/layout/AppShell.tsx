import { useEffect } from 'react'
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

  const authStatus = useAuthStore((s) => s.status)
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('settings') === 'sns') useDeckStore.getState().setNav('settings')
  }, [])
  const isHome = activeNav === 'home'

  useEffect(() => {
    // 오피스(홈)는 항상 라이트 — 다크 모드는 다른 페이지에만 적용
    document.documentElement.setAttribute(
      'data-theme',
      isHome ? 'light' : theme,
    )
  }, [isHome, theme])

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
    <div className={styles.shell}>
      <Sidebar />
      <div className={styles.main}>
        <TopBar />
        {isHome ? (
          <div className={styles.workspace}>
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
