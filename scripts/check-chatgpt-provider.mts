import assert from 'node:assert/strict'
import { ChatGPTPlanProvider, buildPlanRequest, readPlanStream, planError } from '../server/src/providers/chatgptPlanProvider.js'
import { createAiProvider } from '../server/src/providers/aiProvider.js'
import { createImageGenerationProvider } from '../server/src/image/imageGenerationProvider.js'
import { applyCostToRecord } from '../server/src/persistence/costModel.js'
import { defaultSettings } from '../server/src/persistence/settingsTypes.js'

const encoder = new TextEncoder()
function stream(events: unknown[]) { return new Response(new ReadableStream({ start(c) { for (const event of events) c.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)); c.close() } }), { headers: { 'content-type': 'text/event-stream' } }) }
const auth = { getAccessToken: async () => 'fixture-opaque-access-token' }
const seen: Array<{url:string;body?:Record<string,any>}> = []
const request: typeof fetch = async (url, init) => {
  seen.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined })
  if (String(url).endsWith('/models')) return Response.json({ models: [{ slug: 'account-visible-model', display_name: 'Account Model', visibility: 'list' }, { slug: 'hidden-model', visibility: 'hidden' }] })
  return stream([{ type: 'response.output_text.delta', delta: 'connected' }, { type: 'response.completed', response: { status: 'completed', model: 'account-visible-model', usage: { input_tokens: 4, output_tokens: 1 } } }])
}
const provider = new ChatGPTPlanProvider(auth, request)
assert.deepEqual(await provider.catalog(), [{ slug: 'account-visible-model', displayName: 'Account Model', visibility: 'list' }])
console.log('E PASS account catalog visibility and slug')
const result = await provider.chat({ model: 'unsupported-profile-default', messages: [{ role: 'system', content: 'agent instructions preserved' }, { role: 'user', content: 'hello' }] })
const body = seen.at(-1)!.body!
assert.equal(body.model, 'account-visible-model'); assert.equal(body.store, false); assert.equal(body.stream, true); assert.equal(body.instructions, 'agent instructions preserved'); assert.deepEqual(body.input, [{ role: 'user', content: 'hello' }])
for (const field of ['temperature','previous_response_id','background','conversation','max_output_tokens','max_tool_calls','metadata','moderation','multi_agent','prompt','prompt_cache_retention','safety_identifier','top_logprobs','top_p','truncation','user']) assert.equal(field in body, false)
assert.equal(result.content, 'connected'); assert.equal(result.usage.authMode, 'chatgpt-plan'); assert.equal(result.usage.provider, 'openai-chatgpt-plan')
await assert.rejects(readPlanStream(stream([{ type: 'response.output_text.delta', delta: 'partial' }]), 'fixture'), { code: 'CHATGPT_STREAM_INCOMPLETE' })
await assert.rejects(readPlanStream(stream([{ type: 'response.failed', response: { error: { code: 'subscription_sharing_usage_limit_exceeded' } } }]), 'fixture'), { code: 'CHATGPT_PLAN_LIMIT_REACHED' })
assert.deepEqual(applyCostToRecord({ provider: 'openai-chatgpt-plan', model: 'gpt-4o', inputTokens: 100 }), { costUnknown: true })
console.log('F PASS constrained request, terminal success, interrupted failure, plan cost unknown')
assert.equal((planError(429, 'subscription_sharing_usage_limit_exceeded') as any).code, 'CHATGPT_PLAN_LIMIT_REACHED')
assert.equal((planError(400, 'subscription_sharing_unsupported_capability') as any).code, 'CHATGPT_UNSUPPORTED_CAPABILITY')
console.log('G PASS exact plan errors separated from API credit')
const vision = buildPlanRequest([{ role:'user', content:[{type:'text',text:'see screenshot'},{type:'image_url',image_url:{url:'data:image/png;base64,fixture'}}]}], 'account-visible-model')
assert.deepEqual(vision.input[0].content, [{type:'input_text',text:'see screenshot'},{type:'input_image',image_url:'data:image/png;base64,fixture',detail:'auto'}])
console.log('H PASS multimodal image input preserved')
const document = buildPlanRequest([{role:'user',content:[{type:'file',file:{filename:'report.pdf',file_data:'data:application/pdf;base64,fixture'}}]}], 'account-visible-model')
assert.deepEqual(document.input[0].content, [{type:'input_file',filename:'report.pdf',file_data:'data:application/pdf;base64,fixture'}])
console.log('H-file PASS local document representation, no Files upload API')
const priorKey = process.env.OPENAI_API_KEY
try {
  delete process.env.OPENAI_API_KEY
  assert.equal(createImageGenerationProvider().getState().available, false)
  assert.equal(provider.isConfigured(), true)
  console.log('I PASS plan connection does not enable image API')
  process.env.OPENAI_API_KEY = 'fixture-api-key-never-requested'
  assert.equal(defaultSettings().openai.authMode, 'chatgpt-plan')
  assert.equal(createAiProvider().isConfigured(), false)
  let calls = 0
  const failing = new ChatGPTPlanProvider(auth, async (url) => {
    assert.ok(String(url).endsWith('/models') || String(url).endsWith('/responses'))
    calls++
    return String(url).endsWith('/models') ? Response.json({ models: [{ slug: 'account-model',visibility:'list' }] }) : Response.json({ error:{code:'subscription_sharing_usage_limit_exceeded'} }, {status:429})
  })
  await assert.rejects(failing.chat({messages:[{role:'user',content:'test'}]}), {code:'CHATGPT_PLAN_LIMIT_REACHED'})
  assert.equal(calls, 2)
  console.log('J PASS key present, plan failure causes zero API billing requests')
} finally { if (priorKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = priorKey }
