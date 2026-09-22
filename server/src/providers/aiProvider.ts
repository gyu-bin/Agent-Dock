import type { AiProviderState } from '../types.js'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatUsage {
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
    messages: ChatMessage[]
    jsonSchema?: JsonSchemaSpec
    temperature?: number
    /** Settings Model Profile override */
    model?: string
  }): Promise<ChatResult>
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
  getState(): AiProviderState {
    return {
      mode: 'not-configured',
      label: 'OpenAI · Not configured',
      configured: false,
      providerName: 'openai',
    }
  }
  isConfigured(): boolean {
    return false
  }
  async chat(): Promise<ChatResult> {
    throw Object.assign(
      new Error('OPENAI_API_KEY is not configured. Real AI execution unavailable.'),
      { status: 503 },
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
      model: this.model,
    }
  }

  isConfigured(): boolean {
    return true
  }

  async chat(input: {
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

export function createAiProvider(): AiProvider {
  const key = process.env.OPENAI_API_KEY?.trim()
  if (key) return new OpenAIProvider(key)
  // Prefer explicit not-configured over pretending Real AI works
  return new UnconfiguredAiProvider()
}
