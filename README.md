# Agent Deck

로컬에서 돌아가는 **AI 개발 스튜디오**입니다. AI 직원을 회사처럼 조직하고, 2D 오피스에서 상태를 보며, 작업·승인·결과물·지식을 한 흐름으로 관리합니다.

## 주요 기능

- **프로젝트 / 팀** — 프로젝트별 에이전트 채용·부서 분류
- **홈 오피스** — 팀 상태 시각화 + 「무엇을 시킬까요?」작업 요청
- **작업 흐름** — WorkflowTemplate 기반 자동 매칭·파이프라인
- **AI 서비스** — OpenAI Provider, Codex 실행, 웹 검색
- **승인** — 계획 승인 · 코드 변경 승인 (Diff / Rollback)
- **결과물 · 프로젝트 지식** — Artifact / Handoff / Knowledge
- **사용량 · 설정** — 비용·토큰, 안전·고급 옵션
- **로컬 보안** — Local Session, Execution Lock, Path Sandbox, Persistence

## 아키텍처

| 영역 | 기술 |
|------|------|
| Client | React · Vite · TypeScript · Zustand |
| Server | Express · Agent Registry (TOML) · Persistence |
| Office | DOM / CSS / SVG (독립 viewport, 교체 가능) |

기본 Happy Path:

프로젝트 선택 → 무엇을 시킬까요? → 작업 흐름 자동 구성 → (필요 시) 계획 승인 → AI 작업 → (필요 시) 코드 변경 승인 → 검증/리뷰 → 결과 확인

Provider · Model · Workflow ID · Agent ID 등은 **설정 → 고급**에서만 다룹니다.

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
```

## AI 실행 모드

| 상태 | 의미 |
|------|------|
| **REAL** | Provider 설정됨 — 실제 AI 사용 (기본) |
| **NOT_CONFIGURED** | AI 설정 필요 |
| **MOCK** | Settings → **고급** → **Developer Mode**에서만 명시 활성화 |

Provider 실패 시 **자동 Mock 전환은 하지 않습니다.**  
테스트 fixture의 Mock 사용은 유지됩니다.

## 보안 · 로컬 정책

- 기본은 **로컬 전용** 실행
- 프로젝트 path sandbox
- Execution lock으로 동시 실행 충돌 방지
- 세션·프로젝트 데이터는 서버 로컬 persistence

## 스크립트

| Command | Description |
|---------|-------------|
| `npm run dev` | Client + server |
| `npm run build` | Production build |
| `npm run typecheck` | TypeScript check |
| `npm run generate:divisions` | agency-agents → division map 갱신 |

## Agent Registry

Division은 agency-agents 디렉터리 레이아웃을 따릅니다.

1. `AGENT_DECK_AGENCY_DIR` 또는 기본 agency-agents 경로 스캔
2. 없으면 `shared/agencyDivisionMap.json`

외부 `agency-agents` 저장소는 수정하지 않습니다.

## 네비게이션

**사이드바:** 홈 · 프로젝트 · 작업 · 결과물 · 승인 대기 · (하단) 설정  

전체 Agent Directory · Usage · Departments는 핵심 메뉴가 아니며, 팀 관리 / 설정 고급에서 접근합니다.
