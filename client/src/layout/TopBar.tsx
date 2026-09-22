import { Bell, ChevronDown, Moon, Plus, Sun, Users } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { setActiveProject } from '../api/client'
import { t } from '../i18n'
import {
  selectActiveProject,
  selectPendingApprovalCount,
  selectVisibleProjects,
  useDeckStore,
} from '../store/useDeckStore'
import styles from './TopBar.module.css'

function typeLabel(type: string) {
  return t(`projectType.${type}`) !== `projectType.${type}`
    ? t(`projectType.${type}`)
    : type
}

export function TopBar() {
  const project = useDeckStore(selectActiveProject)
  const projects = useDeckStore(selectVisibleProjects)
  const openWizard = useDeckStore((s) => s.openWizard)
  const openManageTeam = useDeckStore((s) => s.openManageTeam)
  const applyProjectsSnapshot = useDeckStore((s) => s.applyProjectsSnapshot)
  const setNav = useDeckStore((s) => s.setNav)
  const setChatTab = useDeckStore((s) => s.setChatTab)
  const theme = useDeckStore((s) => s.theme)
  const toggleTheme = useDeckStore((s) => s.toggleTheme)
  const pendingCount = useDeckStore(selectPendingApprovalCount)

  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    function onDoc(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [menuOpen])

  async function switchProject(id: string) {
    const snap = await setActiveProject(id)
    applyProjectsSnapshot(snap)
    setMenuOpen(false)
    setNav('home')
  }

  function focusNewWork() {
    setNav('home')
    setChatTab('chat')
    requestAnimationFrame(() => {
      document.getElementById('ad-home-composer')?.focus()
    })
  }

  return (
    <header className={styles.topbar}>
      <div className={styles.left}>
        <div className={styles.projectWrap} ref={menuRef}>
          <button
            type="button"
            className={styles.projectSwitch}
            onClick={() => setMenuOpen((o) => !o)}
            aria-expanded={menuOpen}
          >
            <span className={styles.projectLabel}>{t('project.label')}</span>
            <strong>{project?.name ?? t('project.noActive')}</strong>
            <ChevronDown size={14} />
          </button>
          {menuOpen ? (
            <div className={styles.projectMenu} role="listbox">
              {projects.length === 0 ? (
                <div className={styles.menuEmpty}>{t('project.noActive')}</div>
              ) : (
                projects.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={
                      p.id === project?.id ? styles.menuItemOn : styles.menuItem
                    }
                    onClick={() => switchProject(p.id)}
                  >
                    <strong>{p.name}</strong>
                    <span>{typeLabel(p.type)}</span>
                  </button>
                ))
              )}
              <button
                type="button"
                className={styles.menuNew}
                onClick={() => {
                  setMenuOpen(false)
                  openWizard()
                }}
              >
                <Plus size={14} /> {t('project.new')}
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <div className={styles.right}>
        <button
          type="button"
          className={styles.iconBtn}
          aria-label={theme === 'dark' ? '라이트 모드' : '다크 모드'}
          title={theme === 'dark' ? '라이트 모드' : '다크 모드'}
          onClick={toggleTheme}
        >
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        <button
          type="button"
          className={styles.iconBtn}
          aria-label={t('nav.approvals')}
          onClick={() => setNav('approvals')}
        >
          <Bell size={16} />
          {pendingCount > 0 ? (
            <em className={styles.bellBadge}>{pendingCount}</em>
          ) : null}
        </button>
        {project ? (
          <button
            type="button"
            className={styles.ghostBtn}
            onClick={openManageTeam}
          >
            <Users size={14} />
            {t('project.manageTeam')}
          </button>
        ) : null}
        {project ? (
          <button
            type="button"
            className={styles.primaryBtn}
            onClick={focusNewWork}
          >
            <Plus size={14} strokeWidth={2.5} />
            {t('task.askWhat')}
          </button>
        ) : (
          <button
            type="button"
            className={styles.primaryBtn}
            onClick={openWizard}
          >
            <Plus size={14} strokeWidth={2.5} />
            {t('project.new')}
          </button>
        )}
      </div>
    </header>
  )
}
