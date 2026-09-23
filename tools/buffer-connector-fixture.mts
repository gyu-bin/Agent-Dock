/**
 * Buffer Connector fixtures A–L.
 * Run: node --import tsx tools/buffer-connector-fixture.mts
 * No real Buffer API. Fake GraphQL only.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  BufferConnector,
  BufferPublishService,
  JsonSocialRepository,
  localWallTimeToUtcIso,
  bufferStatusToPublishedStatus,
  isBufferError,
  createBufferError,
} from '../server/src/social/index.ts'
import type { BufferGraphQLFn } from '../server/src/social/index.ts'
import { JsonMarketingRepository } from '../server/src/marketing/marketingRepository.ts'
import { MarketingService } from '../server/src/marketing/marketingService.ts'
import { JsonArtifactRepository } from '../server/src/persistence/artifactRepository.ts'
import { ArtifactService } from '../server/src/persistence/artifactService.ts'
import { JsonProjectRepository } from '../server/src/persistence/jsonStore.ts'
import { ProjectService } from '../server/src/persistence/projectService.ts'
import {
  FakeMediaDeliveryProvider,
  UnconfiguredMediaDeliveryProvider,
  createMediaDeliveryService,
  JsonMediaDeliveryRepository,
} from '../server/src/mediaDelivery/index.ts'
import { ImageStorage, FIXTURE_PNG_1X1 } from '../server/src/image/index.ts'
import { assertNoTokenLeak } from '../server/src/credentials/redact.ts'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg)
}

function eq<T>(a: T, b: T, msg: string) {
  assert(a === b, `${msg}: expected ${String(b)}, got ${String(a)}`)
}

const dir = mkdtempSync(path.join(tmpdir(), 'ad-buf-'))
const marketingDir = path.join(dir, 'marketing')
const socialDir = path.join(dir, 'social')
const artifactsDir = path.join(dir, 'artifacts')
const genDir = path.join(dir, 'generated')
const deliveryDir = path.join(dir, 'media-delivery')
const projectsFile = path.join(dir, 'projects.json')

process.env.AGENT_DECK_GENERATED_DIR = genDir
delete process.env.BUFFER_API_KEY

const PROJECT_A = 'proj_buf_a'
const PROJECT_B = 'proj_buf_b'

const projects = new ProjectService(new JsonProjectRepository(projectsFile))
const artifacts = new ArtifactService(new JsonArtifactRepository(artifactsDir))
const marketingRepo = new JsonMarketingRepository(marketingDir)
const socialRepo = new JsonSocialRepository(socialDir)
const storage = new ImageStorage(genDir)

const SOURCES = [
  {
    id: 'src_threads',
    title: 'Threads engagement',
    url: 'https://example.com/threads',
    domain: 'example.com',
    snippet: 'conversational threads posts for apps',
  },
]

let createPostCalls = 0
let lastCreateVariables: Record<string, unknown> | null = null

function makeFakeGql(opts?: {
  mutationError?: boolean
  postStatus?: string
}): BufferGraphQLFn {
  return async ({ query, variables }) => {
    if (query.includes('GetOrganizations') || query.includes('account {')) {
      return {
        httpStatus: 200,
        data: {
          account: {
            id: 'acc_1',
            organizations: [{ id: 'org_1', name: 'AgentDeck Org' }],
          },
        },
      }
    }
    if (query.includes('channels(') || query.includes('GetChannels')) {
      return {
        httpStatus: 200,
        data: {
          channels: [
            {
              id: 'ch_threads_1',
              name: 'agentdeck_threads',
              service: 'threads',
            },
            {
              id: 'ch_ig_1',
              name: 'agentdeck_ig',
              service: 'instagram',
            },
          ],
        },
      }
    }
    if (query.includes('createPost')) {
      createPostCalls += 1
      lastCreateVariables = variables ?? null
      if (opts?.mutationError) {
        return {
          httpStatus: 200,
          data: {
            createPost: {
              __typename: 'MutationError',
              message: 'fixture mutation error',
            },
          },
        }
      }
      const input = (variables as { input?: Record<string, unknown> })?.input
      return {
        httpStatus: 200,
        data: {
          createPost: {
            __typename: 'PostActionSuccess',
            post: {
              id: `bufpost_${createPostCalls}`,
              text: input?.text,
              status: opts?.postStatus ?? 'scheduled',
              dueAt: input?.dueAt ?? null,
            },
          },
        },
      }
    }
    if (query.includes('post(id:') || query.includes('GetPost')) {
      return {
        httpStatus: 200,
        data: {
          post: {
            id: String((variables as { id?: string })?.id ?? 'bufpost_1'),
            status: 'scheduled',
            dueAt: null,
            text: 'hello',
          },
        },
      }
    }
    return { httpStatus: 200, data: {} }
  }
}

async function seedProjects() {
  const now = new Date().toISOString()
  await new JsonProjectRepository(projectsFile).save({
    version: 5,
    revision: 1,
    activeProjectId: PROJECT_A,
    projects: [
      {
        id: PROJECT_A,
        name: "Don't Move",
        type: 'mobile-game',
        status: 'active',
        agentIds: ['product-manager'],
        createdAt: now,
        updatedAt: now,
      },
      {
        id: PROJECT_B,
        name: 'Other',
        type: 'web-app',
        status: 'active',
        agentIds: ['frontend-developer'],
        createdAt: now,
        updatedAt: now,
      },
    ],
    tasks: [],
    pipelineSteps: [],
    agentRuns: [],
    codexRuns: [],
  })
}

function makeMarketing(mediaDelivery = null as ReturnType<
  typeof createMediaDeliveryService
> | null) {
  return new MarketingService(
    marketingRepo,
    projects,
    artifacts,
    null,
    null,
    null,
    null,
    null,
  )
}

async function makeApprovedThreads(opts?: {
  projectId?: string
  publishMode?: 'queue' | 'now' | 'scheduled' | 'draft'
  dueAt?: string | null
  withImage?: boolean
}) {
  const projectId = opts?.projectId ?? PROJECT_A
  const marketing = makeMarketing()
  const result = await marketing.runCampaign({
    projectId,
    title: 'Buffer fixture campaign',
    request: 'threads conversational posts',
    fixtureSources: SOURCES,
    allowWithoutSearch: true,
    searchAvailable: false,
    teamAgentIds: ['product-manager'],
  })
  let content =
    result.contents.find((c) => c.channel === 'threads') ?? result.contents[0]
  assert(content, 'need threads content')

  if (opts?.withImage) {
    const written = await storage.writeImage({
      projectId,
      imageId: `img_${Date.now().toString(36)}`,
      bytes: FIXTURE_PNG_1X1,
      ext: 'png',
    })
    const art = await artifacts.createArtifact({
      projectId,
      type: 'creative-image',
      title: 'fixture image',
      summary: 'buffer fixture png',
      contentType: 'json',
      content: JSON.stringify({
        filePath: written.filePath,
        publicPath: written.publicPath,
        mimeType: 'image/png',
      }),
      status: 'draft',
      metadata: {
        kind: 'creative-image',
        mimeType: 'image/png',
        publicPath: written.publicPath,
        filePath: written.filePath,
      },
    })
    const snap = await marketingRepo.load(projectId)
    const c = snap.contents.find((x) => x.id === content!.id)!
    c.creativeArtifactIds = [art.id]
    c.updatedAt = new Date().toISOString()
    await marketingRepo.save(snap)
    content = c
  }

  await marketing.approveCampaign(result.campaign.id, {
    projectId,
    publishMode: opts?.publishMode ?? 'queue',
    dueAt: opts?.dueAt ?? null,
  })
  const hit = await marketing.getCampaign(result.campaign.id, projectId)
  assert(hit, 'campaign after approve')
  content = hit.contents.find((c) => c.id === content!.id) ?? hit.contents[0]!
  return { campaign: hit.campaign, content, contents: hit.contents, marketing }
}

try {
  await seedProjects()
  console.log('Buffer fixture dir', dir)

  // ——— A: no API key → unavailable ———
  {
    const conn = createBufferConnectorNoKey()
    const state = await conn.refreshState()
    eq(state.configured, false, 'A configured')
    eq(state.available, false, 'A available')
    const pub = conn.toPublicStatus()
    assertNoTokenLeak(pub)
    assert(!JSON.stringify(pub).includes('BUFFER_API_KEY'), 'A no key leak')
    console.log('A PASS — BUFFER_API_KEY absent → unavailable')
  }

  // ——— B: fake GraphQL discovery ———
  {
    const conn = BufferConnector.withFakeGraphQL(makeFakeGql())
    const state = await conn.refreshState()
    eq(state.available, true, 'B available')
    eq(state.channels.length, 2, 'B channels')
    eq(state.channels[0]!.service, 'threads', 'B threads service')
    const pub = conn.toPublicStatus()
    assertNoTokenLeak(pub)
    console.log('B PASS — channel discovery')
  }

  // ——— C: approved → createPost(queue) ———
  createPostCalls = 0
  {
    const conn = BufferConnector.withFakeGraphQL(makeFakeGql())
    const mediaDelivery = createMediaDeliveryService({
      artifacts,
      repo: new JsonMediaDeliveryRepository(deliveryDir),
      provider: new FakeMediaDeliveryProvider(),
    })
    const svc = new BufferPublishService(
      conn,
      socialRepo,
      marketingRepo,
      artifacts,
      mediaDelivery,
      null,
    )
    const { campaign, content } = await makeApprovedThreads({
      publishMode: 'queue',
    })
    const result = await svc.publishToBuffer({
      projectId: PROJECT_A,
      contentId: content.id,
      campaignId: campaign.id,
      mode: 'queue',
    })
    eq(createPostCalls, 1, 'C createPost once')
    assert(result.record.bufferPostId, 'C bufferPostId')
    eq(result.post.status, 'buffer_queued', 'C not SNS published')
    eq(result.duplicate, false, 'C not duplicate')
    console.log('C PASS — queue createPost')
  }

  // ——— D: no approval → 0 Buffer calls ———
  {
    const before = createPostCalls
    const conn = BufferConnector.withFakeGraphQL(makeFakeGql())
    const svc = new BufferPublishService(
      conn,
      socialRepo,
      marketingRepo,
      artifacts,
      null,
      null,
    )
    const marketing = makeMarketing()
    const result = await marketing.runCampaign({
      projectId: PROJECT_A,
      title: 'No approve',
      request: 'threads posts',
      fixtureSources: SOURCES,
      allowWithoutSearch: true,
      searchAvailable: false,
      teamAgentIds: ['product-manager'],
    })
    const content =
      result.contents.find((c) => c.channel === 'threads') ?? result.contents[0]!
    let threw = false
    try {
      await svc.publishToBuffer({
        projectId: PROJECT_A,
        contentId: content.id,
        campaignId: result.campaign.id,
        mode: 'queue',
      })
    } catch {
      threw = true
    }
    assert(threw, 'D must throw')
    eq(createPostCalls, before, 'D zero createPost')
    console.log('D PASS — no approval → 0 calls')
  }

  // ——— E: approval then text edit → hash mismatch ———
  {
    const before = createPostCalls
    const conn = BufferConnector.withFakeGraphQL(makeFakeGql())
    const svc = new BufferPublishService(
      conn,
      socialRepo,
      marketingRepo,
      artifacts,
      null,
      null,
    )
    const { campaign, content, marketing } = await makeApprovedThreads({
      publishMode: 'queue',
    })
    const snap = await marketingRepo.load(PROJECT_A)
    const c = snap.contents.find((x) => x.id === content.id)!
    c.body = c.body + ' EDITED AFTER APPROVAL'
    c.updatedAt = new Date().toISOString()
    // Invalidate approval like product path
    if (campaign.publishPackage) {
      const camp = snap.campaigns.find((x) => x.id === campaign.id)!
      if (camp.publishPackage) {
        camp.publishPackage.approvalStatus = 'changes_requested'
        camp.publishPackage.approvalTokens = []
      }
    }
    await marketingRepo.save(snap)
    // Re-approve then edit without invalidating tokens to simulate TOCTOU
    await marketing.approveCampaign(campaign.id, {
      projectId: PROJECT_A,
      publishMode: 'queue',
    })
    const snap2 = await marketingRepo.load(PROJECT_A)
    const c2 = snap2.contents.find((x) => x.id === content.id)!
    c2.body = c2.body + ' MORE EDIT'
    await marketingRepo.save(snap2)

    let threw = false
    try {
      await svc.publishToBuffer({
        projectId: PROJECT_A,
        contentId: content.id,
        campaignId: campaign.id,
        mode: 'queue',
      })
    } catch (err) {
      threw = true
      assert(
        String((err as { category?: string }).category ?? err).includes(
          'HASH',
        ) ||
          String((err as { userMessage?: string }).userMessage ?? '').includes(
            '변경',
          ),
        'E hash mismatch category',
      )
    }
    assert(threw, 'E must throw')
    eq(createPostCalls, before, 'E zero createPost')
    console.log('E PASS — hash mismatch → 0 calls')
  }

  // ——— F: Asia/Seoul → UTC dueAt ———
  {
    const utc = localWallTimeToUtcIso({
      date: '2026-09-23',
      time: '18:00',
      timeZone: 'Asia/Seoul',
    })
    eq(utc, '2026-09-23T09:00:00.000Z', 'F Seoul→UTC')
    createPostCalls = 0
    lastCreateVariables = null
    const conn = BufferConnector.withFakeGraphQL(makeFakeGql())
    const svc = new BufferPublishService(
      conn,
      socialRepo,
      marketingRepo,
      artifacts,
      null,
      null,
    )
    const { campaign, content } = await makeApprovedThreads({
      publishMode: 'scheduled',
      dueAt: utc,
    })
    await svc.publishToBuffer({
      projectId: PROJECT_A,
      contentId: content.id,
      campaignId: campaign.id,
      mode: 'scheduled',
      dueAt: utc,
    })
    const input = (lastCreateVariables as { input?: { dueAt?: string; mode?: string } })
      ?.input
    eq(input?.mode, 'customScheduled', 'F share mode')
    eq(input?.dueAt, utc, 'F dueAt UTC')
    console.log('F PASS — scheduled Seoul→UTC')
  }

  // ——— G: image via Media Delivery URL ———
  {
    createPostCalls = 0
    lastCreateVariables = null
    const conn = BufferConnector.withFakeGraphQL(makeFakeGql())
    const mediaDelivery = createMediaDeliveryService({
      artifacts,
      repo: new JsonMediaDeliveryRepository(path.join(dir, 'md-g')),
      provider: new FakeMediaDeliveryProvider(),
    })
    const svc = new BufferPublishService(
      conn,
      socialRepo,
      marketingRepo,
      artifacts,
      mediaDelivery,
      null,
    )
    const { campaign, content } = await makeApprovedThreads({
      publishMode: 'queue',
      withImage: true,
    })
    await svc.publishToBuffer({
      projectId: PROJECT_A,
      contentId: content.id,
      campaignId: campaign.id,
      mode: 'queue',
    })
    const assets = (
      lastCreateVariables as { input?: { assets?: Array<{ image?: { url?: string } }> } }
    )?.input?.assets
    assert(assets?.length === 1, 'G one image asset')
    assert(assets![0]!.image?.url, 'G image url present')
    console.log('G PASS — image asset via Media Delivery')
  }

  // ——— H: Media Delivery unavailable — no silent text-only ———
  {
    const before = createPostCalls
    const conn = BufferConnector.withFakeGraphQL(makeFakeGql())
    const mediaDelivery = createMediaDeliveryService({
      artifacts,
      repo: new JsonMediaDeliveryRepository(path.join(dir, 'md-h')),
      provider: new UnconfiguredMediaDeliveryProvider(),
    })
    const svc = new BufferPublishService(
      conn,
      socialRepo,
      marketingRepo,
      artifacts,
      mediaDelivery,
      null,
    )
    const { campaign, content } = await makeApprovedThreads({
      publishMode: 'queue',
      withImage: true,
    })
    let msg = ''
    try {
      await svc.publishToBuffer({
        projectId: PROJECT_A,
        contentId: content.id,
        campaignId: campaign.id,
        mode: 'queue',
      })
    } catch (err) {
      msg = isBufferError(err)
        ? err.userMessage
        : err instanceof Error
          ? err.message
          : String(err)
    }
    assert(
      msg.includes('이미지를 Buffer에 전달할 미디어 URL을 준비할 수 없습니다'),
      `H message: ${msg}`,
    )
    eq(createPostCalls, before, 'H zero createPost')
    console.log('H PASS — media unavailable hard fail')
  }

  // ——— I: HTTP 200 + MutationError ———
  {
    const before = createPostCalls
    const conn = BufferConnector.withFakeGraphQL(
      makeFakeGql({ mutationError: true }),
    )
    await conn.refreshState()
    const svc = new BufferPublishService(
      conn,
      socialRepo,
      marketingRepo,
      artifacts,
      null,
      null,
    )
    const { campaign, content } = await makeApprovedThreads({
      publishMode: 'queue',
    })
    let threw = false
    try {
      await svc.publishToBuffer({
        projectId: PROJECT_A,
        contentId: content.id,
        campaignId: campaign.id,
        mode: 'queue',
      })
    } catch {
      threw = true
    }
    assert(threw, 'I must fail')
    // createPost was attempted once then failed — count may increment
    assert(createPostCalls >= before + 1, 'I attempted createPost')
    console.log('I PASS — MutationError treated as failure')
  }

  // ——— J: duplicate publish → createPost 1 total for same key ———
  {
    createPostCalls = 0
    const conn = BufferConnector.withFakeGraphQL(makeFakeGql())
    const svc = new BufferPublishService(
      conn,
      socialRepo,
      marketingRepo,
      artifacts,
      null,
      null,
    )
    const { campaign, content } = await makeApprovedThreads({
      publishMode: 'queue',
    })
    const r1 = await svc.publishToBuffer({
      projectId: PROJECT_A,
      contentId: content.id,
      campaignId: campaign.id,
      mode: 'queue',
    })
    const r2 = await svc.publishToBuffer({
      projectId: PROJECT_A,
      contentId: content.id,
      campaignId: campaign.id,
      mode: 'queue',
    })
    eq(createPostCalls, 1, 'J createPost once')
    eq(r2.duplicate, true, 'J duplicate')
    eq(r1.record.bufferPostId, r2.record.bufferPostId, 'J same post')
    console.log('J PASS — idempotent')
  }

  // ——— K: queued ≠ SNS published ———
  {
    const st = bufferStatusToPublishedStatus('scheduled', 'queue')
    eq(st, 'buffer_queued', 'K buffer_queued')
    assert(st !== 'published', 'K not published')
    console.log('K PASS — buffer_queued not SNS published')
  }

  // ——— L: project isolation ———
  {
    const conn = BufferConnector.withFakeGraphQL(makeFakeGql())
    const svc = new BufferPublishService(
      conn,
      socialRepo,
      marketingRepo,
      artifacts,
      null,
      null,
    )
    await svc.setDistributionPrefs(PROJECT_A, {
      provider: 'buffer',
      bufferChannels: { threadsChannelId: 'ch_threads_1' },
    })
    await svc.setDistributionPrefs(PROJECT_B, {
      provider: 'manual',
      bufferChannels: { threadsChannelId: 'ch_other' },
    })
    const a = await svc.getDistributionPrefs(PROJECT_A)
    const b = await svc.getDistributionPrefs(PROJECT_B)
    eq(a.bufferChannels.threadsChannelId, 'ch_threads_1', 'L A mapping')
    eq(b.bufferChannels.threadsChannelId, 'ch_other', 'L B mapping')
    assert(
      a.bufferChannels.threadsChannelId !== b.bufferChannels.threadsChannelId,
      'L isolated',
    )
    console.log('L PASS — project isolation')
  }

  // Auth error classification smoke
  {
    const err = createBufferError({
      category: 'BUFFER_AUTH',
      userMessage: 'auth',
      technicalSummary: 'Bearer bapi_secret_should_redact',
    })
    assert(!err.technicalSummary.includes('bapi_secret'), 'key redacted')
  }

  console.log('\nAll Buffer fixtures A–L PASS')
} catch (err) {
  console.error('FAIL', err)
  process.exitCode = 1
} finally {
  rmSync(dir, { recursive: true, force: true })
}

function createBufferConnectorNoKey(): BufferConnector {
  const env = { ...process.env }
  delete env.BUFFER_API_KEY
  return new BufferConnector(undefined, env)
}
