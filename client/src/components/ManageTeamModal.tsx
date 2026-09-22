import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { setProjectTeam } from '../api/client'
import { useDeckStore, selectActiveProject } from '../store/useDeckStore'
import { AgentPicker } from './AgentPicker'
import { AgentDetailPanel } from '../panels/AgentDetailPanel'
import styles from './ProjectWizard.module.css'

export function ManageTeamModal() {
  const open = useDeckStore((s) => s.manageTeamOpen)
  const close = useDeckStore((s) => s.closeManageTeam)
  const project = useDeckStore(selectActiveProject)
  const registry = useDeckStore((s) => s.registry)
  const applyProjectsSnapshot = useDeckStore((s) => s.applyProjectsSnapshot)
  const selectedAgentId = useDeckStore((s) => s.selectedAgentId)
  const selectAgent = useDeckStore((s) => s.selectAgent)

  const [agentIds, setAgentIds] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open && project) {
      setAgentIds([...project.agentIds])
      setError(null)
    }
  }, [open, project])

  if (!open || !project) return null

  function toggle(id: string) {
    setAgentIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  function handleClose() {
    selectAgent(null)
    close()
  }

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const snap = await setProjectTeam(project!.id, agentIds)
      applyProjectsSnapshot(snap)
      handleClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.overlay} role="dialog" aria-modal aria-label="팀 관리">
      <button type="button" className={styles.backdrop} aria-label="닫기" onClick={handleClose} />
      <div className={styles.modal}>
        <header className={styles.head}>
          <div>
            <h2>팀 관리</h2>
            <p>{project.name}</p>
          </div>
          <button type="button" className={styles.close} onClick={handleClose}>
            <X size={16} />
          </button>
        </header>
        <div className={styles.body}>
          {selectedAgentId ? (
            <AgentDetailPanel embedded agentId={selectedAgentId} />
          ) : null}
          <AgentPicker registry={registry} selectedIds={agentIds} onToggle={toggle} />
          {error ? <p className={styles.error}>{error}</p> : null}
        </div>
        <footer className={styles.foot}>
          <button type="button" className={styles.ghost} onClick={handleClose}>
            취소
          </button>
          <button type="button" className={styles.primary} onClick={save} disabled={busy}>
            {busy ? '저장 중…' : `팀 저장 (${agentIds.length}명)`}
          </button>
        </footer>
      </div>
    </div>
  )
}
