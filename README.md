# Agent Deck

프로젝트와 AI 팀을 관리하는 **AI 개발 스튜디오**입니다. Local Runtime을 유지하면서 GitHub 저장소와 Vercel Sandbox를 사용하는 Cloud Runtime 기반을 추가하고 있습니다. Phase 1의 실제 배포 검증은 아직 완료되지 않았습니다.

## 제품 사용 흐름 (Project-first)

1. **홈** — 오피스 시각화 + 활성 프로젝트 상태  
2. **프로젝트** — **Project Control Center** (작업의 중심)  
3. 「무엇을 시킬까요?」에 요청 (+ Image / File / Folder / GitHub / URL 첨부)  
4. Preview → 시작 → 필요한 승인만  
5. 결과물 · 지식 · Goal · Routine · Marketing · Usage가 **같은 Project**에 축적

Provider · Model · Workflow ID · Agent ID는 **설정 → 고급** 또는 Advanced에서만 다룹니다.

상세 상태: [`docs/product-status.md`](docs/product-status.md)

## 주요 기능

- **Project Control Center** — Header / Work Composer / Overview / Team / Goals / Automation / Tools / Marketing / Safety / Usage / Knowledge
- **Canonical Task Planner** — Preview와 실행이 동일 `planTask` SoT
- **첨부 (Work Attachment)** — writable target vs read-only reference 경계 유지
- **Marketing** — Campaign → Approval → Buffer Queue/Draft/Schedule (또는 Manual)
- **Media Delivery** — SNS용 임시 URL (R2/S3)
- **Scheduler / Routine** — 마케팅·리서치 자동화 (승인 정책 유지)
- **로컬 보안** — Session · Path Sandbox · Execution Lock

## 아키텍처

| 영역 | 기술 |
|------|------|
| Client | React · Vite · TypeScript · Zustand |
| Server | Express · Agent Registry (TOML) · Persistence |
| Office | DOM / CSS (시각화; Core 작업 경로 아님) |

Happy Path:

프로젝트 선택 → Project Control Center → 무엇을 시킬까요? → (Preview) → 실행 → (필요 시 승인) → 결과 확인

## 실행

```bash
npm install
npm run dev
```

- UI: http://localhost:5173
- API: http://localhost:8787

환경 변수는 `.env.example`을 참고해 `.env`에 설정합니다.

```bash
# 예
OPENAI_API_KEY=sk-...
# CODEX_BIN=/path/to/codex
# BUFFER_API_KEY=
```

## ChatGPT 플랜 연결

로컬 앱에서 **설정 → AI → Continue with ChatGPT**를 직접 눌러 로그인하고 플랜 사용을 승인합니다.
일반 채팅·분석의 기본 인증 방식은 **ChatGPT Plan**입니다. 모델 목록은 연결한 계정에서 받아옵니다.
로그인 여부와 실제 플랜 요청 성공은 별개입니다. 계정 정책과 플랜 한도에 따라 요청이 제한될 수 있습니다.

**OpenAI API · 별도 결제**는 설정에서 명시적으로 선택할 때만 사용합니다. API 키는 `.env`에 저장하고 앱을 다시 시작합니다.
ChatGPT 플랜 실패 후 API 키로 자동 전환하지 않습니다. 이미지 생성은 별도 API 이미지 설정과 잔액이 필요합니다.
Codex 구현 작업은 기존 로컬 Codex CLI 로그인으로 실행합니다.

현재 공식 OSS 로그인은 **로컬 앱 전용**입니다. Vercel의 원격 서버에서는 로그인 버튼이 비활성화되며,
Vercel에서 AI를 실행하려면 API 모드를 명시적으로 선택해야 합니다. 로컬 로그인 정보는 Vercel로 복사하지 않습니다.
연결 해제는 로컬 토큰을 지우며, 서버가 원격 해제를 지원하지 않으면 ChatGPT 설정에서 연결 앱도 해제해야 합니다.

검증 범위와 제한: [ChatGPT 플랜 연동 보고](docs/chatgpt-plan-integration.md), [인증 보안](docs/chatgpt-oauth-security.md).

## AI 실행 모드

| 상태 | 의미 |
|------|------|
| **REAL** | Provider 설정됨 — 실제 AI 사용 (기본) |
| **NOT_CONFIGURED** | AI 설정 필요 |
| **MOCK** | Settings → **고급** → **Developer Mode**에서만 명시 활성화 |

Provider 실패 시 **자동 Mock 전환은 하지 않습니다.**

### 에이전트 실행 지침 경로

목록 조회와 OpenAI/Codex 실행은 같은 resolver를 사용합니다. Local 우선순위는 명시적 호출 경로 → 설정의 `agents.codexAgentsDir` → `AGENT_DECK_AGENTS_DIR` → 서버 사용자 홈의 `~/.codex/agents` → bundled agents입니다. 명시한 잘못된 경로는 오류를 유지하며, 기본 홈 경로가 없을 때 bundled로 전환합니다. `~`와 상대 경로는 서버 사용자 홈을 기준으로 해석합니다.

Cloud는 서버에 포함된 **279 bundled agents**와 committed 부서 분류를 사용합니다. Settings·환경 변수의 로컬 에이전트 경로와 사용자 홈을 조회하지 않습니다. `AGENT_DECK_AGENCY_DIR`는 Local 부서 분류용 Markdown 소스이며 TOML 실행 지침 경로로 사용하지 않습니다. 실행 지침은 서버 전용으로 유지하고 manifest의 ID·파일·SHA256을 배포 전에 검증합니다.

