import { useMemo, useState } from 'react'
import { Search, Check, ChevronDown, ChevronUp } from 'lucide-react'
import type { Agent, DivisionId } from '../domain/types'
import { DEPARTMENTS } from '../domain/departments'
import { groupAgentsByDepartment } from '../domain/groupAgents'
import { displayAgentDescription, displayAgentName } from '../i18n'
import styles from './AgentPicker.module.css'

interface Props {
  registry: Agent[]
  selectedIds: string[]
  onToggle: (agentId: string) => void
  /** When true, list only selected agents */
  selectedOnlyDefault?: boolean
}

export function AgentPicker({
  registry,
  selectedIds,
  onToggle,
  selectedOnlyDefault = false,
}: Props) {
  const [query, setQuery] = useState('')
  const [division, setDivision] = useState<DivisionId | 'all'>('all')
  const [selectedOnly, setSelectedOnly] = useState(selectedOnlyDefault)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [collapsedDepts, setCollapsedDepts] = useState<Set<string>>(
    () => new Set(),
  )
  const selected = useMemo(() => new Set(selectedIds), [selectedIds])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return registry.filter((a) => {
      if (selectedOnly && !selected.has(a.id)) return false
      if (division !== 'all' && a.division !== division) return false
      if (!q) return true
      const label = displayAgentName(a.id, a.name).toLowerCase()
      return (
        label.includes(q) ||
        a.name.toLowerCase().includes(q) ||
        a.id.includes(q) ||
        a.description.toLowerCase().includes(q) ||
        a.division.includes(q)
      )
    })
  }, [registry, query, division, selectedOnly, selected])

  const groups = useMemo(
    () => groupAgentsByDepartment(filtered),
    [filtered],
  )

  function toggleExpand(id: string) {
    setExpandedId((prev) => (prev === id ? null : id))
  }

  function toggleDept(id: string) {
    setCollapsedDepts((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className={styles.picker}>
      <div className={styles.toolbar}>
        <label className={styles.search}>
          <Search size={14} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="이름 · 역할 · 설명 검색…"
          />
        </label>
        <select
          value={division}
          onChange={(e) =>
            setDivision(e.target.value as DivisionId | 'all')
          }
        >
          <option value="all">모든 부서</option>
          {DEPARTMENTS.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </select>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={selectedOnly}
            onChange={(e) => setSelectedOnly(e.target.checked)}
          />
          선택만 보기
        </label>
      </div>

      <div className={styles.meta}>
        {filtered.length}명 · {selectedIds.length}명 선택 · 부서{' '}
        {groups.length}개
        <span className={styles.metaHint}>
          · 이름을 누르면 역할 설명이 펼쳐집니다
        </span>
      </div>

      <div className={styles.groups}>
        {groups.length === 0 ? (
          <p className={styles.empty}>조건에 맞는 에이전트가 없습니다.</p>
        ) : (
          groups.map((g) => {
            const collapsed = collapsedDepts.has(g.division)
            const selectedInGroup = g.agents.filter((a) =>
              selected.has(a.id),
            ).length
            return (
              <section key={g.division} className={styles.group}>
                <button
                  type="button"
                  className={styles.groupHead}
                  style={{ ['--dept' as string]: g.color }}
                  onClick={() => toggleDept(g.division)}
                  aria-expanded={!collapsed}
                >
                  <span className={styles.groupDot} />
                  <strong>{g.label}</strong>
                  <em>
                    {g.agents.length}명
                    {selectedInGroup > 0 ? ` · 선택 ${selectedInGroup}` : ''}
                  </em>
                  {collapsed ? (
                    <ChevronDown size={14} />
                  ) : (
                    <ChevronUp size={14} />
                  )}
                </button>

                {!collapsed ? (
                  <ul className={styles.list}>
                    {g.agents.map((agent) => {
                      const isOn = selected.has(agent.id)
                      const label = displayAgentName(agent.id, agent.name)
                      const koDesc = displayAgentDescription(
                        agent.id,
                        agent.name,
                        agent.description,
                        g.label,
                      )
                      const showOriginal =
                        agent.name.trim().length > 0 &&
                        agent.name.toLowerCase() !== label.toLowerCase()
                      const expanded = expandedId === agent.id

                      return (
                        <li
                          key={agent.id}
                          className={
                            expanded ? styles.itemExpanded : undefined
                          }
                        >
                          <div className={isOn ? styles.rowOn : styles.row}>
                            <button
                              type="button"
                              className={styles.mainHit}
                              onClick={() => toggleExpand(agent.id)}
                              aria-expanded={expanded}
                            >
                              <span
                                className={styles.avatar}
                                style={{
                                  background: `${g.color}22`,
                                  color: g.color,
                                }}
                              >
                                {label.slice(0, 1)}
                              </span>
                              <span className={styles.info}>
                                <strong>{label}</strong>
                                {showOriginal ? (
                                  <em style={{ color: g.color }}>
                                    {agent.name}
                                  </em>
                                ) : null}
                                {!expanded ? (
                                  <span className={styles.preview}>
                                    {koDesc}
                                  </span>
                                ) : null}
                              </span>
                              <span className={styles.expandIcon} aria-hidden>
                                {expanded ? (
                                  <ChevronUp size={14} />
                                ) : (
                                  <ChevronDown size={14} />
                                )}
                              </span>
                            </button>
                            <button
                              type="button"
                              className={isOn ? styles.tickOn : styles.tick}
                              aria-label={
                                isOn
                                  ? `${label} 선택 해제`
                                  : `${label} 팀에 추가`
                              }
                              aria-pressed={isOn}
                              onClick={() => onToggle(agent.id)}
                            >
                              {isOn ? (
                                <Check size={14} strokeWidth={3} />
                              ) : null}
                            </button>
                          </div>

                          {expanded ? (
                            <div className={styles.detail}>
                              <p className={styles.detailDesc}>{koDesc}</p>
                              {agent.description &&
                              agent.description !== koDesc &&
                              !/[가-힣]/.test(agent.description) ? (
                                <details className={styles.original}>
                                  <summary>원문 (영어)</summary>
                                  <p>{agent.description}</p>
                                </details>
                              ) : null}
                              <dl className={styles.detailMeta}>
                                <div>
                                  <dt>원본 이름</dt>
                                  <dd>{agent.name}</dd>
                                </div>
                                <div>
                                  <dt>ID</dt>
                                  <dd>
                                    <code>{agent.id}</code>
                                  </dd>
                                </div>
                                <div>
                                  <dt>부서</dt>
                                  <dd>{g.label}</dd>
                                </div>
                              </dl>
                              <button
                                type="button"
                                className={
                                  isOn
                                    ? styles.detailRemove
                                    : styles.detailAdd
                                }
                                onClick={() => onToggle(agent.id)}
                              >
                                {isOn ? '팀에서 제외' : '팀에 추가'}
                              </button>
                            </div>
                          ) : null}
                        </li>
                      )
                    })}
                  </ul>
                ) : null}
              </section>
            )
          })
        )}
      </div>
    </div>
  )
}
