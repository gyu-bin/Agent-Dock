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
