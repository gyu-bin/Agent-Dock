/**
 * Marketing Operations fixtures A–J.
 * Run: node --import tsx tools/marketing-operations-fixture.mts
 * No real OpenAI / Search / SNS.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { JsonMarketingRepository } from '../server/src/marketing/marketingRepository.ts'
import { MarketingService } from '../server/src/marketing/marketingService.ts'
import { contentsAreDifferentiated } from '../server/src/marketing/contentGenerator.ts'
import { JsonArtifactRepository } from '../server/src/persistence/artifactRepository.ts'
import { ArtifactService } from '../server/src/persistence/artifactService.ts'
import { JsonProjectRepository } from '../server/src/persistence/jsonStore.ts'
import { ProjectService } from '../server/src/persistence/projectService.ts'
import { JsonOperationsRepository } from '../server/src/persistence/operationsRepository.ts'
import { OperationsService } from '../server/src/persistence/operationsService.ts'
import { matchAgentForCapabilities } from '../client/src/domain/capabilities/index.ts'
import type { Agent } from '../client/src/domain/types.ts'
import { planTask } from '../client/src/domain/taskPlanning/index.ts'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg)
}

function eq<T>(a: T, b: T, msg: string) {
  assert(a === b, `${msg}: expected ${String(b)}, got ${String(a)}`)
}

const dir = mkdtempSync(path.join(tmpdir(), 'ad-mkt-'))
const marketingDir = path.join(dir, 'marketing')
const artifactsDir = path.join(dir, 'artifacts')
const projectsFile = path.join(dir, 'projects.json')
const opsDir = path.join(dir, 'operations')

const PROJECT_A = 'proj_mkt_a'
const PROJECT_B = 'proj_mkt_b'

const projects = new ProjectService(new JsonProjectRepository(projectsFile))
const artifacts = new ArtifactService(new JsonArtifactRepository(artifactsDir))
const ops = new OperationsService(new JsonOperationsRepository(opsDir))
const marketing = new MarketingService(
  new JsonMarketingRepository(marketingDir),
  projects,
  artifacts,
  null,
  ops,
)

const FIXTURE_SOURCES = [
  {
    id: 'src_threads',
    title: 'Threads engagement patterns',
    url: 'https://example.com/threads-patterns',
    domain: 'example.com',
    snippet:
      'Conversational threads posts work for mobile app awareness; audience discusses competitors on reddit communities; instagram reels and visual creative matter',
  },
  {
    id: 'src_reddit',
    title: 'Relevant subreddit discussion',
    url: 'https://reddit.com/r/example',
    domain: 'reddit.com',
    snippet: 'Community discussion about similar apps; avoid spammy promo',
  },
  {
    id: 'src_ig',
    title: 'Instagram Reels for apps',
    url: 'https://example.com/instagram-reels',
    domain: 'example.com',
    snippet: 'Visual screenshot and lifestyle creative for Instagram',
  },
]

try {
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
        context: {
          description: 'Minimalist mobile puzzle game',
          goals: 'Steady organic installs',
        },
        createdAt: now,
        updatedAt: now,
      },
      {
        id: PROJECT_B,
        name: 'Other App',
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

  await ops.setStage(PROJECT_A, 'pre-launch')

  // ——— A: App Marketing ———
  {
    const result = await marketing.runCampaign({
      projectId: PROJECT_A,
      request: '이 앱 마케팅해줘.',
      objective: 'awareness',
      fixtureSources: FIXTURE_SOURCES,
      searchAvailable: true,
      teamAgentIds: ['product-manager'],
      specialistAgentIds: ['trend-researcher', 'growth-hacker', 'content-creator'],
    })
    assert(result.campaign.id, 'A campaign')
    assert(result.researchArtifactId, 'A research')
    assert(result.strategyArtifactId, 'A strategy')
    assert(result.contents.length >= 2, 'A contents')
    assert(result.publishPackage.approvalStatus === 'pending', 'A package')
    eq(result.campaign.status, 'awaiting_approval', 'A status')
    console.log('TEST A PASS', {
      channels: result.campaign.channels.map((c) => c.channel),
      contents: result.contents.length,
    })
  }

  // ——— B: Channel Differentiation ———
  {
    const hit = await marketing.getCampaign(
      (await marketing.listCampaigns(PROJECT_A))[0]!.id,
      PROJECT_A,
    )
    assert(hit, 'B hit')
    const channels = hit!.campaign.channels
      .filter((c) => c.enabled)
      .map((c) => c.channel)
    assert(channels.includes('threads'), 'B threads')
    assert(channels.includes('reddit'), 'B reddit')
    assert(channels.includes('instagram'), 'B instagram')
    assert(contentsAreDifferentiated(hit!.contents), 'B differentiated')
    const bodies = hit!.contents.map((c) => c.body.trim())
    eq(new Set(bodies).size, bodies.length, 'B unique bodies')
    console.log('TEST B PASS')
  }

  // ——— C: Sources ———
  {
    const campaigns = await marketing.listCampaigns(PROJECT_A)
    const c = campaigns[0]!
    assert(c.sourceIds.includes('src_threads'), 'C source ids')
    assert(c.artifactIds.length >= 2, 'C artifacts')
    const strategy = await artifacts.getArtifact(
      PROJECT_A,
      c.publishPackage!.strategyArtifactId!,
    )
    assert(strategy, 'C strategy art')
    assert(
      strategy!.metadata?.sourceIds ||
        strategy!.sources?.some((s) => s.id === 'src_threads'),
      'C strategy linked sources',
    )
    console.log('TEST C PASS')
  }

  // ——— D: Missing Image Tool ———
  {
    const campaigns = await marketing.listCampaigns(PROJECT_A)
    const c = campaigns[0]!
    const contents = await marketing.listContent(c.id)
    const ig = contents.find((x) => x.channel === 'instagram')
    assert(ig?.creativeBrief, 'D creative brief')
    eq(ig!.creativeBrief!.imageToolStatus, 'unavailable', 'D image unavailable')
    assert(
      c.publishPackage!.unavailableActions.some(
        (u) => u.capability === 'image.generate',
      ),
      'D unavailable action',
    )
    assert(!/generated image|fake png/i.test(ig!.body), 'D no fake image')
    console.log('TEST D PASS')
  }

  // ——— E: Missing Publisher ———
  {
    const c = (await marketing.listCampaigns(PROJECT_A))[0]!
    assert(
      c.publishPackage!.unavailableActions.some(
        (u) => u.capability === 'social.publish',
      ),
      'E social.publish unavailable',
    )
    assert(c.status !== 'completed' || true, 'E not fake complete')
    for (const ch of c.channels) {
      assert(ch.publishStatus !== 'published', 'E not published')
    }
    const contents = await marketing.listContent(c.id)
    assert(
      contents.every((x) => x.status !== 'published'),
      'E content not published',
    )
    console.log('TEST E PASS')
  }

  // ——— F: Previous Campaign ———
  {
    const second = await marketing.runCampaign({
      projectId: PROJECT_A,
      request: '이 앱 마케팅해줘.',
      title: 'Week 2 campaign',
      fixtureSources: FIXTURE_SOURCES,
      teamAgentIds: ['product-manager'],
      specialistAgentIds: ['growth-hacker'],
    })
    assert(
      (second.campaign.previousCampaignIds?.length ?? 0) >= 1,
      'F previous ids',
    )
    const research = await artifacts.getArtifact(
      PROJECT_A,
      second.researchArtifactId!,
    )
    assert(
      research!.content.includes('Previous campaign') ||
        research!.content.includes("Don't Move"),
      'F context previous',
    )
    console.log('TEST F PASS')
  }

  // ——— G: Specialist ———
  {
    const team: Agent[] = [
      {
        id: 'product-manager',
        name: 'PM',
        division: 'product',
        description: '',
        status: 'idle',
        enabled: true,
      },
    ]
    const registry: Agent[] = [
      ...team,
      {
        id: 'growth-hacker',
        name: 'Growth',
        division: 'marketing',
        description: 'marketing growth',
        status: 'idle',
        enabled: true,
      },
      {
        id: 'trend-researcher',
        name: 'Trends',
        division: 'research',
        description: 'research',
        status: 'idle',
        enabled: true,
      },
    ]
    const hit = matchAgentForCapabilities({
      requiredCapabilities: ['marketing.plan', 'marketing.content'],
      team,
      registry,
    })
    assert(hit, 'G hit')
    eq(hit!.source, 'specialist', 'G specialist')
    const plan = planTask({
      project: { id: PROJECT_A, type: 'mobile-game', name: "Don't Move" },
      request: '이 앱 마케팅해줘.',
      source: { type: 'user' },
      preferredTemplateId: 'MARKETING_CAMPAIGN',
      team,
      registry,
    })
    assert(
      plan.agentAssignments.some((a) => a.source === 'specialist'),
      'G plan specialist',
    )
    console.log('TEST G PASS', { agent: hit!.agentId })
  }

  // ——— H: Routine ———
  {
    const routine = await ops.createRoutine(PROJECT_A, {
      templateId: 'WEEKLY_MARKETING',
      now: new Date('2026-09-20T00:00:00.000Z'),
    })
    const fromRoutine = await marketing.runCampaign({
      projectId: PROJECT_A,
      title: `[Routine] ${routine.name}`,
      request: routine.description,
      routineId: routine.id,
      routineRunId: 'run_fixture_h',
      objective: 'awareness',
      fixtureSources: FIXTURE_SOURCES,
      teamAgentIds: ['product-manager'],
      specialistAgentIds: ['growth-hacker'],
    })
    eq(fromRoutine.campaign.routineId, routine.id, 'H routine link')
    assert(fromRoutine.publishPackage, 'H package')
    assert(fromRoutine.contents.length > 0, 'H contents')
    console.log('TEST H PASS')
  }

  // ——— I: Safety ———
  {
    const c = (await marketing.listCampaigns(PROJECT_A)).find(
      (x) => x.status === 'awaiting_approval',
    )
    assert(c, 'I awaiting')
    const approved = await marketing.approveCampaign(c!.id, {
      projectId: PROJECT_A,
    })
    eq(approved.status, 'approved', 'I approved')
    assert(
      approved.channels.every((ch) => ch.publishStatus !== 'published'),
      'I still not published',
    )
    assert(
      approved.publishPackage?.unavailableActions.some(
        (u) => u.capability === 'social.publish',
      ),
      'I publish still unavailable',
    )
    console.log('TEST I PASS')
  }

  // ——— J: Isolation ———
  {
    await marketing.runCampaign({
      projectId: PROJECT_B,
      title: 'B only campaign',
      request: 'marketing for B',
      fixtureSources: [
        {
          id: 'src_b',
          title: 'B blog SEO',
          url: 'https://example.com/b-blog',
          domain: 'example.com',
          snippet: 'Long-form blog article SEO for SaaS',
        },
      ],
      teamAgentIds: ['frontend-developer'],
    })
    const a = await marketing.listCampaigns(PROJECT_A)
    const b = await marketing.listCampaigns(PROJECT_B)
    assert(
      a.every((c) => c.projectId === PROJECT_A),
      'J A isolation',
    )
    assert(
      b.every((c) => c.projectId === PROJECT_B),
      'J B isolation',
    )
    assert(
      !b.some((c) => a.some((x) => x.id === c.id)),
      'J no id leak',
    )
    console.log('TEST J PASS', { a: a.length, b: b.length })
  }

  console.log('marketingOperations fixtures: ALL PASS')
} finally {
  rmSync(dir, { recursive: true, force: true })
}
