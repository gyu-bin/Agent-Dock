/**
 * Live Cloudflare R2 / S3-compatible Media Delivery smoke.
 *
 * Default: SKIP (no network).
 * Opt-in: AGENT_DECK_LIVE_MEDIA_TEST=1 + full MEDIA_S3_* + MEDIA_DELIVERY_PROVIDER=s3-compatible
 *
 * Run: AGENT_DECK_LIVE_MEDIA_TEST=1 node --import tsx tools/media-delivery-r2-smoke.mts
 *
 * Exactly one small fixture PNG. No OpenAI. No Threads/Instagram.
 */
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { loadDotEnv } from '../server/src/loadEnv.ts'
import {
  createMediaDeliveryService,
  createDefaultMediaProvider,
  JsonMediaDeliveryRepository,
  getS3CompatibleConfig,
  isMediaError,
} from '../server/src/mediaDelivery/index.ts'
import { ImageStorage, FIXTURE_PNG_1X1 } from '../server/src/image/index.ts'
import { JsonArtifactRepository } from '../server/src/persistence/artifactRepository.ts'
import { ArtifactService } from '../server/src/persistence/artifactService.ts'
import { JsonProjectRepository } from '../server/src/persistence/jsonStore.ts'

loadDotEnv()

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg)
}

function redact(s: string): string {
  return s
    .replace(/sk-[a-zA-Z0-9_-]+/g, '[redacted]')
    .replace(/AKIA[A-Z0-9]+/g, '[redacted]')
    .replace(/X-Amz-Credential=[^&]+/gi, 'X-Amz-Credential=[redacted]')
}

const live = process.env.AGENT_DECK_LIVE_MEDIA_TEST === '1'
const cfg = getS3CompatibleConfig()

console.log('=== Media Delivery R2 Smoke · Preflight ===')
console.log(
  JSON.stringify({
    liveFlag: live,
    providerEnv: process.env.MEDIA_DELIVERY_PROVIDER ?? 'unconfigured',
    s3Configured: cfg.configured,
    endpointSet: Boolean(cfg.endpoint),
    bucketSet: Boolean(cfg.bucket),
    hasAccessKey: cfg.hasAccessKey,
    hasSecretKey: cfg.hasSecretKey,
    region: cfg.region ?? null,
  }),
)

if (!live) {
  console.log('SKIP · set AGENT_DECK_LIVE_MEDIA_TEST=1 to run live R2 smoke')
  process.exit(0)
}

if (!cfg.configured) {
  console.error(
    'FAIL · MEDIA_S3_ENDPOINT/BUCKET/ACCESS_KEY_ID/SECRET_ACCESS_KEY required',
  )
  process.exit(1)
}

process.env.MEDIA_DELIVERY_PROVIDER = 's3-compatible'

const dir = mkdtempSync(path.join(tmpdir(), 'ad-r2-smoke-'))
const genDir = path.join(dir, 'generated')
const deliveryDir = path.join(dir, 'media-delivery')
const artifactsDir = path.join(dir, 'artifacts')
const projectsFile = path.join(dir, 'projects.json')
process.env.AGENT_DECK_GENERATED_DIR = genDir

const PROJECT = 'proj_r2_smoke'
const storage = new ImageStorage(genDir)
const artifacts = new ArtifactService(new JsonArtifactRepository(artifactsDir))
const repo = new JsonMediaDeliveryRepository(deliveryDir)
const provider = createDefaultMediaProvider()
const media = createMediaDeliveryService({
  artifacts,
  repo,
  provider,
})

let exitCode = 0
let remoteKey: string | undefined
let deliveryId: string | undefined

try {
  const now = new Date().toISOString()
  await new JsonProjectRepository(projectsFile).save({
    version: 5,
    revision: 1,
    activeProjectId: PROJECT,
    projects: [
      {
        id: PROJECT,
        name: 'R2 Smoke',
        type: 'web-app',
        status: 'active',
        agentIds: [],
        createdAt: now,
        updatedAt: now,
      },
    ],
    tasks: [],
    pipelineSteps: [],
    agentRuns: [],
    codexRuns: [],
  })

  assert(media.isAvailable(), 'provider available')
  const state = media.getState()
  assert(state.provider === 's3-compatible', 'provider id')
  assert(!JSON.stringify(state).includes('SECRET'), 'no secret in state')

  const written = await storage.writeImage({
    projectId: PROJECT,
    imageId: `img_smoke_${Date.now().toString(36)}`,
    bytes: FIXTURE_PNG_1X1,
    ext: 'png',
  })
  const art = await artifacts.createArtifact({
    projectId: PROJECT,
    type: 'creative-image',
    title: 'R2 smoke png',
    summary: 'fixture',
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

  const originalHash = createHash('sha256').update(FIXTURE_PNG_1X1).digest('hex')
  console.log('=== prepare (1 PNG) ===')
  const delivered = await media.prepare({
    projectId: PROJECT,
    artifactId: art.id,
    purpose: 'external-fetch',
    requestedTtlSeconds: 900,
  })
  deliveryId = delivered.id
  remoteKey = delivered.remoteKey
  assert(delivered.url.startsWith('https://'), 'signed https url')
  assert(delivered.mimeType === 'image/png', 'mime')

  console.log('=== GET signed URL ===')
  const res = await fetch(delivered.url)
  const body = Buffer.from(await res.arrayBuffer())
  const gotHash = createHash('sha256').update(body).digest('hex')
  const contentType = res.headers.get('content-type') ?? ''

  assert(res.status === 200, `GET status ${res.status}`)
  assert(/image\/png/i.test(contentType) || body[0] === 0x89, 'png mime/bytes')
  assert(body.length > 0, 'bytes > 0')
  eq(gotHash, originalHash, 'hash match')

  console.log('=== revoke / delete ===')
  await media.revoke(PROJECT, delivered.id)

  const after = await fetch(delivered.url)
  assert(
    after.status === 403 ||
      after.status === 404 ||
      after.status >= 400,
    `post-revoke GET should fail, got ${after.status}`,
  )

  console.log(
    JSON.stringify(
      {
        result: 'PASS',
        provider: delivered.provider,
        deliveryId: delivered.id,
        remoteKey: delivered.remoteKey,
        getStatus: res.status,
        contentType,
        bytes: body.length,
        hashMatch: true,
        postRevokeStatus: after.status,
        // never log full signed URL query (may contain signature)
        urlHost: new URL(delivered.url).host,
      },
      null,
      2,
    ),
  )
} catch (err) {
  exitCode = 1
  const tech = isMediaError(err)
    ? err.technicalSummary
    : err instanceof Error
      ? err.message
      : String(err)
  console.error(
    JSON.stringify({
      result: 'FAIL',
      category: isMediaError(err) ? err.category : 'UNKNOWN',
      technical: redact(tech),
      deliveryId,
      remoteKey,
    }),
  )
  // best-effort cleanup
  if (deliveryId) {
    try {
      await media.revoke(PROJECT, deliveryId)
    } catch {
      /* ignore */
    }
  }
} finally {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
}

function eq(a: string, b: string, msg: string) {
  assert(a === b, `${msg}: ${a} !== ${b}`)
}

process.exit(exitCode)
