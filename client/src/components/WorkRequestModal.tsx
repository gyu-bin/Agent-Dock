import { useState } from 'react'
import { X } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import type { TaskPriority } from '../domain/types'
import { displayAgentName } from '../i18n/agentNames'
import { t } from '../i18n/ko'
import { useDeckStore, selectActiveProject, selectTeamAgents } from '../store/useDeckStore'
import styles from './WorkRequestModal.module.css'

export function WorkRequestModal() {
  const open = useDeckStore((s) => s.workRequestOpen)
  const close = useDeckStore((s) => s.closeWorkRequest)
  const createAndStartTask = useDeckStore((s) => s.createAndStartTask)
  const project = useDeckStore(selectActiveProject)
  const team = useDeckStore(useShallow(selectTeamAgents))

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<TaskPriority>('normal')
  const [preferredAgentId, setPreferredAgentId] = useState('')

  if (!open) return null

  function submit() {
    if (!title.trim() || !project) return
    createAndStartTask({
      title: title.trim(),
      description: description.trim(),
      priority,
      preferredAgentId: preferredAgentId || undefined,
      autoStart: true,
    })
    setTitle('')
    setDescription('')
    setPriority('normal')
    setPreferredAgentId('')
  }

  return (
    <div className={styles.overlay} role="dialog" aria-modal aria-label={t('task.newRequest')}>
      <button type="button" className={styles.backdrop} aria-label={t('actions.close')} onClick={close} />
      <div className={styles.modal}>
        <header className={styles.head}>
          <div>
            <h2>고급 작업 요청</h2>
            <p>일반적으로는 홈에서 자연어로 요청하세요. 이 화면은 우선순위·담당자를 직접 지정할 때만 사용합니다.</p>
          </div>
          <button type="button" className={styles.close} onClick={close}>
            <X size={16} />
          </button>
        </header>

        {!project ? (
          <p className={styles.warn}>먼저 프로젝트를 만들거나 선택해 주세요.</p>
        ) : (
          <div className={styles.body}>
            <label>
              작업 제목 / 요청
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="새 Steam 게임 아이디어를 조사해줘"
                autoFocus
              />
            </label>
            <label>
              설명 (선택)
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="추가 맥락…"
              />
            </label>
            <div className={styles.row}>
              <label>
                우선순위
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as TaskPriority)}
                >
                  <option value="low">낮음</option>
                  <option value="normal">보통</option>
                  <option value="high">높음</option>
                  <option value="urgent">긴급</option>
                </select>
              </label>
              <label>
                선호 에이전트 (선택)
                <select
                  value={preferredAgentId}
                  onChange={(e) => setPreferredAgentId(e.target.value)}
                >
                  <option value="">자동 (라우터)</option>
                  {team.map((a) => (
                    <option key={a.id} value={a.id}>
                      {displayAgentName(a.id, a.name)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className={styles.hint}>
              일반적으로는 홈 입력창을 사용하세요.
            </p>
          </div>
        )}

        <footer className={styles.foot}>
          <button type="button" className={styles.ghost} onClick={close}>
            {t('task.cancel')}
          </button>
          <button
            type="button"
            className={styles.primary}
            disabled={!project || !title.trim()}
            onClick={submit}
          >
            {t('task.start')}
          </button>
        </footer>
      </div>
    </div>
  )
}
