import { useCallback, useEffect, useState } from 'react'
import {
  fetchSettingsBoard,
  patchSettings,
  testOpenAIConnection,
  fetchImageToolStatus,
  fetchSocialConnectors,
  startThreadsOAuth,
  disconnectThreads,
  fetchMediaDeliveryStatus,
  fetchBufferStatus,
  refreshBufferStatus,
} from '../api/client'
import type {
  DeckSettings,
  DiagnosticCheck,
  ModelProfileId,
  SettingsBoard,
  SystemStatusItem,
  ExecutionMode,
} from '../domain/types'
import { useDeckStore } from '../store/useDeckStore'
import {
  buildCapabilityDiagnosticsSummary,
  setToolAvailability,
} from '../domain/capabilities'
import styles from './SettingsPage.module.css'

type SettingsSection =
  | 'general'
  | 'ai'
  | 'codex'
  | 'search'
  | 'safety'
  | 'budget'
  | 'sns'
  | 'advanced'

const NAV: Array<{ id: SettingsSection; label: string }> = [
  { id: 'general', label: '일반' },
  { id: 'ai', label: 'AI' },
  { id: 'codex', label: 'Codex' },
  { id: 'search', label: '검색' },
  { id: 'sns', label: 'SNS' },
  { id: 'safety', label: '안전' },
  { id: 'budget', label: '비용' },
  { id: 'advanced', label: '고급' },
]

