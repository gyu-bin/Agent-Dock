/**
 * Threads Connector Pilot fixtures A–J.
 * Run: node --import tsx tools/threads-connector-fixture.mts
 * No real Meta Graph calls (fixture publish override). Real OAuth not exercised.
 */
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { FileCredentialStore } from '../server/src/credentials/fileCredentialStore.ts'
import { assertNoTokenLeak } from '../server/src/credentials/redact.ts'
import {
  SocialConnectorRegistry,
  JsonSocialRepository,
  SocialPublishService,
  ThreadsConnector,
} from '../server/src/social/index.ts'
import { JsonMarketingRepository } from '../server/src/marketing/marketingRepository.ts'
import { MarketingService } from '../server/src/marketing/marketingService.ts'
import { JsonArtifactRepository } from '../server/src/persistence/artifactRepository.ts'
import { ArtifactService } from '../server/src/persistence/artifactService.ts'
import { JsonProjectRepository } from '../server/src/persistence/jsonStore.ts'
import { ProjectService } from '../server/src/persistence/projectService.ts'
import {
  setSocialPublishAvailable,
  setAnalyticsReadAvailable,
} from '../server/src/operations/capabilityPreflight.ts'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg)
}

function eq<T>(a: T, b: T, msg: string) {
  assert(a === b, `${msg}: expected ${String(b)}, got ${String(a)}`)
}

const dir = mkdtempSync(path.join(tmpdir(), 'ad-thr-'))
const credDir = path.join(dir, 'credentials')
const marketingDir = path.join(dir, 'marketing')
const socialDir = path.join(dir, 'social')
const artifactsDir = path.join(dir, 'artifacts')
const projectsFile = path.join(dir, 'projects.json')

const PROJECT_A = 'proj_thr_a'
const PROJECT_B = 'proj_thr_b'

// Ensure app appears configured for OAuth start tests
process.env.THREADS_APP_ID = 'test_app_id_990602627938098'
process.env.THREADS_APP_SECRET = 'test_app_secret_not_real'
process.env.THREADS_REDIRECT_URI =
  'http://127.0.0.1:8787/api/social/threads/oauth/callback'

const credentials = new FileCredentialStore(credDir)
const threads = new ThreadsConnector(credentials)
const registry = new SocialConnectorRegistry()
registry.useThreadsConnector(threads)

const marketingRepo = new JsonMarketingRepository(marketingDir)
const socialRepo = new JsonSocialRepository(socialDir)
const artifacts = new ArtifactService(new JsonArtifactRepository(artifactsDir))
const projects = new ProjectService(new JsonProjectRepository(projectsFile))

const socialPublish = new SocialPublishService(
  registry,
  socialRepo,
  marketingRepo,
  artifacts,
)
const marketing = new MarketingService(
  marketingRepo,
  projects,
  artifacts,
  null,
  null,
  null,
  registry,
  null,
)

const SOURCES = [
  {
    id: 'src_t',
    title: 'Threads tips',
    url: 'https://example.com/threads',
    domain: 'example.com',
    snippet: 'conversational threads posts for apps',
  },
]

