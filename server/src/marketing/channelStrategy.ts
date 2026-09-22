/**
 * Research-informed channel strategy.
 * Soft signals only — never "if game then Instagram" hard rules.
 */

import type {
  MarketingChannel,
  MarketingChannelPlan,
  MarketingContentType,
  MarketingWebSource,
} from './marketingTypes.js'

export interface ChannelStrategyInput {
  projectType?: string
  stage?: string
  productName?: string
  /** Free-text research / context (sources + findings) */
  researchText: string
  sources: MarketingWebSource[]
}

const CHANNEL_CATALOG: Array<{
  channel: MarketingChannel
  contentTypes: MarketingContentType[]
  requiredCapabilities: string[]
  /** Soft keyword signals — scored from research text, not project type alone */
  signals: string[]
  baseRationale: string
}> = [
  {
    channel: 'threads',
    contentTypes: ['post', 'thread'],
    requiredCapabilities: ['marketing.content', 'content.write'],
    signals: [
      'threads',
      'conversational',
      'short-form social',
      'microblogging',
      'meta social',
    ],
    baseRationale: '짧은 대화형 SNS로 인식/참여에 적합',
  },
  {
    channel: 'instagram',
    contentTypes: ['image_post', 'short_video'],
    requiredCapabilities: [
      'marketing.content',
      'content.write',
      'image.generate',
    ],
    signals: [
      'instagram',
      'reels',
      'visual',
      'lifestyle',
      'screenshot',
      '크리에이티브',
    ],
    baseRationale: '비주얼 중심 채널 — creative brief 필요',
  },
  {
    channel: 'reddit',
    contentTypes: ['community_post'],
    requiredCapabilities: ['marketing.content', 'content.write', 'research.web'],
    signals: [
      'reddit',
      'subreddit',
      'community',
      'discussion',
      'forum',
      '커뮤니티',
    ],
    baseRationale: '커뮤니티 토론형 — 스팸/홍보성 주의',
  },
  {
    channel: 'youtube',
    contentTypes: ['short_video'],
    requiredCapabilities: [
      'marketing.content',
      'content.write',
      'video.generate',
    ],
    signals: ['youtube', 'shorts', 'video', 'trailer', 'walkthrough'],
    baseRationale: '숏폼/비디오 컨셉 채널',
  },
  {
    channel: 'blog',
    contentTypes: ['article'],
    requiredCapabilities: ['document.write', 'content.write'],
    signals: ['blog', 'article', 'long-form', 'seo', '가이드'],
    baseRationale: '긴 형식 설명/SEO',
  },
  {
    channel: 'x',
    contentTypes: ['post', 'thread'],
    requiredCapabilities: ['marketing.content', 'content.write'],
    signals: ['twitter', ' x ', 'tweet', '실시간'],
    baseRationale: '실시간 단문 업데이트',
  },
  {
    channel: 'community',
    contentTypes: ['community_post', 'update'],
    requiredCapabilities: ['marketing.content', 'content.write'],
    signals: ['discord', 'community', '카페', '포럼', 'steam community'],
    baseRationale: '제품 커뮤니티/포럼',
  },
]

function scoreChannel(
  entry: (typeof CHANNEL_CATALOG)[number],
  text: string,
  projectType?: string,
): number {
  let score = 0
  for (const s of entry.signals) {
    if (text.includes(s.toLowerCase())) score += 3
  }
  // Soft project-type nudge only (never sole decision)
  const pt = (projectType ?? '').toLowerCase()
  if (pt.includes('game') && ['instagram', 'youtube', 'reddit', 'threads'].includes(entry.channel)) {
    score += 1
  }
  if ((pt.includes('saas') || pt.includes('web')) && ['blog', 'x', 'threads'].includes(entry.channel)) {
    score += 1
  }
  if (pt.includes('mobile') && ['instagram', 'threads', 'youtube'].includes(entry.channel)) {
    score += 1
  }
  return score
}

/**
 * Pick enabled channels from research + soft context signals.
 * Returns only channels with score > 0, sorted by score, capped.
 */
export function recommendChannels(
  input: ChannelStrategyInput,
  opts?: { maxChannels?: number },
): MarketingChannelPlan[] {
  const text = [
    input.researchText,
    ...input.sources.map((s) => `${s.title} ${s.snippet ?? ''} ${s.domain}`),
  ]
    .join('\n')
    .toLowerCase()

  const max = opts?.maxChannels ?? 4
  const scored = CHANNEL_CATALOG.map((entry) => {
    const score = scoreChannel(entry, text, input.projectType)
    return { entry, score }
  })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)

  // If research mentioned nothing, enable a conservative default set from soft signals only
  const picked =
    scored.length > 0
      ? scored.slice(0, max)
      : CHANNEL_CATALOG.filter((e) =>
          ['threads', 'blog'].includes(e.channel),
        ).map((entry) => ({ entry, score: 1 }))

  return picked.map(({ entry, score }) => {
    const needsImage = entry.requiredCapabilities.includes('image.generate')
    const needsVideo = entry.requiredCapabilities.includes('video.generate')
    const needsPublish = true
    let publishStatus: MarketingChannelPlan['publishStatus'] = 'draft'
    if (needsImage || needsVideo) {
      // Visual tooling future — content can still be drafted with briefs
      publishStatus = 'ready'
    }
    void needsPublish

    return {
      channel: entry.channel,
      enabled: true,
      rationale: `${entry.baseRationale} (research score=${score})`,
      audienceFit: audienceFitFor(entry.channel, input),
      contentTypes: entry.contentTypes,
      cadence: 'campaign-burst',
      risks: risksFor(entry.channel),
      requiredCapabilities: entry.requiredCapabilities,
      publishStatus,
      score,
    }
  })
}

function audienceFitFor(
  channel: MarketingChannel,
  input: ChannelStrategyInput,
): string {
  const name = input.productName ?? 'product'
  if (channel === 'reddit') {
    return `${name} 관련 커뮤니티에서 문제/관심사 기반 토론`
  }
  if (channel === 'instagram') {
    return `시각적으로 ${name}의 핵심 경험을 보여주는 사용자`
  }
  if (channel === 'threads') {
    return `${name}에 관심 있는 캐주얼 SNS 사용자`
  }
  if (channel === 'youtube') {
    return `숏폼으로 ${name} 플레이/사용을 보는 시청자`
  }
  if (channel === 'blog') {
    return `검색·비교를 하는 숙고형 사용자`
  }
  return `${name} 잠재 사용자`
}

function risksFor(channel: MarketingChannel): string[] {
  if (channel === 'reddit') {
    return ['커뮤니티 규칙 위반', '노골적 홍보 스팸으로 인식']
  }
  if (channel === 'instagram') {
    return ['이미지 툴 미연결 시 시각물 미완성', '과도한 해시태그']
  }
  return ['과장 광고', '사실과 다른 주장']
}
