/**
 * Real OpenAI Image Provider smoke test — at most ONE live generation.
 * Run: node --import tsx tools/openai-image-smoke.mts
 *
 * Does not implement new features. Verifies OpenAIImageProvider end-to-end.
 * Never prints API keys.
 */
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadDotEnv } from '../server/src/loadEnv.ts'
import {
  OpenAIImageProvider,
  ImageStorage,
  createImageGenerationService,
  getImageModelFast,
  getImageModelQuality,
} from '../server/src/image/index.ts'
import type {
  ImageGenerationError,
  ImageGenerationProvider,
  ImageGenerationRequest,
  ImageGenerationResult,
  ImageProviderState,
} from '../server/src/image/types.ts'
import { JsonArtifactRepository } from '../server/src/persistence/artifactRepository.ts'
import { ArtifactService } from '../server/src/persistence/artifactService.ts'
import { JsonProjectRepository } from '../server/src/persistence/jsonStore.ts'
import { ProjectService } from '../server/src/persistence/projectService.ts'
import { UsageService } from '../server/src/persistence/usageService.ts'
import { JsonUsageRepository } from '../server/src/persistence/usageRepository.ts'
import { JsonMarketingRepository } from '../server/src/marketing/marketingRepository.ts'
import { MarketingService } from '../server/src/marketing/marketingService.ts'

loadDotEnv()

type SmokeFailClass =
  | 'AUTH'
  | 'QUOTA'
  | 'RATE_LIMIT'
  | 'INVALID_MODEL'
  | 'INVALID_PARAMETER'
  | 'UPSTREAM'
  | 'STORAGE'
  | 'UNKNOWN'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg)
}

