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
  ['연못에 물고기 늘어난 것 같지 않아요?', '진짜요? 이따 세어봐야겠다.'],
  ['요즘 읽는 책 있어요?', '사용자 인터뷰 책이요. 꽤 실용적이에요.'],
  ['오늘 퇴근하고 뭐 해요?', '운동 가려고요. 진짜로요.'],
  ['자판기 신메뉴 나왔대요.', '아까 봤어요, 유자차 괜찮던데요.'],
  ['요즘 리텐션 지표 보셨어요?', '주간 재방문이 조금 올랐더라고요.'],
  ['키보드 바꿨어요?', '네, 소리가 좀 크죠? 죄송해요.'],
  ['어제 배포 무사히 됐죠?', '네, 롤백 없이 깔끔했어요.'],
  ['이 소파 진짜 편하네요.', '그래서 다들 여기서 회의하려고 하잖아요.'],
  ['주말에 뭐 하셨어요?', '카페 투어요. 앱 아이디어도 하나 얻었어요.'],
  ['사용자 피드백 새로 들어온 거 봤어요?', '봤어요, 온보딩이 길다는 얘기가 많네요.'],
  ['오늘따라 집중이 잘 되네요.', '저도요. 조용해서 그런가 봐요.'],
  ['화분에 물 줬어요?', '아침에 줬어요. 잎이 좀 살아났어요.'],
  ['요즘 경쟁 앱들 업데이트 빠르네요.', '그러니까요, 우리도 한 템포 빨리 가야죠.'],
  ['디저트 사 왔는데 드실래요?', '감사해요! 딱 당 떨어질 때였어요.'],
  ['어제 본 영상 진짜 웃겼어요.', '링크 좀 보내주세요, 이따 볼게요.'],
  ['노트북 배터리 몇 프로예요?', '12퍼요… 충전기 어디 뒀더라.'],
  ['다음 회고 때 무슨 얘기 할까요?', '인수인계가 매끄러워진 건 꼭 칭찬해요.'],
  ['비 온대요, 우산 챙겼어요?', '아뇨… 회사에 하나 있었던 것 같은데요.'],
  ['요즘 제일 많이 쓰는 단축키 뭐예요?', '커맨드 K요. 없으면 못 살아요.'],
  ['창가 자리 햇빛 좋네요.', '오후엔 좀 덥긴 한데 기분은 좋아요.'],
]

function workTalk(title: string): Array<[string, string]> {
  const t = title.length > 22 ? `${title.slice(0, 21)}…` : title
  return [
    [`아까 "${t}" 결과 보셨어요?`, '네, 출처까지 정리돼 있어서 보기 좋던데요.'],
    [`"${t}" 수고 많으셨어요.`, '다들 인수인계를 잘 해줘서 금방 끝났어요.'],
    [`"${t}" 다음엔 뭐 할까요?`, '보고서 보고 바로 실행 계획 잡아봐도 좋을 것 같아요.'],
  ]
}

// Remember what was said recently so the same exchange does not come back soon.
const recent: string[] = []
const RECENT_MAX = 12

export function pickExchange(_seed: number, recentTaskTitle?: string): [string, string] {
  const pool = recentTaskTitle ? [...workTalk(recentTaskTitle), ...SMALL_TALK] : SMALL_TALK
  const fresh = pool.filter(([a]) => !recent.includes(a))
  const choices = fresh.length ? fresh : pool
  const pick = choices[Math.floor(Math.random() * choices.length)]!
  recent.push(pick[0])
  if (recent.length > RECENT_MAX) recent.shift()
  return pick
}
