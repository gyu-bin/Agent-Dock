import { useEffect } from 'react'
import {
  useDeckStore,
  selectActiveProject,
} from '../store/useDeckStore'
import { fetchRegistry, fetchProjects, fetchProvider, bootstrapSession } from '../api/client'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { OfficeScene } from '../office/OfficeScene'
import { EmptyOffice } from '../office/EmptyOffice'
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
        await bootstrapSession()
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

  return (
    <div className={styles.shell}>
      <Sidebar />
      <div className={styles.main}>
        <TopBar />
        {isHome ? (
          <div className={styles.workspace}>
            <section className={styles.officePane} aria-label="2D Office">
              {!hydrated ? (
                <div className={styles.placeholderTab}>
                  <p>불러오는 중…</p>
                </div>
              ) : !project ? (
                <EmptyOffice />
              ) : (
                <OfficeScene />
              )}
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
