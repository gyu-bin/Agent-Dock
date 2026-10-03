import type { AiProviderState } from '../types.js'

export type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'file'; file: { filename: string; file_data: string } }
  | {
      type: 'image_url'
      image_url: { url: string; detail?: 'auto' | 'low' | 'high' }
    }

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  /** Plain text, or multimodal parts for vision-capable models */
  content: string | ChatContentPart[]
}

export interface ChatUsage {
  provider?: 'openai' | 'openai-chatgpt-plan' | 'anthropic'
  authMode?: 'api-key' | 'chatgpt-plan'
  costBasis?: 'plan-included'
  model: string
  inputTokens?: number
  outputTokens?: number
}

export interface ChatResult {
  content: string
  usage: ChatUsage
}

export interface JsonSchemaSpec {
  name: string
  schema: Record<string, unknown>
}

/**
 * Future GPT / Codex providers plug in here.
 * Never log or return API keys.
 */
export interface AiProvider {
  getState(): AiProviderState
  isConfigured(): boolean
  chat(input: {
    signal?: AbortSignal
    messages: ChatMessage[]
    jsonSchema?: JsonSchemaSpec
    temperature?: number
    /** Settings Model Profile override */
    model?: string
  }): Promise<ChatResult>
}

export function requireConfigured(provider: AiProvider): void {
  if (provider.isConfigured()) return
  const state = provider.getState()
  const code = state.configurationErrorCode ?? (state.authMode === 'chatgpt-plan' ? 'CHATGPT_SIGNIN_REQUIRED' : 'OPENAI_API_KEY_REQUIRED')
  const message = code === 'ANTHROPIC_API_KEY_REQUIRED' ? 'Claude를 쓰려면 AgentDeck 폴더의 .env에 ANTHROPIC_API_KEY를 넣고 서버를 다시 시작해주세요.' : code === 'CHATGPT_PLAN_PERMISSION_REQUIRED' ? 'Agent Deck에서 ChatGPT 플랜 사용을 허용해주세요.' : code === 'CHATGPT_LOCAL_ONLY' ? 'ChatGPT 플랜 연결은 로컬 Agent Deck에서 사용할 수 있습니다.' : code === 'AI_PROVIDER_DISABLED' ? '설정에서 AI 기능을 켜주세요.' : state.authMode === 'chatgpt-plan' ? 'ChatGPT 연결이 필요합니다.' : 'OpenAI API Key 설정이 필요합니다.'
  throw Object.assign(new Error(message), { code, status: 503 })
}

export class MockAiProvider implements AiProvider {
  getState(): AiProviderState {
    return {
      mode: 'mock',
      label: 'Mock Mode',
      configured: false,
      providerName: 'none',
    }
  }
  isConfigured(): boolean {
    return false
  }
  async chat(): Promise<ChatResult> {
    throw Object.assign(new Error('Mock provider cannot run Real AI calls'), {
      status: 400,
    })
  }
}

export class UnconfiguredAiProvider implements AiProvider {
  constructor(private authMode: 'chatgpt-plan' | 'api-key' = 'api-key') {}
  getState(): AiProviderState {
    return {
      mode: 'not-configured',
      label: this.authMode === 'chatgpt-plan' ? 'ChatGPT 연결 필요' : 'OpenAI API · Not configured',
      configured: false,
      providerName: this.authMode === 'chatgpt-plan' ? 'openai-chatgpt-plan' : 'openai',
      authMode: this.authMode,
    }
  }
  isConfigured(): boolean {
    return false
  }
  async chat(): Promise<ChatResult> {
    throw Object.assign(
      new Error(this.authMode === 'chatgpt-plan' ? 'ChatGPT 연결이 필요합니다.' : 'OpenAI API Key 설정이 필요합니다.'),
      { status: 503, code: this.authMode === 'chatgpt-plan' ? 'CHATGPT_SIGNIN_REQUIRED' : 'OPENAI_API_KEY_REQUIRED' },
    )
  }
}

export class OpenAIProvider implements AiProvider {
  private readonly apiKey: string
  private readonly model: string
  private readonly baseUrl: string

  constructor(apiKey: string) {
    this.apiKey = apiKey
    this.model = process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini'
    this.baseUrl =
      process.env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1'
  }

  getState(): AiProviderState {
    return {
      mode: 'openai',
      label: 'OpenAI · Configured',
      configured: true,
      providerName: 'openai',
      authMode: 'api-key',
      model: this.model,
    }
  }

  isConfigured(): boolean {
    return true
  }

  async chat(input: {
    signal?: AbortSignal
    messages: ChatMessage[]
    jsonSchema?: JsonSchemaSpec
    temperature?: number
    /** Override from Model Profile routing (Settings). */
    model?: string
  }): Promise<ChatResult> {
    const model = input.model?.trim() || this.model
    const body: Record<string, unknown> = {
      model,
      messages: input.messages,
    }
    // Some models (e.g. gpt-5.6-luna) only accept default temperature=1.
    // Omit temperature unless the model family is known to support custom values.
    if (supportsCustomTemperature(model) && input.temperature !== undefined) {
      body.temperature = input.temperature
    } else if (supportsCustomTemperature(model)) {
      body.temperature = 0.4
    }
    if (input.jsonSchema) {
      body.response_format = {
        type: 'json_schema',
        json_schema: {
          name: input.jsonSchema.name,
          strict: true,
          schema: input.jsonSchema.schema,
        },
      }
    }

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: input.signal,
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      const safe = errText.replace(/sk-[a-zA-Z0-9_-]+/g, '[redacted]')
      throw Object.assign(
        new Error(`OpenAI API error ${res.status}: ${safe.slice(0, 400)}`),
        { status: res.status >= 400 && res.status < 600 ? res.status : 502 },
      )
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>
      usage?: {
        prompt_tokens?: number
        completion_tokens?: number
        input_tokens?: number
        output_tokens?: number
      }
      model?: string
    }
    const content = data.choices?.[0]?.message?.content?.trim() ?? ''
    if (!content) {
      throw Object.assign(new Error('OpenAI returned empty content'), {
        status: 502,
      })
    }
    return {
      content,
      usage: {
        provider: 'openai',
        authMode: 'api-key',
        model: data.model ?? model,
        inputTokens: data.usage?.prompt_tokens ?? data.usage?.input_tokens,
        outputTokens:
          data.usage?.completion_tokens ?? data.usage?.output_tokens,
      },
    }
  }
}

/** gpt-4o / gpt-4.1 families accept custom temperature; newer luna-style models often do not. */
function supportsCustomTemperature(model: string): boolean {
  const m = model.toLowerCase()
  if (m.includes('luna')) return false
  if (/^gpt-5/.test(m)) return false
  return true
}

export function createAiProvider(authMode: 'chatgpt-plan' | 'api-key' = 'chatgpt-plan'): AiProvider {
  const key = process.env.OPENAI_API_KEY?.trim()
  if (key && authMode === 'api-key') return new OpenAIProvider(key)
  // Prefer explicit not-configured over pretending Real AI works
  return new UnconfiguredAiProvider(authMode)
}
