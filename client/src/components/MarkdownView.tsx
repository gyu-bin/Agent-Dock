import styles from './MarkdownView.module.css'

/** Lightweight markdown-ish renderer (no dependency). */
export function MarkdownView({ content }: { content: string }) {
  const blocks = content.split(/\n{2,}/)
  return (
    <div className={styles.root}>
      {blocks.map((block, i) => {
        const line = block.trim()
        if (!line) return null
        if (line.startsWith('```')) {
          const inner = line.replace(/^```\w*\n?/, '').replace(/\n?```$/, '')
          return (
            <pre key={i} className={styles.code}>
              {inner}
            </pre>
          )
        }
        if (/^#{1,3}\s/.test(line)) {
          const text = line.replace(/^#{1,3}\s+/, '')
          return (
            <h4 key={i} className={styles.h}>
              {text}
            </h4>
          )
        }
        if (/^[-*]\s/m.test(line)) {
          const items = line.split(/\n/).filter((l) => /^[-*]\s/.test(l))
          return (
            <ul key={i} className={styles.ul}>
              {items.map((it, j) => (
                <li key={j}>{it.replace(/^[-*]\s+/, '')}</li>
              ))}
            </ul>
          )
        }
        return (
          <p key={i} className={styles.p}>
            {line}
          </p>
        )
      })}
    </div>
  )
}
