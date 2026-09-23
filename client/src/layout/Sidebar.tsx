import {
  Home,
  FolderKanban,
  Bell,
  Settings,
} from 'lucide-react'
import { t } from '../i18n'
import {
  selectPendingApprovalCount,
  useDeckStore,
  type NavId,
} from '../store/useDeckStore'
import styles from './Sidebar.module.css'

const MAIN: Array<{
  id: NavId
  labelKey: string
  icon: typeof Home
  countKey?: 'approvals'
}> = [
  { id: 'home', labelKey: 'nav.home', icon: Home },
  { id: 'projects', labelKey: 'nav.projects', icon: FolderKanban },
  { id: 'approvals', labelKey: 'nav.approvals', icon: Bell, countKey: 'approvals' },
]

export function Sidebar() {
  const activeNav = useDeckStore((s) => s.activeNav)
  const setNav = useDeckStore((s) => s.setNav)
  const pendingCount = useDeckStore(selectPendingApprovalCount)
  const aiProvider = useDeckStore((s) => s.aiProvider)
  const executionMode = useDeckStore((s) => s.executionMode)
  const developerAllowMock = useDeckStore((s) => s.developerAllowMock)
  const user = useDeckStore((s) => s.user)

  const providerLabel =
    executionMode === 'MOCK' && developerAllowMock
      ? '로컬 실행'
      : aiProvider.configured
        ? 'AI 준비됨'
        : 'AI 설정 필요'

  return (
    <aside className={styles.sidebar}>
      <div className={styles.brand}>
        <div className={styles.logoMark} aria-hidden>
          <span />
          <span />
        </div>
        <div>
          <div className={styles.brandName}>{t('brand.name')}</div>
          <div className={styles.tagline}>{t('brand.tagline')}</div>
        </div>
      </div>

      <nav className={styles.nav} aria-label={t('nav.main')}>
        {MAIN.map((item) => {
          const Icon = item.icon
          const count =
            item.countKey === 'approvals' ? pendingCount : undefined
          return (
            <button
              key={item.id}
              type="button"
              className={
                activeNav === item.id ||
                (item.id === 'home' && activeNav === 'departments')
                  ? styles.navItemActive
                  : styles.navItem
              }
              onClick={() => setNav(item.id)}
            >
              <Icon size={16} strokeWidth={2} />
              <span>{t(item.labelKey)}</span>
              {count != null && count > 0 ? (
                <em className={styles.badge}>{count}</em>
              ) : null}
            </button>
          )
        })}
      </nav>

          <div className={styles.footer}>
        <button
          type="button"
          className={
            activeNav === 'settings' ? styles.navItemActive : styles.navItem
          }
          onClick={() => setNav('settings')}
        >
          <Settings size={16} strokeWidth={2} />
          <span>{t('nav.settings')}</span>
        </button>
        <button
          type="button"
          className={styles.navItem}
          onClick={() => setNav('tasks')}
          title="Legacy · Project 탭에서도 가능"
        >
          <span style={{ fontSize: 11, opacity: 0.7 }}>작업(고급)</span>
        </button>
        <button
          type="button"
          className={styles.navItem}
          onClick={() => setNav('usage')}
          title="Usage"
        >
          <span style={{ fontSize: 11, opacity: 0.7 }}>Usage</span>
        </button>
        <button
          type="button"
          className={
            aiProvider.configured ? styles.providerOk : styles.providerOff
          }
          title={providerLabel}
          onClick={() => setNav('settings')}
        >
          <span className={styles.providerDot} />
          {providerLabel}
        </button>
        <div className={styles.profile}>
          <div className={styles.avatar}>
            {user.name.slice(0, 1).toUpperCase()}
          </div>
          <div>
            <div className={styles.profileName}>{user.name}</div>
            <div className={styles.profileRole}>{user.role}</div>
          </div>
        </div>
      </div>
    </aside>
  )
}
