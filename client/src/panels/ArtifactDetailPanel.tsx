import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { createKnowledge, fetchArtifactDetail } from '../api/client'
import type { Artifact, KnowledgeCategory } from '../domain/types'
import { ARTIFACT_TYPE_LABEL, artifactIcon } from '../domain/artifactUi'
import { KNOWLEDGE_CATEGORY_LABEL } from '../domain/knowledgeUi'
import { t } from '../i18n/ko'
import { MarkdownView } from '../components/MarkdownView'
import {
  selectActiveProject,
  useDeckStore,
} from '../store/useDeckStore'
import styles from '../panels/TaskDetailPanel.module.css'

const CATEGORIES = Object.keys(KNOWLEDGE_CATEGORY_LABEL) as KnowledgeCategory[]

export function ArtifactDetailPanel({
  embedded = false,
}: {
  embedded?: boolean
}) {
  const project = useDeckStore(selectActiveProject)
  const artifactId = useDeckStore((s) => s.selectedArtifactId)
  const selectArtifact = useDeckStore((s) => s.selectArtifact)
  const selectKnowledge = useDeckStore((s) => s.selectKnowledge)
  const selectTask = useDeckStore((s) => s.selectTask)
  const setNav = useDeckStore((s) => s.setNav)
  const registry = useDeckStore((s) => s.registry)
  const tasks = useDeckStore((s) => s.tasks)
  const [artifact, setArtifact] = useState<Artifact | null>(null)
  const [versions, setVersions] = useState<Artifact[]>([])
  const [error, setError] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [knTitle, setKnTitle] = useState('')
  const [knContent, setKnContent] = useState('')
  const [knCategory, setKnCategory] = useState<KnowledgeCategory>('product')
  const [knMsg, setKnMsg] = useState<string | null>(null)

  useEffect(() => {
    if (!project || !artifactId) {
      setArtifact(null)
      setVersions([])
      setAddOpen(false)
      return
    }
    let cancelled = false
    void fetchArtifactDetail(project.id, artifactId)
      .then((res) => {
        if (cancelled) return
        setArtifact(res.artifact)
        setVersions(res.versions)
        setError(null)
        setKnTitle(res.artifact.title)
        setKnContent(res.artifact.content)
        setKnCategory(
          /research|조사/.test(res.artifact.type)
            ? 'research'
            : /design|디자인/.test(res.artifact.type)
              ? 'design'
              : 'product',
        )
        setKnMsg(null)
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [project?.id, artifactId])

  if (!artifactId || !artifact) {
    if (embedded) {
      return (
        <div className={styles.embeddedEmpty}>
          <p>결과물을 선택하면 상세가 여기에 표시됩니다.</p>
          <span>내용 · 출처 · 버전 · 프로젝트 지식 확정을 확인합니다.</span>
        </div>
      )
    }
    return null
  }

  const agent =
    registry.find((r) => r.id === artifact.agentId)?.name ??
    artifact.agentId ??
    '—'
  const task = tasks.find((t) => t.id === artifact.taskId)

  return (
    <aside
      className={embedded ? styles.embeddedPanel : styles.panel}
      aria-label={t('artifacts.detail')}
    >
      <header className={styles.head}>
        <div>
          <h2>
            {artifactIcon(artifact.type)} {artifact.title}
          </h2>
          <p>
            {ARTIFACT_TYPE_LABEL[artifact.type]} · v{artifact.version} ·{' '}
            {artifact.status}
          </p>
        </div>
        {!embedded ? (
          <button
            type="button"
            className={styles.close}
            onClick={() => selectArtifact(null)}
            aria-label="닫기"
          >
            <X size={16} />
          </button>
        ) : null}
      </header>

      <div className={styles.body}>
        {error ? <p className={styles.warn}>{error}</p> : null}

        <section className={styles.section}>
          <h3>{t('artifacts.sourceAgent')}</h3>
          <p>{agent}</p>
          <h3>{t('artifacts.sourceTask')}</h3>
          <p>
            {task ? (
              <button
                type="button"
                className={styles.linkBtn}
                onClick={() => {
                  selectTask(task.id)
                  setNav('tasks')
                }}
              >
                {task.title}
              </button>
            ) : (
              artifact.taskId ?? '—'
            )}
          </p>
          <p className={styles.meta}>
            {new Date(artifact.createdAt).toLocaleString()} ·{' '}
            {t('artifacts.version')} {artifact.version}
          </p>
        </section>

        <section className={styles.section}>
          <h3>{t('artifacts.viewContent')}</h3>
          {artifact.contentType === 'markdown' ||
          artifact.contentType === 'text' ||
          artifact.contentType === 'diff' ? (
            <MarkdownView content={artifact.content} />
          ) : (
            <pre className={styles.resultPre}>{artifact.content}</pre>
          )}
        </section>

        {(() => {
          const raw = artifact.metadata?.changedFiles
          const files = Array.isArray(raw)
            ? raw.filter((x): x is string => typeof x === 'string')
            : []
          if (files.length === 0) return null
          return (
            <section className={styles.section}>
              <h3>변경 파일</h3>
              <ul className={styles.runList}>
                {files.map((f) => (
                  <li key={f}>
                    <code>{f}</code>
                  </li>
                ))}
              </ul>
            </section>
          )
        })()}

        {artifact.sources && artifact.sources.length > 0 ? (
          <section className={styles.section}>
            <h3>출처</h3>
            {artifact.searchedAt ? (
              <p className={styles.meta}>
                검색 시각: {new Date(artifact.searchedAt).toLocaleString()}
              </p>
            ) : null}
            <ul className={styles.runList}>
              {artifact.sources.map((s, i) => (
                <li key={s.id || s.url}>
                  <strong>
                    [{i + 1}] {s.title}
                  </strong>
                  <div className={styles.meta}>
                    {s.domain}
                    {s.publishedAt ? ` · ${s.publishedAt}` : ''}
                    {s.quality ? ` · ${s.quality}` : ''}
                  </div>
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className={styles.linkBtn}
                  >
                    {s.url}
                  </a>
                  {s.snippet ? (
                    <p className={styles.meta}>{s.snippet}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {versions.length > 1 ? (
          <section className={styles.section}>
            <h3>{t('artifacts.previousVersions')}</h3>
            <ul className={styles.runList}>
              {versions.map((v) => (
                <li key={v.id}>
                  <button
                    type="button"
                    className={styles.linkBtn}
                    onClick={() => selectArtifact(v.id)}
                  >
                    v{v.version} — {new Date(v.updatedAt).toLocaleString()}
                    {v.id === artifact.id ? ' (현재)' : ''}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.primary}
            onClick={() => {
              setNav('tasks')
              if (task) selectTask(task.id)
            }}
          >
            {t('artifacts.useInWork')}
          </button>
          <button type="button" onClick={() => setAddOpen((v) => !v)}>
            프로젝트 지식으로 확정
          </button>
        </div>

        {addOpen && project ? (
          <section className={styles.section}>
            <h3>지식 후보 만들기</h3>
            <p className={styles.meta}>
              AI 없이 수동으로 proposed Knowledge를 생성합니다.
            </p>
            <label className={styles.meta}>
              카테고리
              <select
                value={knCategory}
                onChange={(e) =>
                  setKnCategory(e.target.value as KnowledgeCategory)
                }
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {KNOWLEDGE_CATEGORY_LABEL[c]}
                  </option>
                ))}
              </select>
            </label>
            <input
              value={knTitle}
              onChange={(e) => setKnTitle(e.target.value)}
              placeholder="제목"
              style={{ width: '100%', marginTop: 8 }}
            />
            <textarea
              value={knContent}
              onChange={(e) => setKnContent(e.target.value)}
              rows={8}
              style={{ width: '100%', marginTop: 8 }}
            />
            {knMsg ? <p className={styles.meta}>{knMsg}</p> : null}
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.primary}
                onClick={() => {
                  void createKnowledge(project.id, {
                    category: knCategory,
                    title: knTitle,
                    content: knContent,
                    createdBy: 'user',
                    sourceArtifactIds: [artifact.id],
                    sourceTaskIds: artifact.taskId ? [artifact.taskId] : [],
                    sourceIds: (artifact.sources ?? []).map((s) => s.id),
                  })
                    .then((res) => {
                      setKnMsg(
                        res.conflicts.length
                          ? `제안됨 (충돌 후보 ${res.conflicts.length}건) — 지식 저장소에서 확인`
                          : '제안됨 — 지식 저장소에서 확정하세요',
                      )
                      selectKnowledge(res.item.id)
                      setNav('projects')
                    })
                    .catch((err) =>
                      setKnMsg(
                        err instanceof Error ? err.message : String(err),
                      ),
                    )
                }}
              >
                제안으로 저장
              </button>
            </div>
          </section>
        ) : null}
      </div>
    </aside>
  )
}
