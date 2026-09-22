import { t } from '../i18n'
import styles from './Entrance.module.css'

/** Entrance — label only (prototype). */
export function Entrance() {
  return (
    <div className={styles.room} data-room="plaza">
      <div className={styles.wallTop} aria-hidden />
      <header className={styles.header}>
        <span>{t('room.entrance')}</span>
      </header>
    </div>
  )
}
