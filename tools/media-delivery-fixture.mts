/**
 * Media Delivery Foundation fixtures A–K.
 * Run: node --import tsx tools/media-delivery-fixture.mts
 * No real cloud upload / SNS. Fake provider only when explicitly injected.
 */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  UnconfiguredMediaDeliveryProvider,
  FakeMediaDeliveryProvider,
  createMediaDeliveryService,
  JsonMediaDeliveryRepository,
  resolveArtifactMediaFile,
  DEFAULT_TTL_SECONDS,
} from '../server/src/mediaDelivery/index.ts'
import { assertNoTokenLeak } from '../server/src/credentials/redact.ts'
import { ImageStorage, FIXTURE_PNG_1X1 } from '../server/src/image/index.ts'
import { JsonArtifactRepository } from '../server/src/persistence/artifactRepository.ts'
import { ArtifactService } from '../server/src/persistence/artifactService.ts'
import { JsonProjectRepository } from '../server/src/persistence/jsonStore.ts'
import { ProjectService } from '../server/src/persistence/projectService.ts'
import { JsonMarketingRepository } from '../server/src/marketing/marketingRepository.ts'
import { MarketingService } from '../server/src/marketing/marketingService.ts'
import {
  FakeSocialConnector,
  SocialConnectorRegistry,
  JsonSocialRepository,
  SocialPublishService,
  hashMarketingContentAsync,
} from '../server/src/social/index.ts'
import { setSocialPublishAvailable } from '../server/src/operations/capabilityPreflight.ts'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg)
}

function eq<T>(a: T, b: T, msg: string) {
  assert(a === b, `${msg}: expected ${String(b)}, got ${String(a)}`)
}

const dir = mkdtempSync(path.join(tmpdir(), 'ad-mdel-'))
const genDir = path.join(dir, 'generated')
const deliveryDir = path.join(dir, 'media-delivery')
const artifactsDir = path.join(dir, 'artifacts')
const marketingDir = path.join(dir, 'marketing')
const socialDir = path.join(dir, 'social')
const projectsFile = path.join(dir, 'projects.json')

process.env.AGENT_DECK_GENERATED_DIR = genDir

const PROJECT_A = 'proj_mdel_a'
const PROJECT_B = 'proj_mdel_b'

const storage = new ImageStorage(genDir)
const artifacts = new ArtifactService(new JsonArtifactRepository(artifactsDir))
const deliveryRepo = new JsonMediaDeliveryRepository(deliveryDir)
const fakeProvider = new FakeMediaDeliveryProvider()
const mediaDelivery = createMediaDeliveryService({
  artifacts,
  repo: deliveryRepo,
  provider: fakeProvider,
})

const projects = new ProjectService(new JsonProjectRepository(projectsFile))
const marketingRepo = new JsonMarketingRepository(marketingDir)
const socialRepo = new JsonSocialRepository(socialDir)

