# Pixel Office generator

홈 화면 오피스(`client/src/office/pixel/PixelOfficeScene.tsx`)에서 쓰는 도트 에셋을 **코드로 직접 그리는** 생성기입니다. 외부 에셋이 없으니 라이선스 걱정이 없고, 팔레트와 격자(16px 타일, 캐릭터 24×32)가 한 곳에서 관리됩니다.

```bash
pip install pillow   # 최초 1회
python3 tools/pixel-office/generate.py
```

결과물은 `client/public/assets/pixel-office/`에 저장됩니다.

| 파일 | 내용 |
|------|------|
| `office-bg.png` | 바닥·벽·창문·의자 등 캐릭터 뒤에 깔리는 평면 레이어 (768×480) |
| `props.png` | 깊이 정렬이 필요한 가구 스프라이트 아틀라스 |
| `office-map.json` | 맵 SoT — 가구 배치(z), 좌석 waypoint, 8px 이동 격자, 방 라벨, 로비 |
| `characters/*.png` | 레이어 아틀라스: `skin-*` / `outfit-{role}` / `hair-{style}-{color}` / `acc-*` |
| `characters.json` | 프레임 크기, 애니메이션 행, 변형 목록 |
| `bubbles.png/json` | 상태 말풍선 (…, !, ✓, zzz, ♪, 커피, 아이디어) |

## 구조

- `generate.py` — 방 좌표, 문, 가구 배치, waypoint, 이동 격자. 실행 시 **필수 waypoint 누락**과 **출입구에서 도달 불가능한 좌석**을 검사해 문제가 있으면 exit 1.
- `props.py` — 가구 스프라이트. 각 함수가 `(이미지, footprint, sortY)`를 반환. footprint는 이동 격자에서 막히는 영역.
- `characters.py` — 4방향 대기·걷기·앉기 프레임. 역할(8종) 옷 + 피부 3 × 헤어 4스타일 × 6색 + 역할별 액세서리를 런타임에 겹쳐서 에이전트마다 다른 외형을 만듦.

## 상태 → 위치

`client/src/office/v2/officeAssignmentPolicy.ts`(기존 정책 그대로 재사용)가 상태별 waypoint id를 정하고, waypoint 좌표/자세는 `office-map.json`이 제공합니다.

- 대기/waiting → 휴게실·가든 (`lounge.*`)
- 작업/막힘 → 부서 자리 (`{product|gamedev|design|research|development|marketing|testing}.desk.N`)
- 리뷰 → 회의실 (`meeting.seat.N`)
- 검증 → 테스트룸 (`testing.desk.N`)
- 오프라인 → 오피스에서 숨김

리셉션은 제거했습니다. 중앙 휴게실 남쪽은 넓게 열린 테라스로 이어지고, 테라스와 가든 사이에 벽이나 유리문 없이 이동할 수 있습니다. 기존 리셉션 책상과 의자는 배치하지 않습니다.

waypoint id를 바꾸면 정책 파일의 목록과 함께 맞춰야 합니다.
