import { useEffect, useMemo, useState } from 'react'
import { FileText } from 'lucide-react'
import { fetchProjectArtifacts } from '../api/client'
import type { Artifact, ArtifactType } from '../domain/types'
import {
  ARTIFACT_FILTERS,
  ARTIFACT_TYPE_LABEL,
  artifactIcon,
} from '../domain/artifactUi'
import { ArtifactDetailPanel } from '../panels/ArtifactDetailPanel'
import { t } from '../i18n/ko'
import {
  selectActiveProject,
  useDeckStore,
} from '../store/useDeckStore'
import md from './MasterDetail.module.css'

export function ArtifactsPage() {
  const project = useDeckStore(selectActiveProject)
  const tasks = useDeckStore((s) => s.tasks)
  const registry = useDeckStore((s) => s.registry)
  const selectedArtifactId = useDeckStore((s) => s.selectedArtifactId)
  const selectArtifact = useDeckStore((s) => s.selectArtifact)
  const setNav = useDeckStore((s) => s.setNav)
  const [filter, setFilter] = useState<'all' | ArtifactType>('all')
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<Artifact[]>([])
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
    void fetchProjectArtifacts(project.id, {
      type: filter === 'all' ? undefined : filter,
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
    return () => {
      cancelled = true
    }
  }, [project?.id, filter])

  const taskTitle = useMemo(() => {
    const map = new Map(tasks.map((t) => [t.id, t.title]))
    return (id?: string) => (id ? map.get(id) ?? id : '—')
  }, [tasks])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter(
      (a) =>
        a.title.toLowerCase().includes(q) ||
        a.summary.toLowerCase().includes(q) ||
        ARTIFACT_TYPE_LABEL[a.type].toLowerCase().includes(q),
    )
  }, [items, query])

  useEffect(() => {
    if (visible.length === 0) return
    if (!selectedArtifactId || !visible.some((a) => a.id === selectedArtifactId)) {
      selectArtifact(visible[0]!.id)
    }
  }, [visible, selectedArtifactId, selectArtifact])

  if (!project) {
    return (
      <div className={md.split}>
        <div className={md.listPane}>
          <header className={md.head}>
            <h1>{t('artifacts.title')}</h1>
            <p>프로젝트를 선택하면 결과물을 볼 수 있습니다.</p>
          </header>
          <div className={md.empty}>
            <FileText size={28} />
            <h2>{t('project.noActive')}</h2>
            <p>프로젝트를 먼저 만들거나 선택하세요.</p>
            <button
              type="button"
              className={md.emptyBtn}
              onClick={() => setNav('projects')}
            >
              프로젝트로 이동
            </button>
          </div>
        </div>
        <div className={md.detailPane} />
      </div>
    )
  }

  return (
    <div className={md.split}>
      <div className={md.listPane}>
        <header className={md.head}>
          <h1>{t('artifacts.title')}</h1>
          <p>
            {project.name} — {t('artifacts.subtitle')}
          </p>
        </header>

        <input
          className={md.search}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="결과물 검색"
          aria-label="결과물 검색"
        />

        <div className={md.filters}>
          {ARTIFACT_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={filter === f.id ? md.filterOn : md.filter}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>

        {loading ? <p className={md.meta} style={{ padding: 14 }}>불러오는 중…</p> : null}
        {error ? <p className={md.meta} style={{ padding: 14, color: '#b91c1c' }}>{error}</p> : null}

        {!loading && visible.length === 0 ? (
          <div className={md.empty}>
            <FileText size={28} />
            <h2>{t('artifacts.empty')}</h2>
            <p>작업을 완료하면 결과물이 여기에 저장됩니다.</p>
          </div>
        ) : (
          <ul className={md.list}>
            {visible.map((a) => {
              const agent =
                registry.find((r) => r.id === a.agentId)?.name ??
                a.agentId ??
                '—'
              return (
                <li key={a.id}>
                  <button
                    type="button"
                    className={
                      selectedArtifactId === a.id ? md.rowOn : md.row
                    }
                    onClick={() => selectArtifact(a.id)}
                  >
                    <strong>
                      {artifactIcon(a.type)} {a.title}
                    </strong>
                    <span className={md.meta}>
                      {ARTIFACT_TYPE_LABEL[a.type]} · v{a.version} · {agent}
                    </span>
                    <span className={md.meta}>{taskTitle(a.taskId)}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div className={md.detailPane}>
        <ArtifactDetailPanel embedded />
      </div>
    </div>
  )
}