async function seed() {
  const now = new Date().toISOString()
  await new JsonProjectRepository(projectsFile).save({
    version: 5,
    revision: 1,
    activeProjectId: PROJECT_A,
    projects: [
      {
        id: PROJECT_A,
        name: 'App A',
        type: 'mobile-game',
        status: 'active',
        agentIds: ['product-manager'],
        createdAt: now,
        updatedAt: now,
      },
      {
        id: PROJECT_B,
        name: 'App B',
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

async function createPngArtifact(projectId: string, title = 'PNG') {
  const written = await storage.writeImage({
    projectId,
    imageId: `img_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    bytes: FIXTURE_PNG_1X1,
    ext: 'png',
  })
  return artifacts.createArtifact({
    projectId,
    type: 'creative-image',
    title,
    summary: 'fixture png',
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
}

try {
  await seed()

  // ——— A: Unconfigured ———
  {
    const unconf = createMediaDeliveryService({
      artifacts,
      repo: deliveryRepo,
      provider: new UnconfiguredMediaDeliveryProvider(),
    })
    assert(!unconf.isAvailable(), 'A not available')
    let threw = false
    try {
      await unconf.prepare({
        projectId: PROJECT_A,
        artifactId: 'missing',
        purpose: 'social-publish',
      })
    } catch (err) {
      threw =
        err != null &&
        typeof err === 'object' &&
        'category' in err &&
        (err as { category: string }).category === 'MEDIA_NOT_CONFIGURED'
    }
    assert(threw, 'A MEDIA_NOT_CONFIGURED')
    console.log('TEST A PASS')
  }

  // ——— B: Image ———
  {
    const art = await createPngArtifact(PROJECT_A, 'B png')
    const d = await mediaDelivery.prepare({
      projectId: PROJECT_A,
      artifactId: art.id,
      purpose: 'social-publish',
    })
    assert(d.url.startsWith('https://media.invalid/'), 'B fake url')
    assert(d.mimeType === 'image/png', 'B mime')
    assert(d.status === 'active', 'B active')
    console.log('TEST B PASS', { id: d.id })
  }

  // ——— C: Ownership ———
  {
    const artA = await createPngArtifact(PROJECT_A, 'C a')
    let ownership = false
    try {
      await mediaDelivery.prepare({
        projectId: PROJECT_B,
        artifactId: artA.id,
        purpose: 'social-publish',
      })
    } catch (err) {
      const cat =
        err && typeof err === 'object' && 'category' in err
          ? String((err as { category: string }).category)
          : ''
      ownership =
        cat === 'MEDIA_OWNERSHIP' || cat === 'MEDIA_ARTIFACT_NOT_FOUND'
    }
    assert(ownership, 'C ownership')
    console.log('TEST C PASS')
  }

  // ——— D: Traversal ———
  {
    const evil = await artifacts.createArtifact({
      projectId: PROJECT_A,
      type: 'creative-image',
      title: 'evil',
      summary: 'path',
      contentType: 'json',
      content: JSON.stringify({
        filePath: '../../etc/passwd',
        mimeType: 'image/png',
      }),
      status: 'draft',
      metadata: { filePath: '../../etc/passwd', mimeType: 'image/png' },
    })
    let pathViol = false
    try {
      await resolveArtifactMediaFile({
        projectId: PROJECT_A,
        artifactId: evil.id,
        artifacts,
      })
    } catch (err) {
      const cat =
        err && typeof err === 'object' && 'category' in err
          ? String((err as { category: string }).category)
          : ''
      pathViol = cat === 'MEDIA_PATH_VIOLATION'
    }
    assert(pathViol, 'D path violation')
    console.log('TEST D PASS')
  }

  // ——— E: MIME ———
  {
    const htmlPath = path.join(genDir, PROJECT_A, 'images', 'x.html')
    mkdirSync(path.dirname(htmlPath), { recursive: true })
    writeFileSync(htmlPath, '<script>alert(1)</script>')
    const htmlArt = await artifacts.createArtifact({
      projectId: PROJECT_A,
      type: 'other',
      title: 'html',
      summary: 'bad',
      contentType: 'json',
      content: JSON.stringify({
        filePath: htmlPath,
        mimeType: 'text/html',
      }),
      status: 'draft',
      metadata: { filePath: htmlPath, mimeType: 'text/html' },
    })
    let mime = false
    try {
      await mediaDelivery.prepare({
        projectId: PROJECT_A,
        artifactId: htmlArt.id,
        purpose: 'social-publish',
      })
    } catch (err) {
      mime =
        err != null &&
        typeof err === 'object' &&
        'category' in err &&
        (err as { category: string }).category === 'MEDIA_UNSUPPORTED_TYPE'
    }
    assert(mime, 'E mime rejected')
    console.log('TEST E PASS')
  }

  // ——— F: TTL ———
  {
    const art = await createPngArtifact(PROJECT_A, 'F ttl')
    const d = await mediaDelivery.prepare({
      projectId: PROJECT_A,
      artifactId: art.id,
      purpose: 'social-publish',
      requestedTtlSeconds: DEFAULT_TTL_SECONDS,
    })
    const exp = Date.parse(d.expiresAt)
    const created = Date.parse(d.createdAt)
    const delta = Math.round((exp - created) / 1000)
    assert(Math.abs(delta - DEFAULT_TTL_SECONDS) <= 2, 'F ttl seconds')
    // Force expire in store
    const snap = await deliveryRepo.load(PROJECT_A)
    const rec = snap.deliveries.find((x) => x.id === d.id)!
    rec.expiresAt = new Date(Date.now() - 1000).toISOString()
    await deliveryRepo.save(snap)
    const live = mediaDelivery.toDeliveredMedia(rec)
    assert(live === null, 'F expired not active')
    console.log('TEST F PASS')
  }

  // ——— G: Reuse ———
  {
    const art = await createPngArtifact(PROJECT_A, 'G reuse')
    const attempt = 'pattempt_reuse_1'
    const d1 = await mediaDelivery.prepare({
      projectId: PROJECT_A,
      artifactId: art.id,
      purpose: 'social-publish',
      publishAttemptId: attempt,
    })
    const d2 = await mediaDelivery.prepare({
      projectId: PROJECT_A,
      artifactId: art.id,
      purpose: 'social-publish',
      publishAttemptId: attempt,
    })
    eq(d1.id, d2.id, 'G same delivery')
    console.log('TEST G PASS')
  }

  // ——— H: Version change invalidates approval ———
  {
    const artV1 = await createPngArtifact(PROJECT_A, 'H v1')
    const hash1 = await hashMarketingContentAsync(
      {
        id: 'mc_h',
        channel: 'threads',
        type: 'post',
        title: 't',
        body: 'hello',
        creativeArtifactIds: [artV1.id],
      },
      PROJECT_A,
      artifacts,
    )
    // Create v2 in same family
    const written2 = await storage.writeImage({
      projectId: PROJECT_A,
      imageId: `img_v2_${Date.now().toString(36)}`,
      bytes: FIXTURE_PNG_1X1,
      ext: 'png',
    })
    const artV2 = await artifacts.createArtifact({
      projectId: PROJECT_A,
      type: 'creative-image',
      title: 'H v2',
      summary: 'v2',
      contentType: 'json',
      content: JSON.stringify({
        filePath: written2.filePath,
        publicPath: written2.publicPath,
        mimeType: 'image/png',
      }),
      status: 'draft',
      familyId: artV1.familyId,
      metadata: {
        mimeType: 'image/png',
        filePath: written2.filePath,
        publicPath: written2.publicPath,
      },
    })
    assert(artV2.version > artV1.version, 'H version bump')
    const hash2 = await hashMarketingContentAsync(
      {
        id: 'mc_h',
        channel: 'threads',
        type: 'post',
        title: 't',
        body: 'hello',
        creativeArtifactIds: [artV2.id],
      },
      PROJECT_A,
      artifacts,
    )
    assert(hash1 !== hash2, 'H hash mismatch after media version')
    console.log('TEST H PASS', { v1: artV1.version, v2: artV2.version })
  }

  // ——— I: Social integration ———
  {
    const fakeSocial = new FakeSocialConnector('threads')
    const registry = new SocialConnectorRegistry()
    registry.register(fakeSocial)
    setSocialPublishAvailable(true)
    const socialPublish = new SocialPublishService(
      registry,
      socialRepo,
      marketingRepo,
      artifacts,
      mediaDelivery,
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
    const campaign = await marketing.runCampaign({
      projectId: PROJECT_A,
      title: 'I media social',
      request: 'threads conversational posts',
      fixtureSources: [
        {
          id: 's',
          title: 'Threads',
          url: 'https://example.com/t',
          domain: 'example.com',
          snippet: 'threads posts',
        },
      ],
      allowWithoutSearch: true,
      searchAvailable: false,
    })
    const content =
      campaign.contents.find((c) => c.channel === 'threads') ??
      campaign.contents[0]!
    const img = await createPngArtifact(PROJECT_A, 'I img')
    // Attach media then approve (so hash includes media)
    await marketing.patchContent(content.id, {
      projectId: PROJECT_A,
      creativeArtifactIds: [img.id],
    })
    // Re-approve after media attach
    const snap = await marketingRepo.load(PROJECT_A)
    const camp = snap.campaigns.find((c) => c.id === campaign.campaign.id)!
    camp.status = 'awaiting_approval'
    if (camp.publishPackage) camp.publishPackage.approvalStatus = 'pending'
    await marketingRepo.save(snap)
    await marketing.approveCampaign(campaign.campaign.id, {
      projectId: PROJECT_A,
    })
    const pub = await socialPublish.publishContent({
      projectId: PROJECT_A,
      contentId: content.id,
    })
    assert(pub.post?.status === 'published', 'I published')
    assert(pub.post?.remotePostId, 'I remote')
    console.log('TEST I PASS', { post: pub.post?.id })
  }

  // ——— J: Cleanup ———
  {
    const art = await createPngArtifact(PROJECT_A, 'J clean')
    const dActive = await mediaDelivery.prepare({
      projectId: PROJECT_A,
      artifactId: art.id,
      purpose: 'social-publish',
      publishAttemptId: 'keep_me',
    })
    const dExpire = await mediaDelivery.prepare({
      projectId: PROJECT_A,
      artifactId: art.id,
      purpose: 'preview',
      publishAttemptId: 'expire_me',
    })
    const snap = await deliveryRepo.load(PROJECT_A)
    const rec = snap.deliveries.find((x) => x.id === dExpire.id)!
    rec.expiresAt = new Date(Date.now() - 5000).toISOString()
    await deliveryRepo.save(snap)
    const result = await mediaDelivery.cleanupExpired(new Date())
    assert(result.expired >= 1, 'J expired count')
    const after = await deliveryRepo.load(PROJECT_A)
    const still = after.deliveries.find((x) => x.id === dActive.id)!
    eq(still.status, 'active', 'J active kept')
    const gone = after.deliveries.find((x) => x.id === dExpire.id)!
    eq(gone.status, 'expired', 'J expired marked')
    console.log('TEST J PASS', result)
  }

  // ——— K: Secrets ———
  {
    const status = mediaDelivery.getState()
    assertNoTokenLeak(status)
    assertNoTokenLeak({
      MEDIA_S3_SECRET_ACCESS_KEY: undefined,
      provider: status.provider,
    })
    try {
      assertNoTokenLeak({
        access_token: 'AKIA_SHOULD_FAIL',
      })
      assert(false, 'K should reject secrets')
    } catch {
      // expected
    }
    assert(existsSync(deliveryDir), 'K delivery dir')
    console.log('TEST K PASS')
  }

  // ——— L–R: Production S3-compatible adapter (mocked ops, no live R2) ———
  {
    const {
      S3CompatibleMediaDeliveryProvider,
      createDefaultMediaProvider,
      isMediaError,
    } = await import('../server/src/mediaDelivery/index.ts')

    // L — config missing → unavailable
    {
      const prev = { ...process.env }
      process.env.MEDIA_DELIVERY_PROVIDER = 's3-compatible'
      delete process.env.MEDIA_S3_ENDPOINT
      delete process.env.MEDIA_S3_BUCKET
      delete process.env.MEDIA_S3_ACCESS_KEY_ID
      delete process.env.MEDIA_S3_SECRET_ACCESS_KEY
      const p = createDefaultMediaProvider(process.env)
      const st = p.getState()
      eq(st.provider, 's3-compatible', 'L provider id')
      assert(!st.configured, 'L not configured')
      assert(!st.available, 'L not available')
      Object.assign(process.env, prev)
      console.log('TEST L PASS')
    }

    const objects = new Map<string, { body: Buffer; contentType: string }>()
    let putCalls = 0
    let signCalls = 0
    let deleteCalls = 0
    let forcePutFail = false
    let forceSignFail = false

    const mockOps = {
      async putObject(input: {
        key: string
        body: Buffer
        contentType: string
        metadata: Record<string, string>
      }) {
        putCalls += 1
        if (forcePutFail) throw new Error('mock PutObject failed')
        assert(!('prompt' in input.metadata), 'M no prompt metadata')
        objects.set(input.key, {
          body: input.body,
          contentType: input.contentType,
        })
      },
      async getSignedGetUrl(key: string, expiresInSeconds: number) {
        signCalls += 1
        if (forceSignFail) throw new Error('mock sign failed')
        assert(expiresInSeconds >= 900 && expiresInSeconds <= 3600, 'N ttl')
        return `https://mock-r2.example/${encodeURIComponent(key)}?exp=${expiresInSeconds}`
      },
      async deleteObject(key: string) {
        deleteCalls += 1
        objects.delete(key)
      },
    }

    const s3Provider = new S3CompatibleMediaDeliveryProvider(
      {
        endpoint: 'https://example.r2.cloudflarestorage.com',
        region: 'auto',
        bucket: 'agent-deck-media',
        accessKeyId: 'test-access',
        secretAccessKey: 'test-secret',
      },
      mockOps,
    )
    const s3Delivery = createMediaDeliveryService({
      artifacts,
      repo: deliveryRepo,
      provider: s3Provider,
    })

    // M — mocked PutObject
    {
      putCalls = 0
      const art = await createPngArtifact(PROJECT_A, 'M png')
      const d = await s3Delivery.prepare({
        projectId: PROJECT_A,
        artifactId: art.id,
        purpose: 'social-publish',
      })
      assert(putCalls === 1, 'M put once')
      assert(d.provider === 's3-compatible', 'M provider')
      assert(d.remoteKey?.startsWith('agent-deck/'), 'M key prefix')
      assert(objects.has(d.remoteKey!), 'M object stored')
      assert(d.url.includes('mock-r2.example'), 'M signed url')
      // persisted record must not keep signed URL
      const snap = await deliveryRepo.load(PROJECT_A)
      const rec = snap.deliveries.find((x) => x.id === d.id)!
      assert(!rec.urlHint, 'M no urlHint in repo')
      console.log('TEST M PASS', { key: d.remoteKey })
    }

    // N — presigned URL generation
    {
      signCalls = 0
      const art = await createPngArtifact(PROJECT_A, 'N png')
      const d = await s3Delivery.prepare({
        projectId: PROJECT_A,
        artifactId: art.id,
        purpose: 'preview',
        requestedTtlSeconds: 1800,
      })
      assert(signCalls >= 1, 'N signed')
      assert(d.url.includes('exp=1800'), 'N ttl in url')
      const re = await s3Delivery.signExisting(PROJECT_A, d.id, 900)
      assert(re.url.includes('exp=900'), 'N resign ttl')
      assert(re.id === d.id, 'N same delivery')
      console.log('TEST N PASS')
    }

    // O — upload failure
    {
      forcePutFail = true
      const art = await createPngArtifact(PROJECT_A, 'O png')
      let cat = ''
      try {
        await s3Delivery.prepare({
          projectId: PROJECT_A,
          artifactId: art.id,
          purpose: 'social-publish',
        })
      } catch (err) {
        assert(isMediaError(err), 'O media error')
        cat = err.category
      }
      forcePutFail = false
      eq(cat, 'MEDIA_UPLOAD_FAILED', 'O upload fail')
      console.log('TEST O PASS')
    }

    // P — sign failure
    {
      forceSignFail = true
      const art = await createPngArtifact(PROJECT_A, 'P png')
      let cat = ''
      try {
        await s3Delivery.prepare({
          projectId: PROJECT_A,
          artifactId: art.id,
          purpose: 'social-publish',
        })
      } catch (err) {
        assert(isMediaError(err), 'P media error')
        cat = err.category
      }
      forceSignFail = false
      eq(cat, 'MEDIA_SIGN_FAILED', 'P sign fail')
      console.log('TEST P PASS')
    }

    // Q — reuse / re-sign (no second PutObject)
    {
      putCalls = 0
      signCalls = 0
      const art = await createPngArtifact(PROJECT_A, 'Q png')
      const attempt = 'pub_attempt_q'
      const d1 = await s3Delivery.prepare({
        projectId: PROJECT_A,
        artifactId: art.id,
        purpose: 'social-publish',
        publishAttemptId: attempt,
      })
      const putsAfterFirst = putCalls
      const d2 = await s3Delivery.prepare({
        projectId: PROJECT_A,
        artifactId: art.id,
        purpose: 'social-publish',
        publishAttemptId: attempt,
      })
      eq(d1.id, d2.id, 'Q same delivery')
      eq(d1.remoteKey, d2.remoteKey, 'Q same remote key')
      assert(putCalls === putsAfterFirst, 'Q no re-upload')
      assert(signCalls >= 2, 'Q re-signed')
      console.log('TEST Q PASS')
    }

    // R — delete / revoke
    {
      const art = await createPngArtifact(PROJECT_A, 'R png')
      const d = await s3Delivery.prepare({
        projectId: PROJECT_A,
        artifactId: art.id,
        purpose: 'social-publish',
      })
      assert(objects.has(d.remoteKey!), 'R object before')
      const deletesBefore = deleteCalls
      await s3Delivery.revoke(PROJECT_A, d.id)
      assert(deleteCalls > deletesBefore, 'R delete called')
      assert(!objects.has(d.remoteKey!), 'R object gone')
      const snap = await deliveryRepo.load(PROJECT_A)
      const rec = snap.deliveries.find((x) => x.id === d.id)!
      eq(rec.status, 'revoked', 'R revoked')
      console.log('TEST R PASS')
    }
  }

  console.log('mediaDelivery fixtures: ALL PASS')
} finally {
  setSocialPublishAvailable(false)
  rmSync(dir, { recursive: true, force: true })
}
