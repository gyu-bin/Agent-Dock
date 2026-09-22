import { useRef, useState } from 'react'
import { Send } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { userFacingTaskStatus } from '../domain/taskDisplay'
import {
  selectTasksForActive,
  useDeckStore,
} from '../store/useDeckStore'
import { t } from '../i18n'
import styles from './AiChatPanel.module.css'

export function AiChatPanel() {
  const chat = useDeckStore((s) => s.chat)
  const chatTab = useDeckStore((s) => s.chatTab)
  const setChatTab = useDeckStore((s) => s.setChatTab)
  const selectTask = useDeckStore((s) => s.selectTask)
  const setNav = useDeckStore((s) => s.setNav)
  const proposeWorkFromChat = useDeckStore((s) => s.proposeWorkFromChat)
  const createAndStartTask = useDeckStore((s) => s.createAndStartTask)
  const tasks = useDeckStore(useShallow(selectTasksForActive))
  const pipelineSteps = useDeckStore((s) => s.pipelineSteps)
  const [draft, setDraft] = useState('')
  const [showDetails, setShowDetails] = useState<Record<string, boolean>>({})
  const listRef = useRef<HTMLDivElement>(null)

  function send() {
    const text = draft.trim()
    if (!text) return
    proposeWorkFromChat(text)
    setDraft('')
    requestAnimationFrame(() => {
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
    })
  }

  return (
    <aside className={styles.panel} aria-label="작업 요청">
      <div className={styles.tabs}>
        <button
          type="button"
          className={chatTab === 'chat' ? styles.tabActive : styles.tab}
          onClick={() => setChatTab('chat')}
        >
          {t('task.askWhat')}
        </button>
        <button
          type="button"
          className={chatTab === 'history' ? styles.tabActive : styles.tab}
          onClick={() => setChatTab('history')}
        >
          작업 기록
        </button>
      </div>

      <div className={styles.body}>
        {chatTab === 'chat' ? (
          <div className={styles.messages} ref={listRef}>
            {chat.length === 0 ? (
              <div className={styles.historyEmpty}>
                <p>{t('task.askWhat')}</p>
                <span>{t('task.emptyOngoing')}</span>
              </div>
            ) : null}
            {chat.map((msg) => (
              <div
                key={msg.id}
                className={
                  msg.role === 'user'
                    ? styles.userMsg
                    : msg.role === 'system'
                      ? styles.systemMsg
                      : styles.assistantMsg
                }
              >
                {msg.role === 'assistant' ? (
                  <div className={styles.botAvatar} aria-hidden>
                    AI
                  </div>
                ) : null}
                <div className={styles.bubble}>
                  {msg.workProposal ? (
                    <div className={styles.proposal}>
                      <p className={styles.proposalTitle}>
                        {t('task.howWeProceed')}
                      </p>
                      <ol className={styles.previewList}>
                        {(
                          msg.workProposal.workflowPreview ??
                          msg.workProposal.stepLabels ??
                          []
                        ).map((label, i) => (
                          <li key={`${msg.id}-s-${i}`}>
                            <span>{i + 1}.</span> {stripPreviewPrefix(label)}
                          </li>
                        ))}
                      </ol>
                      <button
                        type="button"
                        className={styles.startWork}
                        onClick={() => {
                          createAndStartTask({
                            title: msg.workProposal!.title,
                            description: msg.workProposal!.description,
                            autoStart: true,
                            executionMode: msg.workProposal!.executionMode,
                            workflowTemplateId:
                              msg.workProposal!.workflowTemplateId,
                          })
                        }}
                      >
                        {t('task.start')}
                      </button>
                      <button
                        type="button"
                        className={styles.detailToggle}
                        onClick={() =>
                          setShowDetails((d) => ({
                            ...d,
                            [msg.id]: !d[msg.id],
                          }))
                        }
                      >
                        {showDetails[msg.id]
                          ? t('task.hideAdvanced')
                          : t('task.showAdvanced')}
                      </button>
                      {showDetails[msg.id] ? (
                        <p className={styles.detailNote}>
                          {msg.workProposal.workflowTemplateName
                            ? `${msg.workProposal.workflowTemplateName}\n`
                            : ''}
                          {msg.content}
                        </p>
                      ) : null}
                    </div>
                  ) : (
                    <p style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</p>
                  )}
                  {msg.taskResult ? (
                    <div className={styles.resultActions}>
                      <button
                        type="button"
                        className={styles.startWork}
                        onClick={() => {
                          selectTask(msg.taskResult!.taskId)
                          setNav('tasks')
                        }}
                      >
                        {t('task.viewResult')}
                      </button>
                      <button
                        type="button"
                        className={styles.secondaryLink}
                        onClick={() => setNav('documents')}
                      >
                        {t('task.viewArtifacts')}
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className={styles.historyList}>
            {tasks.length === 0 ? (
              <div className={styles.historyEmpty}>
                <p>아직 작업 기록이 없습니다</p>
                <span>{t('task.emptyOngoing')}</span>
              </div>
            ) : (
              <ul>
                {tasks.map((task) => {
                  const steps = pipelineSteps
                    .filter((s) => s.taskId === task.id)
                    .sort((a, b) => a.order - b.order)
                  const current = steps.find(
                    (s) =>
                      s.status === 'running' ||
                      s.status === 'reviewing' ||
                      s.status === 'awaiting_approval',
                  )
                  return (
                    <li key={task.id}>
                      <button
                        type="button"
                        onClick={() => {
                          selectTask(task.id)
                          setNav('tasks')
                        }}
                      >
                        <strong>{task.title}</strong>
                        <span>
                          {userFacingTaskStatus(task, current)} · {task.progress}%
                        </span>
                        <small>
                          {new Date(task.createdAt).toLocaleString()}
                          {task.finalResult ? ' · 결과 있음' : ''}
                        </small>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )}
      </div>

      <form
        className={styles.composer}
        onSubmit={(e) => {
          e.preventDefault()
          send()
        }}
      >
        <input
          id="ad-home-composer"
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="예: 로그인 기능 만들어줘"
          aria-label={t('task.askWhat')}
        />
        <button
          type="submit"
          className={styles.send}
          aria-label="보내기"
          disabled={!draft.trim()}
        >
          <Send size={14} />
        </button>
      </form>
    </aside>
  )
}

function stripPreviewPrefix(label: string): string {
  return label
    .replace(/^\d+[\.\)]\s*/, '')
    .replace(/^[👤💻🧪🔍✅]\s*/, '')
    .replace(/변경 승인/g, '변경 확인')
    .replace(/계획 승인/g, '계획 확인')
    .trim()
}
