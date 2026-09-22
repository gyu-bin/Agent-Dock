import { useEffect, useState } from 'react'
import { BookMarked } from 'lucide-react'
import { fetchProjectKnowledge } from '../api/client'
import type { KnowledgeCategory, KnowledgeItem, KnowledgeStatus } from '../domain/types'
import {
  KNOWLEDGE_CATEGORY_FILTERS,
  KNOWLEDGE_CATEGORY_LABEL,
  KNOWLEDGE_STATUS_FILTERS,
  KNOWLEDGE_STATUS_LABEL,
} from '../domain/knowledgeUi'
import { t } from '../i18n/ko'
import { selectActiveProject, useDeckStore } from '../store/useDeckStore'
import styles from './Pages.module.css'

export function KnowledgePage() {
  const project = useDeckStore(selectActiveProject)
  const selectKnowledge = useDeckStore((s) => s.selectKnowledge)
  const [category, setCategory] = useState<'all' | KnowledgeCategory>('all')
  const [status, setStatus] = useState<'all' | KnowledgeStatus>('all')
  const [q, setQ] = useState('')
  const [items, setItems] = useState<KnowledgeItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!project) {
      setItems([])
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    const handle = setTimeout(() => {
      void fetchProjectKnowledge(project.id, {
        category: category === 'all' ? undefined : category,
        status: status === 'all' ? undefined : status,
        q: q.trim() || undefined,
      })
        .then((list) => {
          if (!cancelled) setItems(list)
        })
        .catch((err) => {
          if (!cancelled)
            setError(err instanceof Error ? err.message : String(err))
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [project?.id, category, status, q])

  if (!project) {
    return (
      <div className={styles.page}>
        <div className={styles.empty}>
          <BookMarked size={28} />
          <h2>{t('project.noActive')}</h2>
          <p>프로젝트를 선택하면 지식 저장소를 볼 수 있습니다.</p>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <header className={styles.pageHead}>
        <div>
          <h1>{t('nav.knowledge')}</h1>
          <p>
            {project.name} — 확정된 프로젝트 지식만 Agent Context에 사용됩니다.
          </p>
        </div>
      </header>

      <div className={styles.filters}>
        <div className={styles.search}>
          <input
            placeholder="제목·내용 검색"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="지식 검색"
          />
        </div>
      </div>

      <div className={styles.filterRow}>
        {KNOWLEDGE_CATEGORY_FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={category === f.id ? styles.filterOn : styles.filter}
            onClick={() => setCategory(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className={styles.filterRow}>
        {KNOWLEDGE_STATUS_FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={status === f.id ? styles.filterOn : styles.filter}
            onClick={() => setStatus(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? <p className={styles.muted}>불러오는 중…</p> : null}
      {error ? <p className={styles.error}>{error}</p> : null}

      {items.length === 0 && !loading ? (
        <div className={styles.empty}>
          <BookMarked size={24} />
          <h2>지식이 없습니다</h2>
          <p>Artifact에서「지식으로 추가」하거나 후보를 만들 수 있습니다.</p>
        </div>
      ) : (
        <ul className={styles.cardList}>
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className={styles.card}
                onClick={() => selectKnowledge(item.id)}
              >
                <div className={styles.cardTop}>
                  <strong>{item.title}</strong>
                  <em>{KNOWLEDGE_STATUS_LABEL[item.status]}</em>
                </div>
                <div className={styles.cardMeta}>
                  <span>{KNOWLEDGE_CATEGORY_LABEL[item.category]}</span>
                  <span>v{item.version}</span>
                  <span>{new Date(item.updatedAt).toLocaleString()}</span>
                </div>
                <p className={styles.cardSummary}>
                  {item.content.replace(/\s+/g, ' ').slice(0, 160)}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