실제 지침 폴더를 읽을 수 없을 때 표시되는 임시 에이전트 목록은 REAL 실행에 사용할 수 없습니다. 실제 목록에서도 지침 파싱과 필수 필드 확인에 실패한 에이전트는 실행할 수 없습니다. 명시적 Developer Mock 모드는 기존 모의 실행기를 사용합니다. 설정 진단에서 실제 source, 정규화된 경로, 로드 수와 실행 가능 수를 확인할 수 있습니다.

## 네비게이션

**사이드바:** 홈 · 프로젝트(Control Center) · 승인 대기 · (하단) 설정  

작업 / 결과물 / 지식 / Usage는 Project 탭(또는 Settings 고급)에서 접근합니다.

## 스크립트

| Command | Description |
|---------|-------------|
| `npm run dev` | Client + server |
| `npm run build` | Production build |
| `npm run typecheck` | TypeScript check |
| `node --import tsx tools/project-first-fixture.mts` | Project-first A–N |
| `node --import tsx tools/buffer-connector-fixture.mts` | Buffer A–L |
| `npm run generate:divisions` | agency-agents → division map |
| `npm run validate:agents` | Bundled manifest / SHA256 / TOML / required agents |
| `node --import tsx scripts/verify-cloud-registry.mts` | Cloud registry + Local regression |
| `node --import tsx scripts/verify-project-cas.mts` | Concurrent project writes + ownership fixtures |
| `node scripts/verify-agent-client-isolation.mjs` | Server instructions absent from built client |

## Architecture Freeze

이번에 승인된 Cloud Runtime Phase 1은 Agent Registry·GitHub Workspace·Vercel Sandbox에 한정합니다. Phase 1의 실제 검증이 완료되기 전 Cloud Codex 인증·Cloud ChatGPT 로그인·전체 Agent workflow 이전으로 확장하지 않습니다. Office·Marketing·SNS는 이번 범위에 포함하지 않습니다.

## 클라우드 배포 (Vercel + Supabase)

로컬에서는 지금처럼 `npm run dev`로 실행합니다(로그인 없음, 데이터는 `server/data/`).
Vercel에 배포하면 클라우드 모드로 바뀝니다.

| 항목 | 클라우드 모드 동작 |
|------|------|
| 로그인 | Supabase Auth 이메일 링크. `AGENT_DECK_ALLOWED_EMAILS`에 있는 이메일만 API 사용 가능 |
| 데이터 | 서버의 데이터 폴더가 Supabase `public.fs_files` 테이블에 저장됨 (`server/src/storage/dataFs.ts`) |
| 루틴 | Vercel Cron이 매일 `/api/cron/routines` 호출 (`CRON_SECRET` 필요) |
| Codex · 로컬 폴더 첨부 | 로컬 전용 — 클라우드에서는 비활성 |
| Agent Registry | Server-only bundled TOML 279개; HOME 경로 사용 안 함 |
| Project Source | GitHub Repository 기본; 로컬 폴더 source 생성 금지 |
| Workspace | 공식 `@vercel/sandbox` SDK; 명시적 환경 준비·확인·종료 |

Vercel 환경변수: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`AGENT_DECK_ALLOWED_EMAILS`, `CRON_SECRET`, `OPENAI_API_KEY` (필요 시 `BUFFER_API_KEY` 등).
Supabase → Authentication → URL Configuration의 **Site URL**을 배포 주소로 맞춰야 로그인 링크가 앱으로 돌아옵니다.
설정이 빠지면 서버는 모든 요청을 거부합니다(fail closed).

### Cloud Runtime Phase 1 requirements

- Vercel 배포와 Supabase Auth·allowlist·`public.fs_files` 저장소
- Supabase migrations: workspace lease/fencing 및 project snapshot CAS RPC. 원격 적용·검증이 필요합니다.
- Sandbox 인증: Vercel의 `VERCEL_OIDC_TOKEN`, 또는 서버 전용 `VERCEL_TOKEN` + `VERCEL_TEAM_ID` + `VERCEL_PROJECT_ID`
- 비공개 저장소: 서버 전용 `GITHUB_TOKEN` (공개 저장소에는 선택). 토큰을 저장소 URL에 넣지 않습니다.
- Cloud 프로젝트 생성 후 개요의 **환경 준비**를 명시적으로 눌러 provision합니다. **환경 확인**은 lockfile에 맞춰 install, 존재하는 typecheck/build/test를 실행합니다.

Workspace metadata는 Supabase에 저장하고 다른 Function 인스턴스에서 named Sandbox에 재연결합니다. 프로젝트 삭제는 Sandbox와 Agent Deck 데이터만 정리하고 GitHub 저장소·브랜치·커밋은 삭제하지 않습니다. Local mode는 계속 지원합니다.

현재 상태·검증 결과·남은 blocker: [Cloud Runtime Phase 1](docs/cloud-runtime-phase1.md). **실제 Vercel smoke와 private repository 검증 전에는 READY가 아닙니다.**

### Direct SNS connections and work status

See [work UI and direct SNS setup](docs/work-ui-and-social-connections.md) for service-specific OAuth configuration. Instagram, X, YouTube and Reddit account linking currently runs on the local server; automatic token refresh, cloud login and direct posting are not implemented for these four channels.
