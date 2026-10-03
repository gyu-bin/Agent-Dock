/** Short two-line exchanges for resting staff. Some lines reference the team's real recent work. */

const SMALL_TALK: Array<[string, string]> = [
  ['커피 한 잔 더 하실래요?', '좋죠, 오늘 원두 괜찮더라고요.'],
  ['점심 뭐 드셨어요?', '김치찌개요. 든든하네요.'],
  ['요즘 재밌게 쓰는 앱 있어요?', '습관 트래커 하나 쓰는데 은근 계속 켜게 돼요.'],
  ['날씨 좋다, 가든 한 바퀴 돌까요?', '좋아요, 머리 좀 식히고 와요.'],
  ['어제 그 회의 길었죠…', '그래도 결론은 깔끔하게 났어요.'],
  ['이번 주 목표 몇 개 남았어요?', '두 개요. 금방 끝날 것 같아요.'],
  ['책상 정리 좀 해야겠어요.', '저도요, 포스트잇이 산이에요.'],
  ['새로 나온 디자인 트렌드 봤어요?', '네, 요즘은 다시 단순한 게 대세더라고요.'],
  ['잠깐 스트레칭 하고 올게요.', '같이 가요, 어깨가 뻐근해서.'],
  ['다음 스프린트 뭐 하는지 들었어요?', '아직이요. PM님이 곧 공유한대요.'],
]

function workTalk(title: string): Array<[string, string]> {
  const t = title.length > 22 ? `${title.slice(0, 21)}…` : title
  return [
    [`아까 "${t}" 결과 보셨어요?`, '네, 출처까지 정리돼 있어서 보기 좋던데요.'],
    [`"${t}" 수고 많으셨어요.`, '다들 인수인계를 잘 해줘서 금방 끝났어요.'],
  ]
}

/** Deterministic-ish pick so the same pair does not repeat back to back. */
export function pickExchange(seed: number, recentTaskTitle?: string): [string, string] {
  const pool = recentTaskTitle ? [...workTalk(recentTaskTitle), ...SMALL_TALK] : SMALL_TALK
  return pool[Math.abs(seed) % pool.length]
}
