import styles from './SpeechBubble.module.css'

export function SpeechBubble({
  text,
  tiny,
}: {
  text: string
  tiny?: boolean
}) {
  return (
    <div className={tiny ? styles.tiny : styles.bubble} role="note">
      {text}
    </div>
  )
}