export function SettingsPage() {
  const aiProvider = useDeckStore((s) => s.aiProvider)
  const executionMode = useDeckStore((s) => s.executionMode)
  const developerAllowMock = useDeckStore((s) => s.developerAllowMock)
  const theme = useDeckStore((s) => s.theme)
  const setTheme = useDeckStore((s) => s.setTheme)
  const setExecutionMode = useDeckStore((s) => s.setExecutionMode)
  const setDeveloperAllowMock = useDeckStore((s) => s.setDeveloperAllowMock)
  const setAiProvider = useDeckStore((s) => s.setAiProvider)

  const registry = useDeckStore((s) => s.registry)
  const capabilityDiag = buildCapabilityDiagnosticsSummary(registry)

  const [section, setSection] = useState<SettingsSection>('general')
  const [board, setBoard] = useState<SettingsBoard | null>(null)
  const [draft, setDraft] = useState<DeckSettings | null>(null)
  const [imageTool, setImageTool] = useState<{
    configured: boolean
    available: boolean
    fastModel: string
    qualityModel: string
  } | null>(null)
  const [socialConnectors, setSocialConnectors] = useState<
    Array<{
      channel: string
      label: string
      configured: boolean
      available: boolean
      state: string
      connection?: {
        status: string
        username?: string
        profileId?: string
      }
    }>
  >([])
  const [snsBusy, setSnsBusy] = useState(false)
  const [mediaDeliveryStatus, setMediaDeliveryStatus] = useState<{
    configured: boolean
    available: boolean
    provider: string
    label: string
    defaultTtlSeconds: number
  } | null>(null)
  const [bufferStatus, setBufferStatus] = useState<{
    configured: boolean
    available: boolean
    label: string
    channelCount: number
    channels: Array<{
      id: string
      name: string
      service: string
      displayName?: string
    }>
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [testMsg, setTestMsg] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const b = await fetchSettingsBoard()
      setBoard(b)
      void fetchImageToolStatus()
        .then((img) => {
          setImageTool(img)
          setToolAvailability(
            'image-generation',
            img.available && img.configured ? 'available' : 'unavailable',
          )
        })
        .catch(() => setImageTool(null))
      void fetchSocialConnectors()
        .then((soc) => {
          setSocialConnectors(soc.connectors)
          setToolAvailability(
            'social-publisher',
            soc.socialPublishAvailable ? 'available' : 'unavailable',
          )
          setToolAvailability(
            'analytics',
            soc.analyticsReadAvailable ? 'available' : 'unavailable',
          )
        })
        .catch(() => setSocialConnectors([]))
      void fetchMediaDeliveryStatus()
        .then(setMediaDeliveryStatus)
        .catch(() => setMediaDeliveryStatus(null))
      void fetchBufferStatus()
        .then(setBufferStatus)
        .catch(() => setBufferStatus(null))
      setDraft(b.settings)
      setAiProvider({
        mode: b.runtime.openai.configured ? 'openai' : 'not-configured',
        configured: b.runtime.openai.configured,
        label: b.runtime.openai.label,
        model: b.runtime.openai.model ?? undefined,
        providerName: 'openai',
        codex: {
          available: b.runtime.codex.available,
          binary: b.runtime.codex.binary,
          label: b.runtime.codex.label,
          version: b.runtime.codex.version,
        },
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [setAiProvider])

  useEffect(() => {
    void reload()
  }, [reload])

  function selectMode(mode: ExecutionMode) {
    if (mode === 'MOCK' && !developerAllowMock) return
    if (mode === 'REAL_AI' && !aiProvider.configured) return
    setExecutionMode(mode)
  }

  async function save(patch: Parameters<typeof patchSettings>[0]) {
    setSaving(true)
    setMsg(null)
    setError(null)
    try {
      const b = await patchSettings(patch)
      setBoard(b)
      setDraft(b.settings)
      if (b.rejectedSafety?.length) {
        setMsg(
          `저장됨 — 필수 Safety(${b.rejectedSafety.join(', ')})는 끌 수 없어 유지했습니다.`,
        )
      } else {
        setMsg('저장됨')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  async function onTestOpenAI() {
    setTestMsg(null)
    try {
      const res = await testOpenAIConnection()
      setTestMsg(
        res.skipped
          ? `연결 테스트 건너뜀 — ${res.reason} (설정: ${res.configured ? '됨' : '안 됨'})`
          : '완료',
      )
    } catch (err) {
      setTestMsg(err instanceof Error ? err.message : String(err))
    }
  }

  if (loading && !board) {
    return (
      <div className={styles.page}>
        <p className={styles.hint}>설정 불러오는 중…</p>
      </div>
    )
  }

  const runtime = board?.runtime
  const diagnostics = board?.diagnostics ?? []
  const status = board?.status ?? []
  const s = draft

  const providerSummary = aiProvider.configured
    ? `AI 준비됨 · ${aiProvider.model ?? runtime?.openai.model ?? '모델'}`
    : 'AI 설정 필요'
  const modeSummary =
    executionMode === 'MOCK' && developerAllowMock
      ? '개발자 Mock'
      : aiProvider.configured
        ? 'REAL AI'
        : 'NOT CONFIGURED'

  return (
    <div className={styles.split}>
      <nav className={styles.nav} aria-label="설정 메뉴">
        <div className={styles.navHead}>
          <h1>설정</h1>
          <p>{providerSummary}</p>
          <span className={styles.modeBadge}>{modeSummary}</span>
        </div>
        {NAV.map((item) => (
          <button
            key={item.id}
            type="button"
            className={
              section === item.id ? styles.navItemOn : styles.navItem
            }
            onClick={() => setSection(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div className={styles.content}>
        <section className={styles.statusGrid} aria-label="시스템 상태">
          {status.map((item) => (
            <StatusChip key={item.id} item={item} />
          ))}
        </section>

        {error ? <p className={styles.error}>{error}</p> : null}
        {msg ? <p className={styles.okMsg}>{msg}</p> : null}

        {section === 'general' ? (
          <section className={styles.card}>
            <h2>일반</h2>
            <p className={styles.hint}>
              AI 서비스 · Codex · 검색 · 안전 · 비용 설정을 왼쪽 메뉴에서
              선택하세요. 기본 실행은 실제 AI입니다.
            </p>
            <div className={styles.row}>
              <span className={styles.label}>외관</span>
              <span className={styles.hintInline}>
                {theme === 'dark' ? '다크' : '라이트'}
              </span>
            </div>
            <div className={styles.modeRow} style={{ marginTop: 8 }}>
              <button
                type="button"
                className={theme === 'light' ? styles.modeOn : styles.mode}
                onClick={() => setTheme('light')}
              >
                라이트
              </button>
              <button
                type="button"
                className={theme === 'dark' ? styles.modeOn : styles.mode}
                onClick={() => setTheme('dark')}
              >
                다크
              </button>
            </div>
            <div className={styles.row} style={{ marginTop: 16 }}>
              <span className={styles.label}>실행 정책</span>
              <span className={styles.hintInline}>{modeSummary}</span>
            </div>
            <div className={styles.row}>
              <span className={styles.label}>AI 서비스</span>
              <span className={aiProvider.configured ? styles.ok : styles.off}>
                {aiProvider.configured ? '● 설정됨' : '○ 미설정'}
              </span>
            </div>
            {!aiProvider.configured ? (
              <button
                type="button"
                className={styles.primary}
                onClick={() => setSection('ai')}
              >
                AI 설정하기
              </button>
            ) : null}
            <button
              type="button"
              className={styles.ghost}
              style={{ marginLeft: 8 }}
              onClick={() => useDeckStore.getState().setNav('usage')}
            >
              사용량 보기
            </button>
          </section>
        ) : null}

        {section === 'ai' ? (
          <>
            <section className={styles.card}>
              <h2>AI 서비스</h2>
              <div className={styles.row}>
                <span className={styles.label}>상태</span>
                {runtime?.openai.configured ? (
                  <span className={styles.ok}>● 설정됨</span>
                ) : (
                  <span className={styles.off}>○ 미설정</span>
                )}
              </div>
              <div className={styles.row}>
                <span className={styles.label}>이미지 생성</span>
                <span
                  className={
                    imageTool?.available ? styles.ok : styles.off
                  }
                >
                  {imageTool?.available
                    ? '● 사용 가능'
                    : '○ 설정 필요'}
                </span>
              </div>
              {imageTool ? (
                <>
                  <div className={styles.row}>
                    <span className={styles.label}>Fast model</span>
                    <span className={styles.hintInline}>{imageTool.fastModel}</span>
                  </div>
                  <div className={styles.row}>
                    <span className={styles.label}>Quality model</span>
                    <span className={styles.hintInline}>
                      {imageTool.qualityModel}
                    </span>
                  </div>
                </>
              ) : null}
              <div className={styles.row}>
                <span className={styles.label}>API Key</span>
                <span
                  className={
                    runtime?.openai.apiKeyConfigured ? styles.ok : styles.off
                  }
                >
                  {runtime?.openai.apiKeyConfigured
                    ? 'Configured'
                    : 'Not configured'}
                </span>
              </div>
              <label className={styles.field}>
                Model
                <input
                  value={s?.openai.model ?? ''}
                  onChange={(e) =>
                    setDraft((d) =>
                      d
                        ? {
                            ...d,
                            openai: { ...d.openai, model: e.target.value },
                          }
                        : d,
                    )
                  }
                />
              </label>
              <div className={styles.modeRow}>
                <button
                  type="button"
                  className={s?.openai.enabled ? styles.modeOn : styles.mode}
                  onClick={() =>
                    setDraft((d) =>
                      d
                        ? { ...d, openai: { ...d.openai, enabled: true } }
                        : d,
                    )
                  }
                >
                  활성
                </button>
                <button
                  type="button"
                  className={!s?.openai.enabled ? styles.modeOn : styles.mode}
                  onClick={() =>
                    setDraft((d) =>
                      d
                        ? { ...d, openai: { ...d.openai, enabled: false } }
                        : d,
                    )
                  }
                >
                  비활성
                </button>
                <button
                  type="button"
                  className={styles.ghost}
                  onClick={() => void onTestOpenAI()}
                >
                  연결 테스트
                </button>
                <button
                  type="button"
                  className={styles.primary}
                  disabled={saving || !s}
                  onClick={() =>
                    void save({
                      openai: {
                        enabled: s!.openai.enabled,
                        model: s!.openai.model,
                      },
                    })
                  }
                >
                  저장
                </button>
              </div>
              {testMsg ? <p className={styles.hint}>{testMsg}</p> : null}
            </section>

            <section className={styles.card}>
              <h2>모델 프로필</h2>
              <p className={styles.hint}>
                역할별 모델입니다. Agent마다 모델을 하드코딩하지 않습니다.
              </p>
              {(['FAST', 'STANDARD', 'REASONING'] as ModelProfileId[]).map(
                (id) => {
                  const p = s?.modelProfiles[id]
                  if (!p) return null
                  return (
                    <div key={id} className={styles.profileBlock}>
                      <div className={styles.row}>
                        <strong>{p.label}</strong>
                        <span className={styles.hintInline}>
                          {p.description}
                        </span>
                      </div>
                      <label className={styles.field}>
                        Model ID
                        <input
                          value={p.model}
                          onChange={(e) =>
                            setDraft((d) => {
                              if (!d) return d
                              return {
                                ...d,
                                modelProfiles: {
                                  ...d.modelProfiles,
                                  [id]: {
                                    ...d.modelProfiles[id],
                                    model: e.target.value,
                                  },
                                },
                              }
                            })
                          }
                        />
                      </label>
                    </div>
                  )
                },
              )}
              <button
                type="button"
                className={styles.primary}
                disabled={saving || !s}
                onClick={() =>
                  void save({
                    modelProfiles: {
                      FAST: { model: s!.modelProfiles.FAST.model },
                      STANDARD: { model: s!.modelProfiles.STANDARD.model },
                      REASONING: { model: s!.modelProfiles.REASONING.model },
                    },
                  })
                }
              >
                프로필 저장
              </button>
            </section>
          </>
        ) : null}

        {section === 'codex' ? (
          <section className={styles.card}>
            <h2>Codex</h2>
            <div className={styles.row}>
              <span className={styles.label}>Codex CLI</span>
              {runtime?.codex.available ? (
                <span className={styles.ok}>● Available</span>
              ) : (
                <span className={styles.off}>○ Unavailable</span>
              )}
            </div>
            <p className={styles.hint}>
              Binary Path: <code>{runtime?.codex.binary ?? '(없음)'}</code>
            </p>
            <div className={styles.row}>
              <span className={styles.label}>Authentication</span>
              <span className={styles.hintInline}>
                {runtime?.codex.authMode === 'api-key'
                  ? 'API Key (CODEX_API_KEY)'
                  : 'Local Login'}
                {runtime?.codex.apiKeyConfigured ? ' · Key Configured' : ''}
              </span>
            </div>
            <p className={styles.hint}>
              OpenAI용 키와 Codex용 키는 다릅니다. 서로 혼동하지 마세요.
            </p>
            <p className={styles.hint}>{runtime?.codex.sandboxPolicy}</p>
            <div className={styles.modeRow}>
              <button
                type="button"
                className={s?.codex.enabled ? styles.modeOn : styles.mode}
                onClick={() => void save({ codex: { enabled: true } })}
              >
                활성
              </button>
              <button
                type="button"
                className={!s?.codex.enabled ? styles.modeOn : styles.mode}
                onClick={() => void save({ codex: { enabled: false } })}
              >
                비활성
              </button>
            </div>
          </section>
        ) : null}

        {section === 'search' ? (
          <section className={styles.card}>
            <h2>검색</h2>
            <p className={styles.hint}>
              Primary: <strong>{runtime?.webSearch.primaryLabel}</strong>
            </p>
            <ol className={styles.fallbackList}>
              {(s?.webSearch.providers ?? [])
                .slice()
                .sort((a, b) => a.order - b.order)
                .map((p) => (
                  <li key={p.id}>
                    <label className={styles.checkRow}>
                      <input
                        type="checkbox"
                        checked={p.enabled}
                        onChange={(e) =>
                          setDraft((d) => {
                            if (!d) return d
                            return {
                              ...d,
                              webSearch: {
                                ...d.webSearch,
                                providers: d.webSearch.providers.map((x) =>
                                  x.id === p.id
                                    ? { ...x, enabled: e.target.checked }
                                    : x,
                                ),
                              },
                            }
                          })
                        }
                      />
                      {p.label}
                      {p.order === 0 ? ' (Primary)' : ' (Fallback)'}
                    </label>
                  </li>
                ))}
            </ol>
            <label className={styles.field}>
              검색 실패 정책
              <select
                value={s?.webSearch.failPolicy ?? 'block-step'}
                onChange={(e) =>
                  setDraft((d) =>
                    d
                      ? {
                          ...d,
                          webSearch: {
                            ...d.webSearch,
                            failPolicy: e.target
                              .value as DeckSettings['webSearch']['failPolicy'],
                          },
                        }
                      : d,
                  )
                }
              >
                <option value="block-step">단계 차단 (기본)</option>
                <option value="allow-continue-without">
                  검색 없이 계속 허용
                </option>
              </select>
            </label>
            <button
              type="button"
              className={styles.primary}
              disabled={saving || !s}
              onClick={() =>
                void save({
                  webSearch: {
                    providers: s!.webSearch.providers.map((p) => ({
                      id: p.id,
                      enabled: p.enabled,
                      order: p.order,
                    })),
                    failPolicy: s!.webSearch.failPolicy,
                  },
                })
              }
            >
              검색 설정 저장
            </button>
          </section>
        ) : null}

        {section === 'sns' ? (
          <section className={styles.card}>
            <h2>SNS 연결</h2>
            <p className={styles.hint}>
              Threads만 OAuth 연결을 지원합니다. Instagram 등은 지원 예정입니다.
            </p>
            {(socialConnectors.length
              ? socialConnectors
              : [
                  {
                    channel: 'threads',
                    label: 'Threads',
                    configured: false,
                    available: false,
                    state: 'unconfigured',
                  },
                  {
                    channel: 'instagram',
                    label: 'Instagram',
                    configured: false,
                    available: false,
                    state: 'unconfigured',
                  },
                  {
                    channel: 'x',
                    label: 'X',
                    configured: false,
                    available: false,
                    state: 'unconfigured',
                  },
                  {
                    channel: 'youtube',
                    label: 'YouTube',
                    configured: false,
                    available: false,
                    state: 'unconfigured',
                  },
                  {
                    channel: 'reddit',
                    label: 'Reddit',
                    configured: false,
                    available: false,
                    state: 'unconfigured',
                  },
                ]
            )
              .filter((c) =>
                ['threads', 'instagram', 'x', 'youtube', 'reddit'].includes(
                  c.channel,
                ),
              )
              .map((c) => {
                const isThreads = c.channel === 'threads'
                const connected = Boolean(c.available && c.connection?.status === 'connected') ||
                  (isThreads && c.available)
                const label =
                  c.channel === 'threads'
                    ? 'Threads'
                    : c.channel === 'instagram'
                      ? 'Instagram'
                      : c.channel === 'x'
                        ? 'X'
                        : c.channel === 'youtube'
                          ? 'YouTube'
                          : 'Reddit'
                return (
                  <div className={styles.row} key={c.channel}>
                    <span className={styles.label}>{label}</span>
                    <span className={connected ? styles.ok : styles.off}>
                      {connected
                        ? `● 연결됨${c.connection?.username ? ` · @${c.connection.username}` : ''}`
                        : c.connection?.status === 'expired'
                          ? '○ 인증 만료'
                          : '○ 연결 안 됨'}
                    </span>
                    {isThreads ? (
                      connected ? (
                        <button
                          type="button"
                          className={styles.mode}
                          disabled={snsBusy}
                          onClick={() => {
                            setSnsBusy(true)
                            void disconnectThreads()
                              .then(() => reload())
                              .finally(() => setSnsBusy(false))
                          }}
                        >
                          연결 해제
                        </button>
                      ) : (
                        <button
                          type="button"
                          className={styles.primary}
                          disabled={snsBusy}
                          onClick={() => {
                            setSnsBusy(true)
                            void startThreadsOAuth()
                              .then((r) => {
                                window.location.href = r.authorizeUrl
                              })
                              .catch((err) => {
                                setError(
                                  err instanceof Error
                                    ? err.message
                                    : String(err),
                                )
                                setSnsBusy(false)
                              })
                          }}
                        >
                          연결
                        </button>
                      )
                    ) : (
                      <span className={styles.hintInline}>지원 예정</span>
                    )}
                  </div>
                )
              })}
            <p className={styles.hint}>
              THREADS_APP_ID / THREADS_APP_SECRET / THREADS_REDIRECT_URI 환경변수
              필요. 토큰은 서버에만 저장됩니다.
            </p>

            <h3 style={{ marginTop: 20 }}>Buffer</h3>
            <p className={styles.hint}>
              승인된 마케팅 패키지를 Queue/예약으로 배포합니다. API Key는 서버
              환경변수(BUFFER_API_KEY)만 사용하며 화면에 표시되지 않습니다.
            </p>
            <div className={styles.row}>
              <span className={styles.label}>상태</span>
              <span
                className={bufferStatus?.available ? styles.ok : styles.off}
              >
                {bufferStatus?.available
                  ? '● 연결됨'
                  : bufferStatus?.configured
                    ? '○ 연결 실패'
                    : '○ 설정 필요'}
              </span>
              <button
                type="button"
                className={styles.mode}
                disabled={snsBusy}
                onClick={() => {
                  setSnsBusy(true)
                  void refreshBufferStatus()
                    .then(setBufferStatus)
                    .catch((err) =>
                      setError(
                        err instanceof Error ? err.message : String(err),
                      ),
                    )
                    .finally(() => setSnsBusy(false))
                }}
              >
                새로고침
              </button>
            </div>
            {(bufferStatus?.channels.length ?? 0) > 0 ? (
              <div style={{ marginTop: 8 }}>
                <span className={styles.label}>연결된 채널</span>
                <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                  {bufferStatus!.channels.map((ch) => (
                    <li key={ch.id}>
                      {ch.service}{' '}
                      {ch.displayName || ch.name
                        ? `@${ch.displayName || ch.name}`
                        : ch.id}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className={styles.hintInline}>
                {bufferStatus?.configured
                  ? '연결된 채널 없음 — API Key와 조직 채널을 확인하세요.'
                  : 'BUFFER_API_KEY를 서버 .env에 설정하세요.'}
              </p>
            )}

            <h3 style={{ marginTop: 20 }}>미디어 전달</h3>
            <div className={styles.row}>
              <span className={styles.label}>Provider</span>
              <span className={styles.hintInline}>
                {mediaDeliveryStatus?.label ??
                  mediaDeliveryStatus?.provider ??
                  'unconfigured'}
              </span>
            </div>
            <div className={styles.row}>
              <span className={styles.label}>상태</span>
              <span
                className={
                  mediaDeliveryStatus?.available ? styles.ok : styles.off
                }
              >
                {mediaDeliveryStatus?.available
                  ? '● 사용 가능'
                  : '○ 설정 필요'}
              </span>
            </div>
            <div className={styles.row}>
              <span className={styles.label}>기본 TTL</span>
              <span className={styles.hintInline}>
                {mediaDeliveryStatus?.defaultTtlSeconds
                  ? `${Math.round(mediaDeliveryStatus.defaultTtlSeconds / 60)}분`
                  : '30분'}
              </span>
            </div>
            <p className={styles.hint}>
              로컬 서버를 공개하지 않습니다. Production은 private R2/S3 object +
              signed URL (MEDIA_DELIVERY_PROVIDER=s3-compatible). credential은
              서버 .env에만 둡니다.
            </p>
          </section>
        ) : null}

        {section === 'safety' ? (
          <section className={styles.card}>
            <h2>안전</h2>
            <label className={styles.checkRowLocked}>
              <input type="checkbox" checked disabled readOnly />
              Human Approval <em>필수 ON</em>
            </label>
            <label className={styles.checkRowLocked}>
              <input type="checkbox" checked disabled readOnly />
              Verify after Code Change <em>필수 ON</em>
            </label>
            <label className={styles.checkRow}>
              <input
                type="checkbox"
                checked={s?.safety.codeReview ?? true}
                onChange={(e) =>
                  void save({ safety: { codeReview: e.target.checked } })
                }
              />
              Code Review (선택)
            </label>
            <label className={styles.checkRow}>
              <input
                type="checkbox"
                checked={s?.safety.realityCheck ?? true}
                onChange={(e) =>
                  void save({ safety: { realityCheck: e.target.checked } })
                }
              />
              Reality Check (선택)
            </label>
            <p className={styles.hint}>
              필수 Safety는 UI에서 끌 수 없습니다.
            </p>
            <div className={styles.row} style={{ marginTop: 12 }}>
              <span className={styles.label}>실행 모드</span>
              <span className={styles.hintInline}>
                {aiProvider.configured ? 'REAL AI' : 'AI 설정 필요'}
              </span>
            </div>
            <p className={styles.hint}>
              Mock 실행은 고급 → 개발자 모드에서만 켤 수 있습니다.
            </p>
          </section>
        ) : null}

        {section === 'budget' ? (
          <section className={styles.card}>
            <h2>비용</h2>
            <label className={styles.field}>
              프로젝트 예상 비용 제한 (USD)
              <input
                type="number"
                min={0}
                step={0.01}
                value={s?.budget.maxCost ?? ''}
                placeholder="미설정"
                onChange={(e) =>
                  setDraft((d) =>
                    d
                      ? {
                          ...d,
                          budget: {
                            ...d.budget,
                            maxCost: e.target.value
                              ? Number(e.target.value)
                              : undefined,
                          },
                        }
                      : d,
                  )
                }
              />
            </label>
            <label className={styles.field}>
              Token 제한
              <input
                type="number"
                min={0}
                value={s?.budget.maxTokens ?? ''}
                placeholder="미설정"
                onChange={(e) =>
                  setDraft((d) =>
                    d
                      ? {
                          ...d,
                          budget: {
                            ...d.budget,
                            maxTokens: e.target.value
                              ? Number(e.target.value)
                              : undefined,
                          },
                        }
                      : d,
                  )
                }
              />
            </label>
            <label className={styles.field}>
              Warning threshold (0–1)
              <input
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={s?.budget.warningThreshold ?? 0.8}
                onChange={(e) =>
                  setDraft((d) =>
                    d
                      ? {
                          ...d,
                          budget: {
                            ...d.budget,
                            warningThreshold: Number(e.target.value),
                          },
                        }
                      : d,
                  )
                }
              />
            </label>
            <p className={styles.hint}>
              현재는 저장·표시만 합니다. 실행 차단은 아직 적용하지 않습니다.
            </p>
            <button
              type="button"
              className={styles.primary}
              disabled={saving || !s}
              onClick={() =>
                void save({
                  budget: {
                    maxCost: s!.budget.maxCost ?? null,
                    maxTokens: s!.budget.maxTokens ?? null,
                    warningThreshold: s!.budget.warningThreshold,
                  },
                })
              }
            >
              Budget 저장
            </button>
          </section>
        ) : null}

        {section === 'advanced' ? (
          <>
            <section className={styles.card}>
              <h2>개발자 모드</h2>
              <p className={styles.hint}>
                Mock 실행은 개발·데모용입니다. 일반 사용에서는 실제 AI만
                사용합니다. 자동 Mock fallback은 없습니다.
              </p>
              <label className={styles.checkRow}>
                <input
                  type="checkbox"
                  checked={developerAllowMock}
                  onChange={(e) => setDeveloperAllowMock(e.target.checked)}
                />
                개발자 모드 허용 (Mock 선택 가능)
              </label>
              <div className={styles.modeRow} style={{ marginTop: 12 }}>
                <button
                  type="button"
                  className={
                    executionMode === 'REAL_AI' ? styles.modeOn : styles.mode
                  }
                  onClick={() => selectMode('REAL_AI')}
                  disabled={!aiProvider.configured}
                >
                  REAL AI
                </button>
                <button
                  type="button"
                  className={
                    executionMode === 'MOCK' ? styles.modeOn : styles.mode
                  }
                  onClick={() => selectMode('MOCK')}
                  disabled={!developerAllowMock}
                >
                  MOCK
                </button>
              </div>
              {!developerAllowMock ? (
                <p className={styles.hint}>
                  Mock을 쓰려면 위에서 개발자 모드를 먼저 켜세요.
                </p>
              ) : null}
              {!aiProvider.configured && executionMode !== 'MOCK' ? (
                <p className={styles.hint}>
                  Provider 미설정 — NOT CONFIGURED. AI 탭에서 키를 설정하세요.
                </p>
              ) : null}
            </section>

            <section className={styles.card}>
              <h2>에이전트 디렉터리</h2>
              <div className={styles.row}>
                <span className={styles.label}>Codex Agents</span>
                <span className={styles.hintInline}>
                  Loaded: {runtime?.agents.total ?? 0}
                </span>
              </div>
              <p className={styles.hint}>
                <code>{runtime?.agents.codexAgentsDir ?? '—'}</code>
              </p>
              <button
                type="button"
                className={styles.ghost}
                onClick={() => useDeckStore.getState().setNav('agents')}
              >
                전체 Agent Directory 열기
              </button>
              <label className={styles.field}>
                Codex Agents 경로 (선택)
                <input
                  value={s?.agents.codexAgentsDir ?? ''}
                  placeholder="비우면 기본 경로"
                  onChange={(e) =>
                    setDraft((d) =>
                      d
                        ? {
                            ...d,
                            agents: {
                              ...d.agents,
                              codexAgentsDir: e.target.value || undefined,
                            },
                          }
                        : d,
                    )
                  }
                />
              </label>
              <label className={styles.field}>
                Agency Source 경로 (선택)
                <input
                  value={s?.agents.agencySourceDir ?? ''}
                  placeholder="비우면 기본 경로"
                  onChange={(e) =>
                    setDraft((d) =>
                      d
                        ? {
                            ...d,
                            agents: {
                              ...d.agents,
                              agencySourceDir: e.target.value || undefined,
                            },
                          }
                        : d,
                    )
                  }
                />
              </label>
              <button
                type="button"
                className={styles.primary}
                disabled={saving || !s}
                onClick={() =>
                  void save({
                    agents: {
                      codexAgentsDir: s!.agents.codexAgentsDir ?? null,
                      agencySourceDir: s!.agents.agencySourceDir ?? null,
                    },
                  })
                }
              >
                경로 저장
              </button>
            </section>

            <section className={styles.card}>
              <h2>프로젝트 · 경로 정책</h2>
              <label className={styles.checkRow}>
                <input
                  type="checkbox"
                  checked={s?.project.requireProjectPath ?? true}
                  onChange={(e) =>
                    void save({
                      project: { requireProjectPath: e.target.checked },
                    })
                  }
                />
                Codex 실행 시 프로젝트 경로 필수
              </label>
              <p className={styles.hint}>{s?.project.sandboxNote}</p>
            </section>

            <section className={styles.card}>
              <h2>Capability Foundation</h2>
              <p className={styles.hint}>
                Agent → Capability → Tool 진단 (일반 UI에는 노출하지 않음)
              </p>
              <ul className={styles.metaList}>
                <li>
                  Agents profiled: {capabilityDiag.agentCount} (with caps:{' '}
                  {capabilityDiag.withCapabilities})
                </li>
                <li>
                  Without capabilities:{' '}
                  {capabilityDiag.withoutCapabilities.length === 0
                    ? 'none'
                    : capabilityDiag.withoutCapabilities.join(', ')}
                </li>
                <li>
                  Available tools: {capabilityDiag.availableTools.join(', ')}
                </li>
                <li>
                  Future tools: {capabilityDiag.futureTools.join(', ') || '—'}
                </li>
                <li>
                  Future capabilities:{' '}
                  {capabilityDiag.futureCapabilities.join(', ') || '—'}
                </li>
              </ul>
              <p className={styles.hint}>
                Preferred tools:{' '}
                {Object.entries(capabilityDiag.preferredToolDistribution)
                  .map(([k, v]) => `${k}=${v}`)
                  .join(' · ')}
              </p>
            </section>

            <section className={styles.card}>
              <h2>Retry · Diagnostics</h2>
              <ul className={styles.metaList}>
                <li>OpenAI retry: {s?.retry.openaiMaxRetries ?? 2}회</li>
                <li>
                  Codex retry: {s?.retry.codexMaxRetries ?? 2}회 (일시적
                  업스트림만)
                </li>
                <li>
                  Web Search retry: {s?.retry.webSearchMaxRetries ?? 1}회
                </li>
              </ul>
              <p className={styles.hint}>{s?.retry.implementNote}</p>
              <ul className={styles.diagList}>
                {diagnostics.map((d) => (
                  <DiagRow key={d.id} check={d} />
                ))}
              </ul>
              <button
                type="button"
                className={styles.ghost}
                onClick={() => void reload()}
              >
                다시 검사
              </button>
              {board?.advanced ? (
                <div className={styles.advanced}>
                  <p className={styles.hint}>{board.advanced.note}</p>
                  <p className={styles.hint}>
                    Settings file:{' '}
                    <code>{runtime?.persistence.settingsPath}</code>
                  </p>
                </div>
              ) : null}
            </section>
          </>
        ) : null}
      </div>
    </div>
  )
}

function StatusChip({ item }: { item: SystemStatusItem }) {
  const cls =
    item.level === 'ok'
      ? styles.statusOk
      : item.level === 'warn'
        ? styles.statusWarn
        : styles.statusOff
  return (
    <div className={`${styles.statusChip} ${cls}`}>
      <span>{item.label}</span>
      <strong>{item.value}</strong>
    </div>
  )
}

function DiagRow({ check }: { check: DiagnosticCheck }) {
  return (
    <li className={check.ok ? styles.diagOk : styles.diagBad}>
      <strong>{check.ok ? '✓' : '!'}</strong> {check.label}
      <span> — {check.detail}</span>
    </li>
  )
}
