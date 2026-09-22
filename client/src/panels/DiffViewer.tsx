import { useMemo, useState } from 'react'
import styles from './DiffViewer.module.css'

interface Props {
  diffByFile?: Record<string, string>
  unifiedDiff?: string
  added?: string[]
  modified?: string[]
  deleted?: string[]
  changedFiles?: string[]
}

const COLLAPSE_LINES = 80

export function DiffViewer({
  diffByFile,
  unifiedDiff,
  added = [],
  modified = [],
  deleted = [],
  changedFiles = [],
}: Props) {
  const files = useMemo(() => {
    const fromMap = Object.keys(diffByFile ?? {})
    const list = fromMap.length > 0 ? fromMap : changedFiles
    return [...new Set(list)].sort()
  }, [diffByFile, changedFiles])

  const [selected, setSelected] = useState<string | null>(files[0] ?? null)
  const [expanded, setExpanded] = useState(false)

  const active = selected && files.includes(selected) ? selected : files[0] ?? null
  const raw =
    (active && diffByFile?.[active]) ||
    (!diffByFile && unifiedDiff) ||
    ''
  const lines = raw.split('\n')
  const collapsed = !expanded && lines.length > COLLAPSE_LINES
  const shown = collapsed ? lines.slice(0, COLLAPSE_LINES) : lines

  function kindOf(f: string): string {
    if (added.includes(f)) return 'added'
    if (deleted.includes(f)) return 'deleted'
    if (modified.includes(f)) return 'modified'
    return 'changed'
  }

  if (files.length === 0 && !unifiedDiff) {
    return <p className={styles.empty}>표시할 Diff가 없습니다.</p>
  }

  return (
    <div className={styles.wrap}>
      <ul className={styles.files}>
        {files.map((f) => (
          <li key={f}>
            <button
              type="button"
              data-active={active === f || undefined}
              data-kind={kindOf(f)}
              onClick={() => {
                setSelected(f)
                setExpanded(false)
              }}
            >
              <span className={styles.kind}>{kindLabel(kindOf(f))}</span>
              <code>{f}</code>
            </button>
          </li>
        ))}
      </ul>
      <pre className={styles.diff}>
        {shown.map((line, i) => (
          <span
            key={i}
            className={
              line.startsWith('+') && !line.startsWith('+++')
                ? styles.add
                : line.startsWith('-') && !line.startsWith('---')
                  ? styles.del
                  : line.startsWith('@@')
                    ? styles.hunk
                    : undefined
            }
          >
            {line}
            {'\n'}
          </span>
        ))}
        {collapsed ? (
          <button type="button" className={styles.more} onClick={() => setExpanded(true)}>
            … {lines.length - COLLAPSE_LINES}줄 더 보기
          </button>
        ) : null}
      </pre>
    </div>
  )
}

function kindLabel(k: string): string {
  if (k === 'added') return '+'
  if (k === 'deleted') return '−'
  if (k === 'modified') return '~'
  return '•'
}
