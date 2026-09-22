export type DivisionId =
  | 'academic'
  | 'design'
  | 'engineering'
  | 'finance'
  | 'game-development'
  | 'gis'
  | 'healthcare'
  | 'marketing'
  | 'paid-media'
  | 'product'
  | 'project-management'
  | 'research'
  | 'sales'
  | 'security'
  | 'spatial-computing'
  | 'specialized'
  | 'support'
  | 'testing'
  | 'strategy'

export type AgentStatus =
  | 'idle'
  | 'working'
  | 'waiting'
  | 'reviewing'
  | 'verifying'
  | 'blocked'
  | 'offline'

export interface AgentRecord {
  id: string
  name: string
  division: DivisionId
  description: string
  status: AgentStatus
  enabled: boolean
}

export interface AiProviderState {
  mode: 'mock' | 'not-configured' | 'openai'
  label: string
  configured: boolean
  providerName: 'none' | 'openai'
  model?: string
}
