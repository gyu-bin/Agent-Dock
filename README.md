# Agent Deck

로컬에서 돌아가는 **AI 개발 스튜디오**입니다. 프로젝트를 열고 자연어로 일을 시키면, Agent Deck이 Agent·Tool·Workflow를 자동으로 구성합니다.

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

## AI 실행 모드

| 상태 | 의미 |
|------|------|
| **REAL** | Provider 설정됨 — 실제 AI 사용 (기본) |
| **NOT_CONFIGURED** | AI 설정 필요 |
| **MOCK** | Settings → **고급** → **Developer Mode**에서만 명시 활성화 |

Provider 실패 시 **자동 Mock 전환은 하지 않습니다.**

### 에이전트 실행 지침 경로

목록 조회와 OpenAI/Codex 실행은 같은 경로 resolver를 사용합니다. 우선순위는 명시적 호출 경로 → 설정의 `agents.codexAgentsDir` → `AGENT_DECK_AGENTS_DIR` → 서버 사용자 홈의 `~/.codex/agents`입니다. `~`는 서버 사용자 홈으로 확장하고, 상대 경로도 서버 사용자 홈을 기준으로 해석합니다. 작업 디렉터리 변경으로 경로가 달라지지 않으며, 존재하는 경로는 실제 경로로 정규화합니다.

`AGENT_DECK_AGENCY_DIR`는 부서 분류용 Markdown 소스입니다. TOML 실행 지침 경로로 사용하지 않습니다. 클라우드 서버는 개발자 컴퓨터의 `~/.codex/agents`에 접근할 수 없으므로 해당 서버에서 읽을 수 있는 지침 경로를 별도로 준비해야 합니다.

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

## Architecture Freeze

Core Architecture는 Freeze 상태입니다. 다음 단계는 **REAL PROJECT DOGFOOD**입니다.  
새 Foundation / Orchestrator / Memory / Social rewrite를 추가하지 않습니다.

## 클라우드 배포 (Vercel + Supabase)

로컬에서는 지금처럼 `npm run dev`로 실행합니다(로그인 없음, 데이터는 `server/data/`).
Vercel에 배포하면 클라우드 모드로 바뀝니다.

| 항목 | 클라우드 모드 동작 |
|------|------|
| 로그인 | Supabase Auth 이메일 링크. `AGENT_DECK_ALLOWED_EMAILS`에 있는 이메일만 API 사용 가능 |
| 데이터 | 서버의 데이터 폴더가 Supabase `public.fs_files` 테이블에 저장됨 (`server/src/storage/dataFs.ts`) |
| 루틴 | Vercel Cron이 매일 `/api/cron/routines` 호출 (`CRON_SECRET` 필요) |
| Codex · 로컬 폴더 첨부 | 로컬 전용 — 클라우드에서는 비활성 |

Vercel 환경변수: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`AGENT_DECK_ALLOWED_EMAILS`, `CRON_SECRET`, `OPENAI_API_KEY` (필요 시 `BUFFER_API_KEY` 등).
Supabase → Authentication → URL Configuration의 **Site URL**을 배포 주소로 맞춰야 로그인 링크가 앱으로 돌아옵니다.
설정이 빠지면 서버는 모든 요청을 거부합니다(fail closed).