function redact(text: string): string {
  return text
    .replace(/sk-[a-zA-Z0-9_-]+/g, '[redacted]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
}

function classifySmokeFailure(err: unknown): {
  class: SmokeFailClass
  userMessage: string
  technical: string
} {
  const e = err as ImageGenerationError
  const tech = redact(String(e?.technicalSummary ?? e?.message ?? err))
  const cat = e?.category
  if (cat === 'IMAGE_NOT_CONFIGURED') {
    return { class: 'AUTH', userMessage: e.userMessage, technical: tech }
  }
  if (cat === 'IMAGE_QUOTA') {
    return { class: 'QUOTA', userMessage: e.userMessage, technical: tech }
  }
  if (cat === 'IMAGE_RATE_LIMIT') {
    return { class: 'RATE_LIMIT', userMessage: e.userMessage, technical: tech }
  }
  if (cat === 'IMAGE_STORAGE_ERROR') {
    return { class: 'STORAGE', userMessage: e.userMessage, technical: tech }
  }
  if (cat === 'IMAGE_UPSTREAM') {
    return { class: 'UPSTREAM', userMessage: e.userMessage, technical: tech }
  }
  if (cat === 'IMAGE_INVALID_REQUEST') {
    if (
      /model|invalid.?model|does not exist|unknown model|not found/i.test(tech)
    ) {
      return {
        class: 'INVALID_MODEL',
        userMessage: e.userMessage,
        technical: tech,
      }
    }
    return {
      class: 'INVALID_PARAMETER',
      userMessage: e.userMessage,
      technical: tech,
    }
  }
  return {
    class: 'UNKNOWN',
    userMessage: e?.userMessage ?? 'smoke failed',
    technical: tech,
  }
}

/** PNG signature + IHDR parse — no extra deps. */
function decodePngHeader(bytes: Buffer): {
  ok: boolean
  width?: number
  height?: number
} {
  if (bytes.length < 24) return { ok: false }
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (!bytes.subarray(0, 8).equals(sig)) return { ok: false }
  if (bytes.subarray(12, 16).toString('ascii') !== 'IHDR') return { ok: false }
  return {
    ok: true,
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  }
}

/**
 * Hard cap: at most one live OpenAI generate call (service retries cannot
 * trigger a second upstream request).
 */
class SingleShotProvider implements ImageGenerationProvider {
  private calls = 0
  constructor(private readonly inner: ImageGenerationProvider) {}

  getState(): ImageProviderState {
    return this.inner.getState()
  }

  async generate(request: ImageGenerationRequest): Promise<ImageGenerationResult> {
    if (this.calls >= 1) {
      const err = new Error(
        'smoke: second generate blocked (max 1 live image)',
      ) as ImageGenerationError
      err.category = 'IMAGE_INVALID_REQUEST'
      err.userMessage = '스모크 테스트는 이미지 1장만 허용합니다.'
      err.technicalSummary = 'single-shot guard'
      err.retryable = false
      throw err
    }
    this.calls += 1
    return this.inner.generate(request)
  }

  get callCount(): number {
    return this.calls
  }
}

const keyConfigured = Boolean(process.env.OPENAI_API_KEY?.trim())
const fastModel = getImageModelFast()
const qualityModel = getImageModelQuality()

console.log('=== OpenAI Image Smoke · Preflight ===')
console.log(JSON.stringify({
  OPENAI_API_KEY: keyConfigured ? 'configured' : 'missing',
  fastModel,
  qualityModel,
  endpoint: `${process.env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1'}/images/generations`,
  requestShape: {
    model: fastModel,
    prompt: '(brief)',
    n: 1,
    size: '1024x1024',
    quality: 'auto',
    output_format: 'png',
    background: 'opaque',
  },
  officialModels: ['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst'],
  modelCompat:
    fastModel === 'gpt-image-2.5-flare' &&
    qualityModel === 'gpt-image-2.5-sunburst'
      ? 'match'
      : 'check-overrides',
}))

if (!keyConfigured) {
  console.error('SMOKE FAIL · AUTH · OPENAI_API_KEY not configured — no call made')
  process.exit(1)
}

const dir = mkdtempSync(path.join(tmpdir(), 'ad-img-smoke-'))
const genDir = path.join(dir, 'generated')
const artifactsDir = path.join(dir, 'artifacts')
const usageDir = path.join(dir, 'usage')
const marketingDir = path.join(dir, 'marketing')
const projectsFile = path.join(dir, 'projects.json')
const PROJECT = 'proj_img_smoke'

const storage = new ImageStorage(genDir)
const projects = new ProjectService(new JsonProjectRepository(projectsFile))
const artifacts = new ArtifactService(new JsonArtifactRepository(artifactsDir))
const usage = new UsageService(new JsonUsageRepository(usageDir))

const openai = new OpenAIImageProvider(process.env.OPENAI_API_KEY!.trim(), storage)
const provider = new SingleShotProvider(openai)
const imageService = createImageGenerationService({
  artifacts,
  usage,
  storage,
  provider,
})

const marketing = new MarketingService(
  new JsonMarketingRepository(marketingDir),
  projects,
  artifacts,
  null,
  null,
  imageService,
)

const SOURCES = [
  {
    id: 'src_smoke',
    title: 'Mobile game promo notes',
    url: 'https://example.com/smoke',
    domain: 'example.com',
    snippet: 'cute mobile game promotional graphic clean modern composition',
  },
]

const BRIEF = {
  format: 'feed_post',
  aspectRatio: '1:1',
  subject: 'cute mobile game promotional graphic',
  headline: 'Play Now',
  visualDirection:
    'clean modern composition, soft colors, no copyrighted characters',
  requiredText: undefined,
  avoid: ['copyrighted characters', 'fake store badges'],
  imageToolStatus: 'available' as const,
}

let exitCode = 0

try {
  const now = new Date().toISOString()
  await new JsonProjectRepository(projectsFile).save({
    version: 5,
    revision: 1,
    activeProjectId: PROJECT,
    projects: [
      {
        id: PROJECT,
        name: 'Image Smoke',
        createdAt: now,
        updatedAt: now,
        tasks: [],
      },
    ],
  })

  // Campaign without auto images — keep live generation to exactly 1.
  const camp = await marketing.runCampaign({
    projectId: PROJECT,
    request: 'cute mobile game promotional graphic smoke',
    fixtureSources: SOURCES,
    autoGenerateImages: false,
    teamAgentIds: ['product-manager'],
    specialistAgentIds: ['growth-hacker'],
    allowWithoutSearch: true,
    searchAvailable: false,
  })
  const content =
    camp.contents.find((c) => c.channel === 'instagram') ?? camp.contents[0]
  assert(content, 'marketing content missing')

  console.log('=== Live call (max 1) ===')
  const t0 = Date.now()
  let gen
  try {
    gen = await imageService.generateFromBrief({
      brief: BRIEF,
      projectId: PROJECT,
      campaignId: camp.campaign.id,
      contentId: content.id,
      productName: 'Smoke Game',
      brandContext: 'indie mobile puzzle',
      purpose: 'social',
      modelProfile: 'fast',
      title: 'Smoke creative',
      skipBudget: true,
    })
  } catch (err) {
    const c = classifySmokeFailure(err)
    console.error(
      JSON.stringify({
        result: 'FAIL',
        class: c.class,
        userMessage: c.userMessage,
        technical: c.technical,
        liveCalls: provider.callCount,
        durationMs: Date.now() - t0,
      }),
    )
    if (c.class === 'INVALID_MODEL' || c.class === 'INVALID_PARAMETER') {
      console.error(
        'NOTE: Fixed code would require a second live call — not auto-retried per smoke policy.',
      )
    }
    exitCode = 1
    process.exit(exitCode)
  }

  const bytes = readFileSync(gen.result.filePath)
  const png = decodePngHeader(bytes)
  const rootResolved = path.resolve(genDir)
  const fileResolved = path.resolve(gen.result.filePath)
  const insideRoot =
    fileResolved.startsWith(rootResolved + path.sep) ||
    fileResolved === rootResolved

  const art = await artifacts.getArtifact(PROJECT, gen.artifactId)
  assert(art?.type === 'creative-image', 'artifact type')

  await marketing.patchContent(content.id, {
    projectId: PROJECT,
    creativeArtifactIds: [gen.artifactId],
  })
  const patched = (await marketing.listContent(PROJECT)).find(
    (c) => c.id === content.id,
  )
  assert(
    patched?.creativeArtifactIds?.includes(gen.artifactId),
    'marketing link',
  )

  const usageItems = await usage.list({ projectId: PROJECT })
  const rec = usageItems.find(
    (u) =>
      u.provider === 'openai-image' &&
      u.operation === 'image.generate' &&
      u.status === 'completed',
  )
  assert(rec, 'execution record')

  const dump = JSON.stringify({
    art: art?.content,
    meta: art?.metadata,
    usage: rec,
    marketing: patched,
  })
  assert(!/sk-[a-zA-Z0-9_-]{8,}/.test(dump), 'secret leaked')
  assert(!dump.includes(process.env.OPENAI_API_KEY!), 'key in dump')

  console.log(
    JSON.stringify(
      {
        result: 'PASS',
        liveCalls: provider.callCount,
        http: 'ok (provider accepted response)',
        model: gen.result.model,
        bytes: bytes.length,
        pngDecodable: png.ok,
        pngWidth: png.width,
        pngHeight: png.height,
        filePath: gen.result.filePath,
        publicPath: gen.result.publicPath,
        safeProjectPath: insideRoot,
        fileExists: existsSync(gen.result.filePath),
        artifactId: gen.artifactId,
        artifactType: art?.type,
        marketingContentId: content.id,
        creativeArtifactIds: patched?.creativeArtifactIds,
        executionId: gen.executionId ?? rec?.id,
        usageStatus: rec?.status,
        usageModel: rec?.model,
        durationMs: Date.now() - t0,
        secretsExposed: false,
      },
      null,
      2,
    ),
  )
} catch (err) {
  const c = classifySmokeFailure(err)
  console.error(
    JSON.stringify({
      result: 'FAIL',
      class: c.class === 'UNKNOWN' ? 'STORAGE' : c.class,
      userMessage: c.userMessage,
      technical: c.technical,
      liveCalls: provider.callCount,
    }),
  )
  exitCode = 1
} finally {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
}

process.exit(exitCode)
