import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import type { ProjectType } from '../domain/types'
import { getPresetMatches } from '../domain/teamMatcher'
import { createProject } from '../api/client'
import { useDeckStore } from '../store/useDeckStore'
import { defaultRuntimeForNewTeam } from '../domain/teamRuntime'
import { useAuthStore } from '../auth/cloudAuth'
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

type Step = 1 | 2 | 3 | 4
const LAST_STEP: Step = 4

export function ProjectWizard() {
  const open = useDeckStore((s) => s.wizardOpen)
  const closeWizard = useDeckStore((s) => s.closeWizard)
  const registry = useDeckStore((s) => s.registry)
  const applyProjectsSnapshot = useDeckStore((s) => s.applyProjectsSnapshot)
  const setNav = useDeckStore((s) => s.setNav)
  const cloud = useAuthStore((s) => s.status === 'ready')

  const [step, setStep] = useState<Step>(1)
  const [name, setName] = useState('')
  const [type, setType] = useState<ProjectType>('steam-game')
  const [path, setPath] = useState('')
  const [sourceType, setSourceType] = useState<'local' | 'github'>(cloud ? 'github' : 'local')
  const [repository, setRepository] = useState('')
  const [branch, setBranch] = useState('')
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
    setSourceType(cloud ? 'github' : 'local')
    setRepository('')
    setBranch('')
    setAgentIds([])
    setTeamTouched(false)
    setError(null)
  }, [open, cloud])

  // The recommended team follows the chosen type until the user edits it in step 3.
  const recommendedIds = useMemo(() => matches.map((m) => m.agent?.id).filter(Boolean) as string[], [matches])
  const [teamTouched, setTeamTouched] = useState(false)
  const team = teamTouched ? agentIds : recommendedIds

  if (!open) return null

  async function handleCreate() {
    setBusy(true)
    setError(null)
    try {
      const snap = await createProject({
        name: name.trim() || '제목 없는 프로젝트',
        type,
        // Locally the source is optional: GitHub only when a repo was entered, else a (possibly empty) local folder.
        sourceType: cloud || (sourceType === 'github' && repository.trim()) ? 'github' : 'local',
        repository: cloud || (sourceType === 'github' && repository.trim()) ? repository.trim() : undefined,
        branch: cloud || (sourceType === 'github' && repository.trim()) ? branch.trim() || undefined : undefined,
        path: !cloud && sourceType === 'local' ? path.trim() || undefined : undefined,
        agentIds: team,
        status: 'active',
      })
      applyProjectsSnapshot(snap)
      useDeckStore.setState({
        agentRuntime: defaultRuntimeForNewTeam(team),
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
    setAgentIds(team.includes(id) ? team.filter((x) => x !== id) : [...team, id])
    setTeamTouched(true)
  }

  return (
    <div className={styles.overlay} role="dialog" aria-modal aria-label="새 프로젝트">
      <button type="button" className={styles.backdrop} aria-label={t('actions.close')} onClick={closeWizard} />
      <div className={styles.modal}>
        <header className={styles.head}>
          <div>
            <h2>{t('project.new')}</h2>
            <p>{LAST_STEP}단계 중 {step}단계</p>
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
            <>
              <div className={styles.typeGrid}>
                {TYPES.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={type === item.id ? styles.typeOn : styles.type}
                    onClick={() => {
                      setType(item.id)
                      setTeamTouched(false)
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <div className={styles.presetList}>
                <p className={styles.hint}>
                  {matches.length
                    ? `${TYPES.find((item) => item.id === type)?.label}에 맞춘 추천 팀 ${recommendedIds.length}명입니다. 다음 단계에서 바꿀 수 있어요.`
                    : '직접 설정은 추천 팀이 없어요. 다음 단계에서 직원을 골라 주세요.'}
                </p>
                {matches.length ? (
                  <ul>
                    {matches.map((m) => (
                      <li key={m.role.key}>
                        <strong>{m.role.label}</strong>
                        <span>{m.agent ? m.agent.name : '매칭 없음'}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </>
          )}

          {step === 3 && (
            <>
              {recommendedIds.length ? (
                <p className={styles.hint}>
                  {team.length}명 선택됨 ·{' '}
                  <button type="button" className={styles.linkButton} onClick={() => setTeamTouched(false)}>
                    추천 팀으로 되돌리기
                  </button>
                </p>
              ) : null}
              <AgentPicker
                registry={registry}
                selectedIds={team}
                onToggle={toggleAgent}
              />
            </>
          )}

          {step === 4 && (
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
                  <dt>팀</dt>
                  <dd>{team.length}명</dd>
                </div>
              </dl>
              {cloud ? (
                <div className={styles.sourceFields}>
                  <label className={styles.field}>
                    <span>GitHub 저장소 (클라우드에서는 필수)</span>
                    <input value={repository} onChange={(e) => setRepository(e.target.value)} placeholder="owner/repo 또는 https://github.com/owner/repo" />
                  </label>
                  <label className={styles.field}>
                    <span>브랜치 (선택)</span>
                    <input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="비워두면 저장소 기본 브랜치" />
                  </label>
                </div>
              ) : (
                <details className={styles.sourceFields}>
                  <summary>코드 폴더 연결 (선택)</summary>
                  <p className={styles.hint}>코드를 직접 고치는 작업에만 필요해요. 분석·기획만 할 거면 비워 두고, 나중에 프로젝트 화면에서 연결해도 돼요.</p>
                  <div className={styles.sourceOptions} aria-label="프로젝트 소스">
                    <button type="button" className={sourceType === 'local' ? styles.typeOn : styles.type} onClick={() => setSourceType('local')}>로컬 폴더</button>
                    <button type="button" className={sourceType === 'github' ? styles.typeOn : styles.type} onClick={() => setSourceType('github')}>GitHub Repository</button>
                  </div>
                  {sourceType === 'github' ? (
                    <>
                      <label className={styles.field}>
                        <span>GitHub 저장소</span>
                        <input value={repository} onChange={(e) => setRepository(e.target.value)} placeholder="owner/repo" />
                      </label>
                      <label className={styles.field}>
                        <span>브랜치 (선택)</span>
                        <input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="비워두면 저장소 기본 브랜치" />
                      </label>
                    </>
                  ) : (
                    <label className={styles.field}>
                      <span>프로젝트 경로</span>
                      <input value={path} onChange={(e) => setPath(e.target.value)} placeholder="~/Desktop/Coding/my-app" />
                    </label>
                  )}
                </details>
              )}
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
          {step < LAST_STEP ? (
            <button
              type="button"
              className={styles.primary}
              onClick={() => setStep((s) => (s < LAST_STEP ? ((s + 1) as Step) : s))}
              disabled={step === 1 && !name.trim()}
            >
              다음
            </button>
          ) : (
            <button
              type="button"
              className={styles.primary}
              onClick={handleCreate}
              disabled={busy || (cloud && !repository.trim())}
            >
              {busy ? '생성 중…' : t('project.create')}
            </button>
          )}
        </footer>
      </div>
    </div>
  )
}
