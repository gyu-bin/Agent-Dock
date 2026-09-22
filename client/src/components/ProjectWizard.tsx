import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import type { ProjectType } from '../domain/types'
import { getPresetMatches } from '../domain/teamMatcher'
import { createProject } from '../api/client'
import { useDeckStore } from '../store/useDeckStore'
import { defaultRuntimeForNewTeam } from '../domain/teamRuntime'
import { t } from '../i18n/ko'
import { AgentPicker } from './AgentPicker'
import styles from './ProjectWizard.module.css'

const TYPES: Array<{ id: ProjectType; label: string }> = [
  { id: 'steam-game', label: t('projectType.steam-game') },
  { id: 'mobile-game', label: t('projectType.mobile-game') },
  { id: 'mobile-app', label: t('projectType.mobile-app') },
  { id: 'web-app', label: t('projectType.web-app') },
  { id: 'saas', label: t('projectType.saas') },
  { id: 'website', label: t('projectType.website') },
  { id: 'custom', label: t('projectType.custom') },
]

type Step = 1 | 2 | 3 | 4 | 5 | 6

export function ProjectWizard() {
  const open = useDeckStore((s) => s.wizardOpen)
  const closeWizard = useDeckStore((s) => s.closeWizard)
  const registry = useDeckStore((s) => s.registry)
  const applyProjectsSnapshot = useDeckStore((s) => s.applyProjectsSnapshot)
  const setNav = useDeckStore((s) => s.setNav)

  const [step, setStep] = useState<Step>(1)
  const [name, setName] = useState('')
  const [type, setType] = useState<ProjectType>('steam-game')
  const [path, setPath] = useState('')
  const [agentIds, setAgentIds] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const matches = useMemo(() => getPresetMatches(registry, type), [registry, type])

  useEffect(() => {
    if (!open) return
    setStep(1)
    setName('')
    setType('steam-game')
    setPath('')
    setAgentIds([])
    setError(null)
  }, [open])

  useEffect(() => {
    if (step === 4) {
      const ids = matches.map((m) => m.agent?.id).filter(Boolean) as string[]
      setAgentIds(ids)
    }
  }, [step, matches])

  if (!open) return null

  async function handleCreate() {
    setBusy(true)
    setError(null)
    try {
      const snap = await createProject({
        name: name.trim() || '제목 없는 프로젝트',
        type,
        path: path.trim() || undefined,
        agentIds,
        status: 'active',
      })
      applyProjectsSnapshot(snap)
      useDeckStore.setState({
        agentRuntime: defaultRuntimeForNewTeam(agentIds),
        activeNav: 'home',
      })
      closeWizard()
      setNav('home')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  function toggleAgent(id: string) {
    setAgentIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  return (
    <div className={styles.overlay} role="dialog" aria-modal aria-label="새 프로젝트">
      <button type="button" className={styles.backdrop} aria-label={t('actions.close')} onClick={closeWizard} />
      <div className={styles.modal}>
        <header className={styles.head}>
          <div>
            <h2>{t('project.new')}</h2>
            <p>6단계 중 {step}단계</p>
          </div>
          <button type="button" className={styles.close} onClick={closeWizard}>
            <X size={16} />
          </button>
        </header>

        <div className={styles.body}>
          {step === 1 && (
            <label className={styles.field}>
              <span>프로젝트 이름</span>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Steam Game #1"
              />
            </label>
          )}

          {step === 2 && (
            <div className={styles.typeGrid}>
              {TYPES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={type === item.id ? styles.typeOn : styles.type}
                  onClick={() => setType(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}

          {step === 3 && (
            <label className={styles.field}>
              <span>프로젝트 경로 (선택)</span>
              <input
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="~/Desktop/Coding/my-game"
              />
            </label>
          )}

          {step === 4 && (
            <div className={styles.presetList}>
              <p className={styles.hint}>
                레지스트리 {registry.length}명 기준 추천 팀입니다. 다음 단계에서 수정할 수 있습니다.
              </p>
              <ul>
                {matches.map((m) => (
                  <li key={m.role.key}>
                    <strong>{m.role.label}</strong>
                    <span>{m.agent ? m.agent.name : '매칭 없음'}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {step === 5 && (
            <AgentPicker
              registry={registry}
              selectedIds={agentIds}
              onToggle={toggleAgent}
            />
          )}

          {step === 6 && (
            <div className={styles.summary}>
              <dl>
                <div>
                  <dt>{t('project.name')}</dt>
                  <dd>{name.trim() || '제목 없는 프로젝트'}</dd>
                </div>
                <div>
                  <dt>{t('project.type')}</dt>
                  <dd>{TYPES.find((item) => item.id === type)?.label}</dd>
                </div>
                <div>
                  <dt>{t('project.path')}</dt>
                  <dd>{path.trim() || '—'}</dd>
                </div>
                <div>
                  <dt>팀</dt>
                  <dd>{agentIds.length}명</dd>
                </div>
              </dl>
              {error ? <p className={styles.error}>{error}</p> : null}
            </div>
          )}
        </div>

        <footer className={styles.foot}>
          <button
            type="button"
            className={styles.ghost}
            disabled={step === 1 || busy}
            onClick={() => setStep((s) => (s > 1 ? ((s - 1) as Step) : s))}
          >
            뒤로
          </button>
          {step < 6 ? (
            <button
              type="button"
              className={styles.primary}
              onClick={() => setStep((s) => (s < 6 ? ((s + 1) as Step) : s))}
              disabled={step === 1 && !name.trim()}
            >
              다음
            </button>
          ) : (
            <button
              type="button"
              className={styles.primary}
              onClick={handleCreate}
              disabled={busy}
            >
              {busy ? '생성 중…' : t('project.create')}
            </button>
          )}
        </footer>
      </div>
    </div>
  )
}