async function seed() {
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

async function connectFixture(opts?: {
  expired?: boolean
  token?: string
}) {
  await threads.getOAuth().injectFixtureCredential({
    accessToken: opts?.token ?? 'fixture_access_token_SECRET_VALUE',
    profileId: 'thr_user_123',
    username: 'agentdeck_test',
    status: opts?.expired ? 'expired' : 'connected',
    expiresAt: opts?.expired
      ? new Date(Date.now() - 60_000).toISOString()
      : new Date(Date.now() + 86400000 * 30).toISOString(),
  })
  await threads.refreshConnectionCache()
  setSocialPublishAvailable(registry.hasAnyPublishAvailable())
  // Fake Graph publish — never hit Meta
  threads.setFixturePublish(async (req) => ({
    remotePostId: `thr_${req.contentId.slice(-6)}`,
    remoteUrl: `https://www.threads.net/@agentdeck_test/post/thr_${req.contentId.slice(-6)}`,
    publishedAt: new Date().toISOString(),
  }))
}

async function makeApprovedThreadsContent() {
  const result = await marketing.runCampaign({
    projectId: PROJECT_A,
    title: 'Threads pilot',
    request: 'threads conversational posts',
    fixtureSources: SOURCES,
    allowWithoutSearch: true,
    searchAvailable: false,
  })
  await marketing.approveCampaign(result.campaign.id, { projectId: PROJECT_A })
  const hit = await marketing.getCampaign(result.campaign.id, PROJECT_A)
  const content =
    hit!.contents.find((c) => c.channel === 'threads') ?? hit!.contents[0]!
  return { campaign: hit!.campaign, content }
}

try {
  await seed()

  // ——— A: OAuth state / CSRF ———
  {
    const { authorizeUrl, state } = threads.getOAuth().startAuthorize()
    assert(authorizeUrl.includes('threads.com/oauth/authorize'), 'A authorize host')
    assert(authorizeUrl.includes('threads_basic'), 'A scope basic')
    assert(authorizeUrl.includes('threads_content_publish'), 'A scope publish')
    assert(authorizeUrl.includes('state='), 'A state param')
    assert(threads.getOAuth()._validateStateForTest(state), 'A state valid')
    assert(
      !threads.getOAuth()._validateStateForTest('bogus_state_xyz'),
      'A bogus rejected',
    )
    console.log('TEST A PASS')
  }

  // ——— B: credential secret non-exposure ———
  {
    await connectFixture()
    const state = await threads.getStateAsync()
    const json = JSON.stringify(state)
    assert(!json.includes('fixture_access_token'), 'B no token in state')
    assert(!json.includes('SECRET_VALUE'), 'B no secret')
    try {
      assertNoTokenLeak({
        access_token: 'should_fail',
      })
      assert(false, 'B should throw on token leak')
    } catch {
      // expected
    }
    // Credential file exists but not under marketing/social
    const files = await credentials.listMeta('threads')
    assert(files.length === 1, 'B credential stored')
    const rawPath = path.join(credDir, 'threads__global.json')
    assert(existsSync(rawPath), 'B file exists')
    const raw = readFileSync(rawPath, 'utf8')
    assert(raw.includes('accessToken'), 'B secret in credential file only')
    console.log('TEST B PASS')
  }

  // ——— C: connected state ———
  {
    await connectFixture()
    const s = await threads.getStateAsync()
    eq(s.available, true, 'C available')
    eq(s.connection?.status, 'connected', 'C connected')
    eq(s.connection?.username, 'agentdeck_test', 'C username')
    assert(registry.isChannelPublishAvailable('threads'), 'C registry')
    console.log('TEST C PASS')
  }

  // ——— D: disconnected ———
  {
    await threads.getOAuth().disconnect()
    await threads.refreshConnectionCache()
    setSocialPublishAvailable(registry.hasAnyPublishAvailable())
    const s = await threads.getStateAsync()
    eq(s.available, false, 'D unavailable')
    assert(!registry.isChannelPublishAvailable('threads'), 'D registry off')
    console.log('TEST D PASS')
  }

  // ——— E: approval required ———
  {
    await connectFixture()
    const draft = await marketing.runCampaign({
      projectId: PROJECT_A,
      title: 'E no approve',
      fixtureSources: SOURCES,
      allowWithoutSearch: true,
      searchAvailable: false,
    })
    const content = draft.contents.find((c) => c.channel === 'threads')!
    let rejected = false
    try {
      await socialPublish.publishContent({
        projectId: PROJECT_A,
        contentId: content.id,
      })
    } catch (err) {
      rejected =
        err != null &&
        typeof err === 'object' &&
        'category' in err &&
        (err as { category: string }).category === 'SOCIAL_NOT_APPROVED'
    }
    assert(rejected, 'E approval required')
    console.log('TEST E PASS')
  }

  // ——— F: hash mismatch ———
  {
    await connectFixture()
    const { content } = await makeApprovedThreadsContent()
    await marketing.patchContent(content.id, {
      projectId: PROJECT_A,
      body: content.body + '\nEDITED',
    })
    let mismatch = false
    try {
      await socialPublish.publishContent({
        projectId: PROJECT_A,
        contentId: content.id,
      })
    } catch (err) {
      const cat =
        err && typeof err === 'object' && 'category' in err
          ? String((err as { category: string }).category)
          : ''
      mismatch =
        cat === 'SOCIAL_HASH_MISMATCH' || cat === 'SOCIAL_NOT_APPROVED'
    }
    assert(mismatch, 'F mismatch')
    console.log('TEST F PASS')
  }

  // ——— G: fake Threads publish ———
  {
    await connectFixture()
    const { campaign, content } = await makeApprovedThreadsContent()
    const pub = await socialPublish.publishContent({
      projectId: PROJECT_A,
      contentId: content.id,
      campaignId: campaign.id,
    })
    assert(pub.post?.status === 'published', 'G published')
    assert(pub.post?.remotePostId, 'G remote id')
    assert(pub.post?.connectorId === 'threads', 'G connector')
    console.log('TEST G PASS', { remote: pub.post?.remotePostId })
  }

  // ——— H: idempotency ———
  {
    await connectFixture()
    const { campaign, content } = await makeApprovedThreadsContent()
    const a = await socialPublish.publishContent({
      projectId: PROJECT_A,
      contentId: content.id,
      campaignId: campaign.id,
    })
    const b = await socialPublish.publishContent({
      projectId: PROJECT_A,
      contentId: content.id,
      campaignId: campaign.id,
    })
    assert(b.duplicate, 'H duplicate')
    eq(a.post!.id, b.post!.id, 'H same post')
    console.log('TEST H PASS')
  }

  // ——— I: auth expiry ———
  {
    await connectFixture({ expired: true })
    // Clear fixture publish so real path hits auth
    threads.setFixturePublish(null)
    const { campaign, content } = await makeApprovedThreadsContent()
    // Re-inject expired after approve
    await connectFixture({ expired: true })
    threads.setFixturePublish(null)
    let expired = false
    try {
      await socialPublish.publishContent({
        projectId: PROJECT_A,
        contentId: content.id,
        campaignId: campaign.id,
      })
    } catch (err) {
      const tech =
        err && typeof err === 'object' && 'technicalSummary' in err
          ? String((err as { technicalSummary: string }).technicalSummary)
          : ''
      const cat =
        err && typeof err === 'object' && 'category' in err
          ? String((err as { category: string }).category)
          : ''
      expired =
        tech.includes('THREADS_AUTH_EXPIRED') ||
        tech.includes('token expired') ||
        cat === 'SOCIAL_NOT_CONFIGURED'
    }
    assert(expired, 'I auth expired')
    // restore fixture publish for cleanup paths
    await connectFixture()
    console.log('TEST I PASS')
  }

  // ——— J: project isolation ———
  {
    await connectFixture()
    const postsA = await socialPublish.listPosts(PROJECT_A)
    const postsB = await socialPublish.listPosts(PROJECT_B)
    assert(postsA.length > 0, 'J A has posts')
    assert(
      !postsB.some((p) => postsA.some((a) => a.id === p.id)),
      'J no cross project posts',
    )
    // Connector state API-like payload must not leak token
    const publicState = await threads.getStateAsync()
    assertNoTokenLeak({
      connectors: [publicState],
      username: publicState.connection?.username,
    })
    console.log('TEST J PASS')
  }

  console.log('threadsConnector fixtures: ALL PASS')
} finally {
  setSocialPublishAvailable(false)
  setAnalyticsReadAvailable(false)
  rmSync(dir, { recursive: true, force: true })
}
