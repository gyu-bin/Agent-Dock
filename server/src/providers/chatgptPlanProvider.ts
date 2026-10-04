import { reportProgress } from '../ai/runProgress.js'
import type { AiProvider, ChatMessage, ChatResult, JsonSchemaSpec } from './aiProvider.js'
import type { AiProviderState } from '../types.js'

export interface PlanAuth { getAccessToken(): Promise<string> }
export interface PlanModel { slug: string; displayName: string; visibility: 'list' }

export function planError(status: number, code?: string, requestId?: string): Error {
  const mapped = code === 'subscription_sharing_usage_limit_exceeded' ? 'CHATGPT_PLAN_LIMIT_REACHED'
    : code?.includes('unsupported_capability') || code?.includes('route_not_supported') ? 'CHATGPT_UNSUPPORTED_CAPABILITY'
    : code === 'subscription_sharing_user_not_eligible' ? 'CHATGPT_PLAN_UNAVAILABLE'
    : status === 401 ? 'CHATGPT_SESSION_EXPIRED'
    : status === 403 ? 'CHATGPT_PLAN_PERMISSION_REQUIRED' : 'CHATGPT_PLAN_UNAVAILABLE'
  const messages: Record<string, string> = {
    CHATGPT_PLAN_LIMIT_REACHED: 'ChatGPT 플랜 사용 한도에 도달했습니다. ChatGPT 설정의 사용량을 확인해주세요.',
    CHATGPT_UNSUPPORTED_CAPABILITY: '이 기능은 현재 ChatGPT 플랜 연결 방식에서 지원되지 않습니다.',
    CHATGPT_SESSION_EXPIRED: 'ChatGPT에 다시 연결해주세요.',
    CHATGPT_PLAN_PERMISSION_REQUIRED: 'Agent Deck에서 ChatGPT 플랜 사용을 허용해주세요.',
    CHATGPT_PLAN_UNAVAILABLE: '현재 선택한 계정에서 ChatGPT 플랜 요청을 실행할 수 없습니다. 연결 상태와 정책을 확인해주세요.',
  }
  return Object.assign(new Error(messages[mapped]), { status, code: mapped, upstreamCode: code, requestId })
}

export function buildPlanRequest(messages: ChatMessage[], model: string, schema?: JsonSchemaSpec) {
  const instructions = messages.filter(m => m.role === 'system').map(m => typeof m.content === 'string' ? m.content : m.content.filter(p => p.type === 'text').map(p => p.text).join('\n')).join('\n\n')
  return {
    model, store: false, stream: true,
    ...(instructions ? { instructions } : {}),
    input: messages.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content : m.content.map(p => p.type === 'text' ? { type: 'input_text', text: p.text } : p.type === 'file' ? { type: 'input_file', filename: p.file.filename, file_data: p.file.file_data } : { type: 'input_image', image_url: p.image_url.url, detail: p.image_url.detail ?? 'auto' }) })),
    ...(schema ? { text: { format: { type: 'json_schema', name: schema.name, strict: true, schema: schema.schema } } } : {}),
  }
}

/** Only the terminal completed event commits inference success. Tokens never leave this module. */
export async function readPlanStream(response: Response, model: string, onCompleted?: (response: Record<string, any>) => void): Promise<ChatResult> {
  if (!response.body) throw Object.assign(new Error('ChatGPT 응답 스트림이 없습니다.'), { code: 'CHATGPT_STREAM_INCOMPLETE', status: 502 })
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''; let content = ''; let completed: Record<string, any> | undefined; let reported = 0
  try {
    while (true) {
      const chunk = await reader.read()
      buffer = (buffer + decoder.decode(chunk.value, { stream: !chunk.done })).replace(/\r\n/g, '\n')
      let split: number
      while ((split = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, split); buffer = buffer.slice(split + 2)
        const payload = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
        if (!payload || payload === '[DONE]') continue
        let event: Record<string, any>
        try { event = JSON.parse(payload) } catch { throw Object.assign(new Error('ChatGPT 응답 스트림을 읽을 수 없습니다.'), { code: 'CHATGPT_STREAM_INCOMPLETE', status: 502 }) }
        if (event.type === 'response.output_text.delta') {
          content += event.delta ?? ''
          if (content.length - reported >= 200) { reported = content.length; reportProgress({ chars: content.length }) }
        }
        if (event.type === 'response.failed' || event.type === 'error') throw planError(502, event.response?.error?.code ?? event.code)
        if (event.type === 'response.completed') completed = event.response
      }
      if (chunk.done || completed) break
    }
  } finally { await reader.cancel().catch(() => undefined) }
  if (!completed || completed.status && completed.status !== 'completed') throw Object.assign(new Error('ChatGPT 응답이 완료되기 전에 연결이 종료됐습니다.'), { code: 'CHATGPT_STREAM_INCOMPLETE', status: 502 })
  onCompleted?.(completed)
  const finalText = (completed.output ?? []).flatMap((item: any) => (item.content ?? []).filter((part: any) => part.type === 'output_text').map((part: any) => part.text)).join('')
  content = finalText || content
  if (!content.trim()) throw Object.assign(new Error('ChatGPT가 빈 응답을 반환했습니다.'), { code: 'CHATGPT_EMPTY_RESPONSE', status: 502 })
  return { content, usage: { model: completed.model ?? model, inputTokens: completed.usage?.input_tokens, outputTokens: completed.usage?.output_tokens, provider: 'openai-chatgpt-plan', authMode: 'chatgpt-plan', costBasis: 'plan-included' } }
}

