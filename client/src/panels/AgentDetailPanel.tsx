import { useState } from 'react'
import { X } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { getDepartment } from '../domain/departments'
import { displayAgentDescription, displayAgentName, t } from '../i18n'
import {
  selectActiveProject,
  selectTeamAgents,
  useDeckStore,
} from '../store/useDeckStore'
import styles from './AgentDetailPanel.module.css'

export function AgentDetailPanel({
  embedded = false,
  agentId,
}: {
  embedded?: boolean
  /** When set, use this id instead of store selection */
  agentId?: string | null
} = {}) {
  const selectedAgentId = useDeckStore((s) => s.selectedAgentId)
  const selectAgent = useDeckStore((s) => s.selectAgent)
  const team = useDeckStore(useShallow(selectTeamAgents))
  const registry = useDeckStore((s) => s.registry)
  const project = useDeckStore(selectActiveProject)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const id = agentId !== undefined ? agentId : selectedAgentId
  const agent =
    team.find((a) => a.id === id) ?? registry.find((a) => a.id === id)

  if (!agent) return null

  const dept = getDepartment(agent.division)
  const inTeam = Boolean(project?.agentIds.includes(agent.id))
  const name = displayAgentName(agent.id, agent.name)
  const description = displayAgentDescription(
    agent.id,
    agent.name,
    agent.description,
    dept.label,
  )
  const statusKey = `status.${agent.status}`
  const statusLabel = t(statusKey) === statusKey ? agent.status : t(statusKey)
  const showOriginal =
    agent.description.trim().length > 0 &&
    agent.description !== description &&
    !/[가-힣]/.test(agent.description)

  const body = (
    <>
      <header className={styles.head}>
        <div
          className={styles.avatar}
          style={{ background: `${dept.color}22`, color: dept.color }}
        >
          {name.slice(0, 1)}
        </div>
        <div className={styles.headText}>
          <h2>{name}</h2>
          <p>
            {dept.label}
            {agent.name !== name ? ` · ${agent.name}` : ''}
          </p>
        </div>
        <button
          type="button"
          className={styles.close}
          onClick={() => selectAgent(null)}
        >
          <X size={16} />
        </button>
      </header>

      <dl className={styles.meta}>
        <div>
          <dt>상태</dt>
          <dd data-status={agent.status}>{statusLabel}</dd>
        </div>
        <div>
          <dt>부서</dt>
          <dd>{dept.label}</dd>
        </div>
        <div>
          <dt>사용</dt>
          <dd>{agent.enabled ? '예' : '아니오'}</dd>
        </div>
        <div>
          <dt>현재 작업</dt>
          <dd>{agent.currentTaskLabel ?? '—'}</dd>
        </div>
        <div>
          <dt>프로젝트</dt>
          <dd>{inTeam ? (project?.name ?? '—') : '—'}</dd>
        </div>
      </dl>

      <section className={styles.desc}>
        <h3>역할 설명</h3>
        <p>{description}</p>
        {showOriginal ? (
          <details className={styles.original}>
            <summary>원문 (영어)</summary>
            <p>{agent.description}</p>
          </details>
        ) : null}
      </section>

      <section className={styles.desc}>
        <button
          type="button"
          className={styles.advancedToggle}
          onClick={() => setShowAdvanced((v) => !v)}
        >
          {showAdvanced ? '고급 정보 숨기기' : '고급 / 지시문 보기'}
        </button>
        {showAdvanced ? (
          <p className={styles.advancedNote}>
            레지스트리 ID: <code>{agent.id}</code>
            <br />
            전체 developer_instructions는 Codex 에이전트 파일에 있습니다.
          </p>
        ) : null}
      </section>
    </>
  )

  if (embedded) {
    return (
      <section className={styles.embedded} aria-label="에이전트 상세">
        {body}
      </section>
    )
  }

  return (
    <div className={styles.overlay} role="dialog" aria-modal aria-label="에이전트 상세">
      <button
        type="button"
        className={styles.backdrop}
        aria-label={t('actions.close')}
        onClick={() => selectAgent(null)}
      />
      <aside className={styles.panel}>{body}</aside>
    </div>
  )
}
