import { Fragment, type ReactNode } from 'react'
import styles from './MarkdownView.module.css'

/**
 * Small markdown renderer (no dependency, no innerHTML).
 * Blocks: headings, paragraphs, - / * / 1. lists, > quotes, ``` code, | tables, ---.
 * Inline: **bold**, *italic*, `code`, [text](https://…) links.
 */
export function MarkdownView({ content, compact = false }: { content: string; compact?: boolean }) {
  return <div className={compact ? `${styles.root} ${styles.compact}` : styles.root}>{renderBlocks(content)}</div>
}

type Block =
  | { kind: 'h'; level: number; text: string }
  | { kind: 'p'; text: string }
  | { kind: 'ul' | 'ol'; items: string[] }
  | { kind: 'quote'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'table'; rows: string[][] }
  | { kind: 'hr' }

function parse(content: string): Block[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const out: Block[] = []
  let para: string[] = []
  const flush = () => {
    if (para.length) out.push({ kind: 'p', text: para.join('\n') })
    para = []
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const t = line.trim()
    if (!t) { flush(); continue }
    if (t.startsWith('```')) {
      flush()
      const code: string[] = []
      while (++i < lines.length && !lines[i]!.trim().startsWith('```')) code.push(lines[i]!)
      out.push({ kind: 'code', text: code.join('\n') })
      continue
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(t)
    if (h) { flush(); out.push({ kind: 'h', level: h[1]!.length, text: h[2]! }); continue }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) { flush(); out.push({ kind: 'hr' }); continue }
    if (/^[-*•]\s+/.test(t) || /^\d+[.)]\s+/.test(t)) {
      flush()
      const ordered = /^\d+[.)]\s+/.test(t)
      const items: string[] = []
      while (i < lines.length) {
        const l = lines[i]!.trim()
        if (ordered ? /^\d+[.)]\s+/.test(l) : /^[-*•]\s+/.test(l)) items.push(l.replace(/^(\d+[.)]|[-*•])\s+/, ''))
        else if (l && items.length && /^\s{2,}/.test(lines[i]!)) items[items.length - 1] += ` ${l}`
        else break
        i++
      }
      i--
      out.push({ kind: ordered ? 'ol' : 'ul', items })
      continue
    }
    if (t.startsWith('>')) {
      flush()
      const q: string[] = []
      while (i < lines.length && lines[i]!.trim().startsWith('>')) q.push(lines[i++]!.trim().replace(/^>\s?/, ''))
      i--
      out.push({ kind: 'quote', text: q.join('\n') })
      continue
    }
    if (t.startsWith('|') && i + 1 < lines.length && /^\|?\s*:?-{2,}/.test(lines[i + 1]!.trim())) {
      flush()
      const rows: string[][] = []
      const cells = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
      rows.push(cells(t))
      i += 2
      while (i < lines.length && lines[i]!.trim().startsWith('|')) rows.push(cells(lines[i++]!))
      i--
      out.push({ kind: 'table', rows })
      continue
    }
    para.push(t)
  }
  flush()
  return out
}

function renderBlocks(content: string): ReactNode[] {
  return parse(content).map((b, i) => {
    switch (b.kind) {
      case 'h': return <h4 key={i} className={b.level <= 1 ? `${styles.h} ${styles.h1}` : styles.h}>{inline(b.text)}</h4>
      case 'p': return <p key={i} className={styles.p}>{inline(b.text)}</p>
      case 'ul': return <ul key={i} className={styles.ul}>{b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}</ul>
      case 'ol': return <ol key={i} className={styles.ul}>{b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}</ol>
      case 'quote': return <blockquote key={i} className={styles.quote}>{inline(b.text)}</blockquote>
      case 'code': return <pre key={i} className={styles.code}>{b.text}</pre>
      case 'hr': return <hr key={i} className={styles.hr} />
      case 'table':
        return (
          <div key={i} className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr>{b.rows[0]!.map((c, j) => <th key={j}>{inline(c)}</th>)}</tr></thead>
              <tbody>{b.rows.slice(1).map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k}>{inline(c)}</td>)}</tr>)}</tbody>
            </table>
          </div>
        )
    }
  })
}

const INLINE = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\[[^\]]+\]\((https?:\/\/[^\s)]+)\)|\*[^*\s][^*]*\*)/g

function inline(text: string): ReactNode {
  const parts: ReactNode[] = []
  let last = 0
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0
    if (at > last) parts.push(text.slice(last, at))
    const tok = m[0]
    if (tok.startsWith('**') || tok.startsWith('__')) parts.push(<strong key={at}>{tok.slice(2, -2)}</strong>)
    else if (tok.startsWith('`')) parts.push(<code key={at} className={styles.inlineCode}>{tok.slice(1, -1)}</code>)
    else if (tok.startsWith('[')) {
      const label = tok.slice(1, tok.indexOf(']'))
      parts.push(<a key={at} href={m[2]} target="_blank" rel="noreferrer noopener">{label}</a>)
    } else parts.push(<em key={at}>{tok.slice(1, -1)}</em>)
    last = at + tok.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts.map((p, i) => <Fragment key={i}>{p}</Fragment>)
}