export class ChatGPTPlanProvider implements AiProvider {
  private models: PlanModel[] = []
  private accountKey = ''
  private preferredModel = ''
  private selectedModel = ''
  constructor(private auth: PlanAuth, private request: typeof fetch = fetch) {}
  getState(): AiProviderState { return { mode: 'chatgpt-plan', label: 'ChatGPT Plan', configured: true, providerName: 'openai-chatgpt-plan', authMode: 'chatgpt-plan', model: this.selectedModel || this.models.find(m => m.slug === this.preferredModel)?.slug || this.models[0]?.slug } }
  setPreferredModel(model: string) { if (this.preferredModel !== model) this.selectedModel = ''; this.preferredModel = model }
  isConfigured(): boolean { return true }
  clearCatalog() { this.models = []; this.accountKey = ''; this.selectedModel = '' }
  async catalog(accountKey = '', force = false): Promise<PlanModel[]> {
    if (force || !this.models.length || this.accountKey !== accountKey) {
      const token = await this.auth.getAccessToken()
      const response = await this.request('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) })
      if (!response.ok) throw await this.responseError(response)
      const body = await response.json() as { models?: Array<{ slug?: string; display_name?: string; visibility?: string }> }
      this.models = (body.models ?? []).filter(m => m.visibility === 'list' && typeof m.slug === 'string').map(m => ({ slug: m.slug!, displayName: m.display_name ?? m.slug!, visibility: 'list' }))
      this.accountKey = accountKey
    }
    return this.models
  }
  async chat(input: { signal?: AbortSignal; messages: ChatMessage[]; model?: string; jsonSchema?: JsonSchemaSpec }): Promise<ChatResult> {
    input.signal?.throwIfAborted()
    const models = await this.catalog(this.accountKey)
    input.signal?.throwIfAborted()
    // Existing profile defaults may be API-only: choose an actual catalog entry.
    const model = models.find(m => m.slug === input.model)?.slug ?? models.find(m => m.slug === this.preferredModel)?.slug ?? models[0]?.slug
    if (!model) throw Object.assign(new Error('현재 ChatGPT 계정에서 사용할 수 있는 모델이 없습니다.'), { code: 'CHATGPT_MODEL_UNAVAILABLE', status: 503 })
    const token = await this.auth.getAccessToken()
    input.signal?.throwIfAborted()
    const response = await this.request('https://api.openai.com/v1/responses', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(buildPlanRequest(input.messages, model, input.jsonSchema)), signal: input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(180_000)]) : AbortSignal.timeout(180_000) })
    if (!response.ok) throw await this.responseError(response)
    const result = await readPlanStream(response, model)
    this.selectedModel = result.usage.model
    return result
  }
  async webSearch(query: string, signal?: AbortSignal): Promise<Record<string, any>> {
    signal?.throwIfAborted()
    const models = await this.catalog(this.accountKey)
    const model = models.find(m => m.slug === this.preferredModel)?.slug ?? models[0]?.slug
    if (!model) throw Object.assign(new Error('ChatGPT 모델을 사용할 수 없습니다.'), { status: 503, code: 'CHATGPT_MODEL_UNAVAILABLE' })
    const token = await this.auth.getAccessToken()
    signal?.throwIfAborted()
    const response = await this.request('https://api.openai.com/v1/responses', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...buildPlanRequest([{ role: 'user', content: `Search the web and cite real sources for: ${query}` }], model), tools: [{ type: 'web_search' }], include: ['web_search_call.action.sources'] }), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(90_000)]) : AbortSignal.timeout(90_000) })
    if (!response.ok) throw await this.responseError(response)
    let completed: Record<string, any> = {}
    await readPlanStream(response, model, data => { completed = data })
    return completed
  }
  private async responseError(response: Response) {
    const body = await response.json().catch(() => ({})) as { error?: { code?: string } }
    return planError(response.status, body.error?.code, response.headers.get('x-request-id') ?? undefined)
  }
}
