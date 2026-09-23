import { useRef, useState } from 'react'
import { Send, Plus, Paperclip, Image, Folder, Link2, X } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { userFacingTaskStatus } from '../domain/taskDisplay'
import {
  selectActiveProject,
  selectTasksForActive,
  useDeckStore,
} from '../store/useDeckStore'
import {
  stageAttachmentFile,
  stageAttachmentFolder,
  stageAttachmentUrl,
  deleteAttachment,
  type WorkAttachmentDto,
} from '../api/client'
import {
  isBlockedUrlScheme,
} from '../domain/attachments/githubParser'
import { t } from '../i18n'
import styles from './AiChatPanel.module.css'

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result ?? '')
      const i = result.indexOf(',')
      resolve(i >= 0 ? result.slice(i + 1) : result)
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`
  return `${(n / (1024 * 1024)).toFixed(1)}MB`
}

export function AiChatPanel() {
  const chat = useDeckStore((s) => s.chat)
  const chatTab = useDeckStore((s) => s.chatTab)
  const setChatTab = useDeckStore((s) => s.setChatTab)
  const selectTask = useDeckStore((s) => s.selectTask)
  const setNav = useDeckStore((s) => s.setNav)
  const proposeWorkFromChat = useDeckStore((s) => s.proposeWorkFromChat)
  const createAndStartTask = useDeckStore((s) => s.createAndStartTask)
  const project = useDeckStore(selectActiveProject)
  const tasks = useDeckStore(useShallow(selectTasksForActive))
  const pipelineSteps = useDeckStore((s) => s.pipelineSteps)
  const [draft, setDraft] = useState('')
  const [showDetails, setShowDetails] = useState<Record<string, boolean>>({})
  const [menuOpen, setMenuOpen] = useState(false)
  const [attachments, setAttachments] = useState<WorkAttachmentDto[]>([])
  const [stagingId] = useState(
    () => `stg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
  )
  const [busy, setBusy] = useState(false)
  const [attachError, setAttachError] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)

  async function addFiles(files: FileList | File[], source: string) {
    if (!project) {
      setAttachError('활성 Project가 필요합니다.')
      return
    }
    setBusy(true)
    setAttachError(null)
    try {
      for (const file of Array.from(files)) {
        const bytesBase64 = await fileToBase64(file)
        const att = await stageAttachmentFile(project.id, {
          name: file.name,
          mimeType: file.type || undefined,
          bytesBase64,
          stagingId,
          source,
        })
        setAttachments((prev) => [...prev, att])
      }
    } catch (err) {
      setAttachError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
      setMenuOpen(false)
    }
  }

  async function addLink() {
    if (!project) {
      setAttachError('활성 Project가 필요합니다.')
      return
    }
    const url = window.prompt('링크 URL (http/https)')
    if (!url?.trim()) return
    if (isBlockedUrlScheme(url)) {
      setAttachError('http/https URL만 첨부할 수 있습니다.')
      return
    }
    setBusy(true)
    setAttachError(null)
    try {
      const att = await stageAttachmentUrl(project.id, {
        url: url.trim(),
        stagingId,
      })
      setAttachments((prev) => [...prev, att])
    } catch (err) {
      setAttachError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
      setMenuOpen(false)
    }
  }

  async function addFolder() {
    if (!project) {
      setAttachError('활성 Project가 필요합니다.')
      return
    }
    const folderPath = window.prompt(
      '로컬 폴더 절대 경로 (브라우저만으로는 경로를 알 수 없습니다)',
    )
    if (!folderPath?.trim()) {
      setAttachError('로컬 폴더 선택이 필요합니다.')
      return
    }
    setBusy(true)
    setAttachError(null)
    try {
      const att = await stageAttachmentFolder(project.id, {
        path: folderPath.trim(),
        stagingId,
      })
      setAttachments((prev) => [...prev, att])
    } catch (err) {
      setAttachError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
      setMenuOpen(false)
    }
  }

  async function removeAttachment(id: string) {
    if (!project) return
    setAttachments((prev) => prev.filter((a) => a.id !== id))
    try {
      await deleteAttachment(project.id, id)
    } catch {
      /* ignore */
    }
  }

  function send() {
    const text = draft.trim()
    if (!text && attachments.length === 0) return
    proposeWorkFromChat(text, {
      attachmentIds: attachments.map((a) => a.id),
      attachmentStagingId: stagingId,
    })
    setDraft('')
    setAttachments([])
    setAttachError(null)
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
                      {msg.workProposal.attachmentIds?.length ? (
                        <p className={styles.proposalName}>
                          첨부 {msg.workProposal.attachmentIds.length}개
                        </p>
                      ) : null}
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
                            attachmentIds: msg.workProposal!.attachmentIds,
                            attachmentStagingId:
                              msg.workProposal!.attachmentStagingId,
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

      {attachments.length > 0 ? (
        <div className={styles.attachChips} aria-label="첨부">
          {attachments.map((a) => (
            <div key={a.id} className={styles.attachChip}>
              <span className={styles.attachKind}>
                {a.kind === 'image'
                  ? '🖼'
                  : a.kind === 'github'
                    ? 'GH'
                    : a.kind === 'web-url'
                      ? 'URL'
                      : a.kind === 'local-folder'
                        ? 'DIR'
                        : 'FILE'}
              </span>
              <span className={styles.attachName} title={a.name}>
                {a.name}
              </span>
              {a.bytes != null ? (
                <span className={styles.attachMeta}>{formatBytes(a.bytes)}</span>
              ) : null}
              <button
                type="button"
                className={styles.attachRemove}
                aria-label="첨부 제거"
                onClick={() => void removeAttachment(a.id)}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {attachError ? <p className={styles.attachError}>{attachError}</p> : null}

      <form
        className={styles.composer}
        onSubmit={(e) => {
          e.preventDefault()
          send()
        }}
        onDragOver={(e) => {
          e.preventDefault()
        }}
        onDrop={(e) => {
          e.preventDefault()
          if (e.dataTransfer.files?.length) {
            void addFiles(e.dataTransfer.files, 'drag-drop')
          }
        }}
      >
        <div className={styles.attachMenuWrap}>
          <button
            type="button"
            className={styles.attachPlus}
            aria-label="첨부 추가"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
            disabled={busy || !project}
          >
            <Plus size={16} />
          </button>
          {menuOpen ? (
            <div className={styles.attachMenu} role="menu">
              <button
                type="button"
                role="menuitem"
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip size={14} /> 파일
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => imageInputRef.current?.click()}
              >
                <Image size={14} /> 이미지
              </button>
              <button type="button" role="menuitem" onClick={() => void addFolder()}>
                <Folder size={14} /> 폴더
              </button>
              <button type="button" role="menuitem" onClick={() => void addLink()}>
                <Link2 size={14} /> 링크
              </button>
            </div>
          ) : null}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) void addFiles(e.target.files, 'upload')
            e.target.value = ''
          }}
        />
        <input
          ref={imageInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) void addFiles(e.target.files, 'upload')
            e.target.value = ''
          }}
        />
        <input
          id="ad-home-composer"
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onPaste={(e) => {
            const items = e.clipboardData?.items
            if (!items) return
            const imageFiles: File[] = []
            for (const item of Array.from(items)) {
              if (item.type.startsWith('image/')) {
                const f = item.getAsFile()
                if (f) imageFiles.push(f)
              }
            }
            if (imageFiles.length) {
              e.preventDefault()
              void addFiles(imageFiles, 'clipboard')
            }
          }}
          placeholder="예: 로그인 기능 만들어줘"
          aria-label={t('task.askWhat')}
        />
        <button
          type="submit"
          className={styles.send}
          aria-label="보내기"
          disabled={(!draft.trim() && attachments.length === 0) || busy}
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
