import { OpenAIProvider, requireConfigured, type AiProvider, type ChatMessage, type JsonSchemaSpec } from './aiProvider.js'
import { ChatGPTPlanProvider } from './chatgptPlanProvider.js'
import { AnthropicProvider } from './anthropicProvider.js'
import { chatgptAuthService } from '../chatgpt/chatgptAuthService.js'
import { settingsRepository } from '../persistence/settingsRepository.js'
import type { AiProviderState } from '../types.js'

export const planProvider = new ChatGPTPlanProvider(chatgptAuthService)
export class SelectedAiProvider implements AiProvider {
  private state: AiProviderState = { mode: 'not-configured', configured: false, label: 'ChatGPT 연결 필요', providerName: 'openai-chatgpt-plan', authMode: 'chatgpt-plan' }
  private enabled = true
  private account = ''
  private planReady = false
  private claude: AnthropicProvider | null = null
  /** ChatGPT Plan search stays usable for research even when Claude runs the steps. */
  planSearchReady() { return this.planReady && this.enabled }
  async refresh() {
    const settings = await settingsRepository.load()
    this.enabled = settings.openai.enabled
    planProvider.setPreferredModel(settings.openai.model)
    const plan = await chatgptAuthService.getStatus()
    this.planReady = plan.supported && plan.signedIn && plan.planUsageEnabled && settings.openai.authMode === 'chatgpt-plan'
    this.claude = null
    if (settings.engine === 'claude') {
      const key = process.env.ANTHROPIC_API_KEY?.trim()
      if (key) {
        this.claude = new AnthropicProvider(key, settings.anthropic.model)
        this.state = { ...this.claude.getState(), configured: this.enabled }
      } else {
        this.state = { mode: 'not-configured', configured: false, providerName: 'anthropic', authMode: 'api-key', label: 'Claude API 키 필요', model: settings.anthropic.model, configurationErrorCode: 'ANTHROPIC_API_KEY_REQUIRED' }
      }
    } else if (settings.openai.authMode === 'api-key') {
      this.state = { mode: process.env.OPENAI_API_KEY?.trim() ? 'openai' : 'not-configured', configured: Boolean(process.env.OPENAI_API_KEY?.trim()) && this.enabled, providerName: 'openai', authMode: 'api-key', label: 'OpenAI API · 별도 API Billing', model: settings.openai.model }
    } else {
      const status = await chatgptAuthService.getStatus()
      const accountKey = status.account ? `${status.account.subject}:${status.account.clientId}` : ''
      if (accountKey !== this.account) { planProvider.clearCatalog(); this.account = accountKey }
      this.state = { ...planProvider.getState(), configured: status.supported && status.signedIn && status.planUsageEnabled && this.enabled, label: status.planUsageEnabled ? 'ChatGPT Plan' : 'ChatGPT 연결 필요', configurationErrorCode: !status.supported ? 'CHATGPT_LOCAL_ONLY' : !status.signedIn ? 'CHATGPT_SIGNIN_REQUIRED' : !status.planUsageEnabled ? 'CHATGPT_PLAN_PERMISSION_REQUIRED' : undefined }
    }
    if (!this.enabled) this.state.configurationErrorCode = 'AI_PROVIDER_DISABLED'
  }
  getState() { return this.state }
  isConfigured() { return this.state.configured }
  async chat(input: { signal?: AbortSignal; messages: ChatMessage[]; jsonSchema?: JsonSchemaSpec; temperature?: number; model?: string }) {
    input.signal?.throwIfAborted()
    await this.refresh()
    input.signal?.throwIfAborted()
    requireConfigured(this)
    if (this.claude) return this.claude.chat(input)
    if (this.state.authMode === 'api-key') return new OpenAIProvider(process.env.OPENAI_API_KEY!.trim()).chat(input)
    const result = await planProvider.chat(input)
    this.state.model = result.usage.model
    return result
  }
}
