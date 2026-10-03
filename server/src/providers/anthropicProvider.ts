import type { AiProviderState } from '../types.js'
import type { AiProvider, ChatContentPart, ChatMessage, ChatResult, JsonSchemaSpec } from './aiProvider.js'

export const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-5-5'
export const CLAUDE_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5-20251001'] as const

type AnthropicBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'document'; source: { type: 'base64'; media_type: string; data: string } }

function dataUrlParts(url: string): { mediaType: string; data: string } | null {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(url)
  return m ? { mediaType: m[1], data: m[2] } : null
}

function toBlocks(content: string | ChatContentPart[]): string | AnthropicBlock[] {
  if (typeof content === 'string') return content
  const blocks: AnthropicBlock[] = []
  for (const part of content) {
    if (part.type === 'text') blocks.push({ type: 'text', text: part.text })
    else if (part.type === 'image_url') {
      const d = dataUrlParts(part.image_url.url)
      if (d) blocks.push({ type: 'image', source: { type: 'base64', media_type: d.mediaType, data: d.data } })
    } else if (part.type === 'file') {
      const d = dataUrlParts(part.file.file_data)
      if (d && d.mediaType === 'application/pdf') blocks.push({ type: 'document', source: { type: 'base64', media_type: d.mediaType, data: d.data } })
    }
  }
  return blocks
}

/** Anthropic Messages API (API key, billed per use). Never logs or returns the key. */
export class AnthropicProvider implements AiProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model: string = DEFAULT_CLAUDE_MODEL,
    private readonly baseUrl = process.env.ANTHROPIC_BASE_URL?.trim() || 'https://api.anthropic.com',
  ) {}

  getState(): AiProviderState {
    return { mode: 'anthropic', label: 'Claude API', configured: true, providerName: 'anthropic', authMode: 'api-key', model: this.model }
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey)
  }

  async chat(input: { signal?: AbortSignal; messages: ChatMessage[]; jsonSchema?: JsonSchemaSpec; temperature?: number; model?: string }): Promise<ChatResult> {
    // Model-profile overrides are OpenAI ids unless they name a Claude model.
    const model = input.model?.trim().startsWith('claude') ? input.model.trim() : this.model
    const system = input.messages
      .filter((m) => m.role === 'system')
      .map((m) => (typeof m.content === 'string' ? m.content : m.content.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text).join('\n')))
      .join('\n\n')
    const messages = input.messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role, content: toBlocks(m.content) }))
    const body: Record<string, unknown> = { model, max_tokens: 8192, messages, ...(system ? { system } : {}) }
    if (input.jsonSchema) {
      // Structured output via a forced tool call; the tool input is the JSON answer.
      body.tools = [{ name: input.jsonSchema.name, description: 'Return the answer in this exact structure.', input_schema: input.jsonSchema.schema }]
      body.tool_choice = { type: 'tool', name: input.jsonSchema.name }
    }
    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: { 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: input.signal,
    })
    if (!res.ok) {
      const text = (await res.text().catch(() => '')).replace(/sk-ant-[A-Za-z0-9_-]+/g, '[redacted]')
      const code = res.status === 401 ? 'ANTHROPIC_API_KEY_INVALID' : res.status === 429 ? 'ANTHROPIC_RATE_LIMITED' : 'ANTHROPIC_API_ERROR'
      throw Object.assign(new Error(`Claude API error ${res.status}: ${text.slice(0, 400)}`), { status: res.status >= 400 && res.status < 600 ? res.status : 502, code })
    }
    const data = (await res.json()) as {
      model?: string
      content?: Array<{ type: string; text?: string; input?: unknown }>
      usage?: { input_tokens?: number; output_tokens?: number }
    }
    const tool = data.content?.find((b) => b.type === 'tool_use')
    const content = input.jsonSchema && tool
      ? JSON.stringify(tool.input)
      : (data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('').trim()
    if (!content) throw Object.assign(new Error('Claude returned empty content'), { status: 502, code: 'ANTHROPIC_EMPTY_RESPONSE' })
    return {
      content,
      usage: { provider: 'anthropic', authMode: 'api-key', model: data.model ?? model, inputTokens: data.usage?.input_tokens, outputTokens: data.usage?.output_tokens },
    }
  }
}
