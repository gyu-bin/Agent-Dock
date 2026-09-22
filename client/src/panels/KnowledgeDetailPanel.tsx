import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import {
  confirmKnowledge,
  fetchKnowledgeDetail,
  rejectKnowledge,
} from '../api/client'
import type { KnowledgeConflictCandidate, KnowledgeItem } from '../domain/types'
import {
  KNOWLEDGE_CATEGORY_LABEL,
  KNOWLEDGE_STATUS_LABEL,
} from '../domain/knowledgeUi'
import { MarkdownView } from '../components/MarkdownView'
import {
  selectActiveProject,
  useDeckStore,
} from '../store/useDeckStore'
import styles from '../panels/TaskDetailPanel.module.css'
import shell from './AgentDetailPanel.module.css'

export function KnowledgeDetailPanel() {
  const project = useDeckStore(selectActiveProject)
  const knowledgeId = useDeckStore((s) => s.selectedKnowledgeId)
  const selectKnowledge = useDeckStore((s) => s.selectKnowledge)
  const selectArtifact = useDeckStore((s) => s.selectArtifact)
  const setNav = useDeckStore((s) => s.setNav)
  const [item, setItem] = useState<KnowledgeItem | null>(null)
  const [versions, setVersions] = useState<KnowledgeItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editContent, setEditContent] = useState('')
  const [editing, setEditing] = useState(false)
  const [conflicts, setConflicts] = useState<KnowledgeConflictCandidate[]>([])
  const [busy, setBusy] = useState(false)

  const reload = async () => {
    if (!project || !knowledgeId) return
    const res = await fetchKnowledgeDetail(project.id, knowledgeId)
    setItem(res.item)
    setVersions(res.versions)
    setEditTitle(res.item.title)
    setEditContent(res.item.content)
    setError(null)
  }

  useEffect(() => {
    if (!project || !knowledgeId) {
      setItem(null)
      setVersions([])
      setConflicts([])
      return
    }
    let cancelled = false
    void reload().catch((err) => {
      if (!cancelled)
        setError(err instanceof Error ? err.message : String(err))
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, knowledgeId])

  if (!knowledgeId || !item || !project) return null

  const onConfirm = async (
    resolveConflicts?: 'keep-existing' | 'use-new' | 'keep-both',
  ) => {
    setBusy(true)
    try {
      const result = await confirmKnowledge(project.id, item.id, editing
        ? {
            title: editTitle,
            content: editContent,
            createdBy: 'user',
            resolveConflicts,
          }
        : resolveConflicts
          ? { resolveConflicts, createdBy: 'user' }
          : undefined)
      if (result.needsConflictResolution) {
        setConflicts(result.conflicts)
        return
      }
      setConflicts([])
      setEditing(false)
      selectKnowledge(result.item.id)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const onReject = async () => {
    setBusy(true)
    try {
      await rejectKnowledge(project.id, item.id, '사용자 거절')
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={shell.overlay} role="dialog" aria-modal aria-label="지식 상세">
      <button
        type="button"
        className={shell.backdrop}
        aria-label="닫기"
        onClick={() => selectKnowledge(null)}
      />
      <aside className={shell.panel}>
      <header className={styles.head}>
        <div>
          <h2>{item.title}</h2>
          <p>
            {KNOWLEDGE_CATEGORY_LABEL[item.category]} ·{' '}
            {KNOWLEDGE_STATUS_LABEL[item.status]} · v{item.version}
          </p>
        </div>
        <button
          type="button"
          className={styles.close}
          onClick={() => selectKnowledge(null)}
          aria-label="닫기"
        >
          <X size={16} />
        </button>
      </header>

      <div className={styles.body}>
        {error ? <p className={styles.warn}>{error}</p> : null}

        {item.status === 'proposed' ? (
          <section className={styles.section}>
            <h3>승인</h3>
            <p className={styles.meta}>
              제안 상태입니다. 확정된 지식만 Agent Context에 포함됩니다.
            </p>
            {editing ? (
              <>
                <input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  style={{ width: '100%', marginBottom: 8 }}
                />
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  rows={8}
                  style={{ width: '100%', marginBottom: 8 }}
                />
              </>
            ) : null}
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.primary}
                disabled={busy}
                onClick={() => void onConfirm()}
              >
                확정
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setEditing((v) => !v)}
              >
                {editing ? '수정 취소' : '수정 후 확정'}
              </button>
              {editing ? (
                <button
                  type="button"
                  className={styles.primary}
                  disabled={busy}
                  onClick={() => void onConfirm()}
                >
                  수정 내용으로 확정
                </button>
              ) : null}
              <button type="button" disabled={busy} onClick={() => void onReject()}>
                거절
              </button>
            </div>
          </section>
        ) : null}

        {conflicts.length > 0 ? (
          <section className={styles.section}>
            <h3>충돌 가능성</h3>
            {conflicts.map((c) => (
              <div key={c.existing.id} style={{ marginBottom: 12 }}>
                <p className={styles.meta}>{c.reason}</p>
                <p>
                  <strong>기존:</strong> {c.existing.title}
                </p>
                <pre className={styles.resultPre}>
                  {c.existing.content.slice(0, 400)}
                </pre>
                <p>
                  <strong>새 내용:</strong> {editTitle || item.title}
                </p>
                <pre className={styles.resultPre}>
                  {(editContent || item.content).slice(0, 400)}
                </pre>
              </div>
            ))}
            <div className={styles.actions}>
              <button
                type="button"
                disabled={busy}
                onClick={() => void onConfirm('keep-existing')}
              >
                기존 유지
              </button>
              <button
                type="button"
                className={styles.primary}
                disabled={busy}
                onClick={() => void onConfirm('use-new')}
              >
                새 내용으로 변경
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void onConfirm('keep-both')}
              >
                둘 다 유지
              </button>
            </div>
          </section>
        ) : null}

        <section className={styles.section}>
          <h3>내용</h3>
          <MarkdownView content={item.content} />
          {item.note ? <p className={styles.meta}>메모: {item.note}</p> : null}
        </section>

        {item.sourceArtifactIds.length > 0 ? (
          <section className={styles.section}>
            <h3>출처 Artifact</h3>
            <ul className={styles.runList}>
              {item.sourceArtifactIds.map((id) => (
                <li key={id}>
                  <button
                    type="button"
                    className={styles.linkBtn}
                    onClick={() => {
                      setNav('documents')
                      selectArtifact(id)
                    }}
                  >
                    {id}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {item.sourceIds.length > 0 ? (
          <section className={styles.section}>
            <h3>웹 출처</h3>
            <p className={styles.meta}>{item.sourceIds.join(', ')}</p>
          </section>
        ) : null}

        {versions.length > 1 ? (
          <section className={styles.section}>
            <h3>버전 기록</h3>
            <ul className={styles.runList}>
              {versions.map((v) => (
                <li key={v.id}>
                  <button
                    type="button"
                    className={styles.linkBtn}
                    onClick={() => selectKnowledge(v.id)}
                  >
                    v{v.version} — {KNOWLEDGE_STATUS_LABEL[v.status]} —{' '}
                    {new Date(v.updatedAt).toLocaleString()}
                    {v.id === item.id ? ' (현재)' : ''}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </aside>
    </div>
  )
}
