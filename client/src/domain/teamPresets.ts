import type { DivisionId, ProjectType } from './types'

export interface TeamPresetRole {
  key: string
  label: string
  preferredDivisions: DivisionId[]
  preferredNameHints: string[]
  /** Specialists that fit this slot best, in order; tried before keyword scoring. */
  preferredAgentIds?: string[]
}

export interface TeamPreset {
  id: string
  projectType: ProjectType
  label: string
  roles: TeamPresetRole[]
}

export const TEAM_PRESETS: TeamPreset[] = [
  {
    id: 'steam-game',
    projectType: 'steam-game',
    label: 'Steam Game',
    roles: [
      { key: 'research', label: 'Research', preferredDivisions: ['research'], preferredNameHints: ['trend', 'research'], preferredAgentIds: ['trend-researcher', 'research-synthesist'] },
      { key: 'product', label: 'Product', preferredDivisions: ['product'], preferredNameHints: ['product', 'strategist'], preferredAgentIds: ['studio-producer', 'product-manager'] },
      { key: 'game-designer', label: 'Game Designer', preferredDivisions: ['game-development'], preferredNameHints: ['game-designer', 'game designer'], preferredAgentIds: ['game-designer'] },
      { key: 'level-designer', label: 'Level Designer', preferredDivisions: ['game-development'], preferredNameHints: ['level'], preferredAgentIds: ['level-designer'] },
      { key: 'technical-artist', label: 'Technical Artist', preferredDivisions: ['game-development'], preferredNameHints: ['technical-artist', 'technical artist'], preferredAgentIds: ['technical-artist', 'unity-shader-graph-artist'] },
      { key: 'ui-ux', label: 'UI/UX', preferredDivisions: ['design'], preferredNameHints: ['ui-designer', 'ux'], preferredAgentIds: ['ui-designer', 'ux-architect'] },
      { key: 'engineering', label: 'Engineering', preferredDivisions: ['engineering', 'game-development'], preferredNameHints: ['frontend', 'backend', 'unity', 'godot'], preferredAgentIds: ['unity-architect', 'godot-gameplay-scripter', 'unreal-systems-engineer'] },
      { key: 'testing', label: 'Testing', preferredDivisions: ['testing'], preferredNameHints: ['test', 'qa', 'reality'], preferredAgentIds: ['test-automation-engineer', 'test-results-analyzer'] },
      { key: 'reality-check', label: 'Reality Check', preferredDivisions: ['testing'], preferredNameHints: ['reality'], preferredAgentIds: ['reality-checker'] },
      { key: 'marketing', label: 'Marketing', preferredDivisions: ['marketing'], preferredNameHints: ['marketing', 'growth'], preferredAgentIds: ['growth-hacker', 'reddit-community-builder', 'social-media-strategist'] },
      { key: 'content', label: 'Content', preferredDivisions: ['marketing'], preferredNameHints: ['content'], preferredAgentIds: ['content-creator', 'visual-storyteller'] },
      { key: 'release', label: 'Release', preferredDivisions: ['marketing', 'project-management'], preferredNameHints: ['app-store', 'release'], preferredAgentIds: ['senior-project-manager', 'project-shepherd'] },
    ],
  },
  {
    id: 'mobile-game',
    projectType: 'mobile-game',
    label: 'Mobile Game',
    roles: [
      { key: 'product', label: 'Product', preferredDivisions: ['product'], preferredNameHints: ['product'], preferredAgentIds: ['product-manager', 'studio-producer'] },
      { key: 'game-designer', label: 'Game Designer', preferredDivisions: ['game-development'], preferredNameHints: ['game-designer'], preferredAgentIds: ['game-designer'] },
      { key: 'mobile-eng', label: 'Mobile Engineering', preferredDivisions: ['engineering'], preferredNameHints: ['mobile'], preferredAgentIds: ['unity-architect', 'mobile-app-builder'] },
      { key: 'ui', label: 'UI', preferredDivisions: ['design'], preferredNameHints: ['ui-designer'], preferredAgentIds: ['ui-designer'] },
      { key: 'tech-art', label: 'Technical Art', preferredDivisions: ['game-development'], preferredNameHints: ['technical-artist'], preferredAgentIds: ['technical-artist', 'unity-shader-graph-artist'] },
      { key: 'backend', label: 'Backend', preferredDivisions: ['engineering'], preferredNameHints: ['backend'], preferredAgentIds: ['backend-architect'] },
      { key: 'testing', label: 'Testing', preferredDivisions: ['testing'], preferredNameHints: ['test', 'qa'], preferredAgentIds: ['test-automation-engineer', 'reality-checker'] },
      { key: 'marketing', label: 'Marketing', preferredDivisions: ['marketing'], preferredNameHints: ['marketing'], preferredAgentIds: ['growth-hacker', 'tiktok-strategist', 'social-media-strategist'] },
      { key: 'app-store', label: 'App Store', preferredDivisions: ['marketing'], preferredNameHints: ['app-store', 'aso'], preferredAgentIds: ['app-store-optimizer', 'mobile-release-engineer'] },
    ],
  },
  {
    id: 'mobile-app',
    projectType: 'mobile-app',
    label: 'Mobile App',
    roles: [
      { key: 'research', label: 'Research', preferredDivisions: ['research'], preferredNameHints: ['research'], preferredAgentIds: ['trend-researcher', 'research-synthesist'] },
      { key: 'product', label: 'Product', preferredDivisions: ['product'], preferredNameHints: ['product'], preferredAgentIds: ['product-manager', 'senior-project-manager'] },
      { key: 'ux', label: 'UX', preferredDivisions: ['design'], preferredNameHints: ['ux'], preferredAgentIds: ['ux-researcher', 'ux-architect'] },
      { key: 'ui', label: 'UI', preferredDivisions: ['design'], preferredNameHints: ['ui-designer'], preferredAgentIds: ['ui-designer'] },
      { key: 'mobile-eng', label: 'Mobile Engineering', preferredDivisions: ['engineering'], preferredNameHints: ['mobile'], preferredAgentIds: ['mobile-app-builder'] },
      { key: 'backend', label: 'Backend', preferredDivisions: ['engineering'], preferredNameHints: ['backend'], preferredAgentIds: ['backend-architect', 'api-platform-engineer'] },
      { key: 'testing', label: 'Testing', preferredDivisions: ['testing'], preferredNameHints: ['test', 'qa'], preferredAgentIds: ['test-automation-engineer', 'api-tester'] },
      { key: 'security', label: 'Security', preferredDivisions: ['security'], preferredNameHints: ['security'], preferredAgentIds: ['application-security-engineer', 'privacy-engineer', 'security-architect'] },
      { key: 'marketing', label: 'Marketing', preferredDivisions: ['marketing'], preferredNameHints: ['marketing'], preferredAgentIds: ['growth-hacker', 'social-media-strategist', 'content-creator'] },
      { key: 'app-store', label: 'App Store', preferredDivisions: ['marketing'], preferredNameHints: ['app-store'], preferredAgentIds: ['app-store-optimizer', 'mobile-release-engineer'] },
    ],
  },
  {
    id: 'web-saas',
    projectType: 'saas',
    label: 'Web App / SaaS',
    roles: [
      { key: 'product', label: 'Product', preferredDivisions: ['product'], preferredNameHints: ['product'], preferredAgentIds: ['product-manager'] },
      { key: 'ux', label: 'UX', preferredDivisions: ['design'], preferredNameHints: ['ux'], preferredAgentIds: ['ux-architect', 'ux-researcher'] },
      { key: 'ui', label: 'UI', preferredDivisions: ['design'], preferredNameHints: ['ui'], preferredAgentIds: ['ui-designer'] },
      { key: 'frontend', label: 'Frontend', preferredDivisions: ['engineering'], preferredNameHints: ['frontend'], preferredAgentIds: ['frontend-developer'] },
      { key: 'backend', label: 'Backend', preferredDivisions: ['engineering'], preferredNameHints: ['backend'], preferredAgentIds: ['backend-architect', 'api-platform-engineer'] },
      { key: 'testing', label: 'Testing', preferredDivisions: ['testing'], preferredNameHints: ['test', 'qa'], preferredAgentIds: ['test-automation-engineer', 'api-tester'] },
      { key: 'security', label: 'Security', preferredDivisions: ['security'], preferredNameHints: ['security'], preferredAgentIds: ['application-security-engineer', 'security-architect'] },
      { key: 'devops', label: 'DevOps', preferredDivisions: ['engineering'], preferredNameHints: ['devops'], preferredAgentIds: ['devops-automator', 'sre-site-reliability-engineer'] },
      { key: 'marketing', label: 'Marketing', preferredDivisions: ['marketing'], preferredNameHints: ['marketing'], preferredAgentIds: ['growth-hacker', 'seo-specialist', 'content-creator'] },
    ],
  },
]

export function getPresetForProjectType(type: ProjectType): TeamPreset | undefined {
  if (type === 'web-app' || type === 'website') {
    return TEAM_PRESETS.find((p) => p.id === 'web-saas')
  }
  return TEAM_PRESETS.find((p) => p.projectType === type)
}
