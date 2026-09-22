import { Sparkles } from 'lucide-react'
import { useDeckStore } from '../store/useDeckStore'
import { t } from '../i18n'
import styles from './EmptyOffice.module.css'

export function EmptyOffice() {
  const openWizard = useDeckStore((s) => s.openWizard)

  return (
    <div className={styles.empty}>
      <div className={styles.card}>
        <div className={styles.icon}>
          <Sparkles size={22} />
        </div>
        <h2>{t('office.emptyTitle')}</h2>
        <p>{t('office.emptyHint')}</p>
        <button type="button" className={styles.cta} onClick={openWizard}>
          {t('office.createProject')}
        </button>
      </div>
    </div>
  )
}
