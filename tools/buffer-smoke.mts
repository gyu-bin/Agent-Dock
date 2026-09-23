/**
 * Live Buffer smoke — READ by default, WRITE only with explicit flags.
 *
 * READ:
 *   AGENT_DECK_LIVE_BUFFER_TEST=1 BUFFER_API_KEY=... node --import tsx tools/buffer-smoke.mts
 *
 * WRITE (Draft or Queue — requires human confirmation via flag):
 *   AGENT_DECK_LIVE_BUFFER_TEST=1 AGENT_DECK_LIVE_BUFFER_WRITE_TEST=1 \
 *   BUFFER_API_KEY=... BUFFER_SMOKE_CHANNEL_ID=... node --import tsx tools/buffer-smoke.mts
 *
 * Default: exit 0 with SKIP when flags unset (no live API).
 */
import {
  BufferApi,
  createLiveBufferGraphQL,
  getBufferApiKey,
  redactBuffer,
} from '../server/src/social/buffer/index.ts'

const live = process.env.AGENT_DECK_LIVE_BUFFER_TEST === '1'
const write = process.env.AGENT_DECK_LIVE_BUFFER_WRITE_TEST === '1'

if (!live) {
  console.log(
    'SKIP live Buffer smoke (set AGENT_DECK_LIVE_BUFFER_TEST=1 to run)',
  )
  process.exit(0)
}

const key = getBufferApiKey()
if (!key) {
  console.error('FAIL: BUFFER_API_KEY required for live smoke')
  process.exit(1)
}

const api = new BufferApi(createLiveBufferGraphQL(key))

try {
  console.log('Smoke 1 — READ account / organizations / channels')
  const account = await api.fetchAccountAndChannels()
  console.log(
    JSON.stringify(
      {
        accountId: account.accountId,
        orgCount: account.organizations.length,
        organizations: account.organizations.map((o) => ({
          id: o.id,
          name: o.name,
        })),
        channelCount: account.channels.length,
        channels: account.channels.map((c) => ({
          id: c.id,
          name: c.name,
          service: c.service,
          organizationId: c.organizationId,
        })),
      },
      null,
      2,
    ),
  )
  console.log('Smoke 1 PASS — READ only')

  if (!write) {
    console.log(
      'SKIP Smoke 2 WRITE (set AGENT_DECK_LIVE_BUFFER_WRITE_TEST=1 + BUFFER_SMOKE_CHANNEL_ID)',
    )
    process.exit(0)
  }

  const channelId = process.env.BUFFER_SMOKE_CHANNEL_ID?.trim()
  if (!channelId) {
    console.error('FAIL: BUFFER_SMOKE_CHANNEL_ID required for write smoke')
    process.exit(1)
  }

  console.log('Smoke 2 — WRITE draft test post (explicit flag)')
  const created = await api.createPost({
    channelId,
    text: `[Agent Deck smoke] ${new Date().toISOString()} — safe to delete`,
    mode: 'draft',
    aiAssisted: true,
    saveToDraft: true,
  })
  console.log(
    JSON.stringify(
      {
        bufferPostId: created.bufferPostId,
        status: created.status,
        channelId: created.channelId,
      },
      null,
      2,
    ),
  )
  console.log('Smoke 2 PASS — draft created (not SNS published)')
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err)
  console.error('FAIL', redactBuffer(msg))
  process.exit(1)
}
