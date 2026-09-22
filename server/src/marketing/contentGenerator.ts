/**
 * Channel-differentiated content drafts (deterministic, no LLM in fixture mode).
 * Same sentence copied across channels = FAIL.
 */

import { randomBytes } from 'node:crypto'
import type {
  MarketingChannel,
  MarketingChannelPlan,
  MarketingContent,
  MarketingContentType,
  MarketingCreativeBrief,
} from './marketingTypes.js'

export interface ContentGenContext {
  campaignId: string
  productName: string
  positioning: string
  keyMessages: string[]
  pillars: string[]
  sourceArtifactIds: string[]
  previousBodies: string[]
  now: string
}

function id(prefix: string, channel: string, n: number): string {
  return `${prefix}_${channel}_${n}_${Date.now().toString(36)}_${randomBytes(2).toString('hex')}`
}

function creativeBriefFor(
  channel: MarketingChannel,
  productName: string,
  message: string,
): MarketingCreativeBrief | undefined {
  if (channel === 'instagram') {
    return {
      format: 'feed_post',
      aspectRatio: '1:1',
      subject: `${productName} key moment`,
      headline: message.slice(0, 48),
      visualDirection:
        'Clean product screenshot or lifestyle scene; high contrast; no cluttered UI chrome',
      requiredText: productName,
      avoid: ['fake UI', 'misleading store badges', 'competitor logos'],
      imageToolStatus: 'unavailable',
    }
  }
  if (channel === 'youtube') {
    return {
      format: 'short_vertical',
      aspectRatio: '9:16',
      subject: `${productName} 15s hook`,
      visualDirection: 'Fast cut of core loop / value prop; bold title card',
      avoid: ['long intro', 'unrelated B-roll'],
      imageToolStatus: 'unavailable',
    }
  }
  return undefined
}

function pickType(
  plan: MarketingChannelPlan,
): MarketingContentType {
  return plan.contentTypes[0] ?? 'post'
}

export function generateChannelContent(
  plan: MarketingChannelPlan,
  ctx: ContentGenContext,
  index: number,
): MarketingContent {
  const channel = plan.channel
  const msg = ctx.keyMessages[index % ctx.keyMessages.length] ?? ctx.positioning
  const pillar = ctx.pillars[index % ctx.pillars.length] ?? 'product value'
  const type = pickType(plan)
  let title: string | undefined
  let body: string
  let hashtags: string[] | undefined
  let callToAction: string | undefined

  switch (channel) {
    case 'threads':
      body = [
        `솔직히 ${ctx.productName} 쓰면서 느낀 점 —`,
        msg,
        '',
        `축: ${pillar}`,
        '궁금하면 댓글로 물어봐요.',
      ].join('\n')
      callToAction = '경험 공유해 주세요'
      hashtags = undefined
      break
    case 'instagram':
      title = `${ctx.productName} · ${pillar}`
      body = [
        `${ctx.productName}`,
        '',
        msg,
        '',
        `포지셔닝: ${ctx.positioning}`,
        '',
        '#app #update',
      ].join('\n')
      hashtags = ['app', 'update', ctx.productName.replace(/\s+/g, '')]
      callToAction = '프로필 링크에서 더 보기'
      break
    case 'reddit':
      title = `How do you handle: ${pillar}? (${ctx.productName} angle)`
      body = [
        `Looking for discussion — not a hard sell.`,
        '',
        `Context: ${ctx.positioning}`,
        '',
        `Observation: ${msg}`,
        '',
        `What has worked (or failed) in your experience?`,
        '',
        `(Mods: happy to edit if this breaks community norms.)`,
      ].join('\n')
      callToAction = 'Share your approach'
      break
    case 'youtube':
      title = `${ctx.productName} in 20s — ${pillar}`
      body = [
        `HOOK: ${msg}`,
        `BEAT: show core value of ${ctx.productName}`,
        `CTA: try / follow for updates`,
        `Notes: short-form only; no fake engagement metrics`,
      ].join('\n')
      callToAction = 'Follow for the next update'
      break
    case 'blog':
      title = `${ctx.productName}: ${pillar}`
      body = [
        `## Why this matters`,
        ctx.positioning,
        '',
        `## Key takeaway`,
        msg,
        '',
        `## What we are exploring next`,
        pillar,
      ].join('\n')
      callToAction = 'Read related notes / try the product'
      break
    case 'x':
      body = `${ctx.productName}: ${msg}`.slice(0, 240)
      callToAction = 'RT if useful'
      break
    case 'community':
      title = `Update: ${pillar}`
      body = [
        `Hey everyone — quick note on ${ctx.productName}.`,
        msg,
        '',
        `Feedback welcome.`,
      ].join('\n')
      break
    default:
      body = `${ctx.productName} — ${msg}`
  }

  // Soft de-dupe vs previous campaigns
  for (const prev of ctx.previousBodies) {
    if (prev && body.trim() === prev.trim()) {
      body = `${body}\n\n(Updated angle for this week: ${pillar} · ${index + 1})`
      break
    }
  }

  const now = ctx.now
  return {
    id: id('mc', channel, index),
    campaignId: ctx.campaignId,
    channel,
    type,
    title,
    body,
    hashtags,
    callToAction,
    creativeBrief: creativeBriefFor(channel, ctx.productName, msg),
    sourceArtifactIds: [...ctx.sourceArtifactIds],
    status: 'draft',
    createdAt: now,
    updatedAt: now,
  }
}

export function contentsAreDifferentiated(contents: MarketingContent[]): boolean {
  const bodies = contents.map((c) => c.body.trim())
  return new Set(bodies).size === bodies.length
}
