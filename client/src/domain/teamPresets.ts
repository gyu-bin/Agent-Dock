import type { DivisionId, ProjectType } from './types'

export interface TeamPresetRole {
  key: string
  label: string
  preferredDivisions: DivisionId[]
  preferredNameHints: string[]
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
      { key: 'research', label: 'Research', preferredDivisions: ['research'], preferredNameHints: ['trend', 'research'] },
      { key: 'product', label: 'Product', preferredDivisions: ['product'], preferredNameHints: ['product', 'strategist'] },
      { key: 'game-designer', label: 'Game Designer', preferredDivisions: ['game-development'], preferredNameHints: ['game-designer', 'game designer'] },
      { key: 'level-designer', label: 'Level Designer', preferredDivisions: ['game-development'], preferredNameHints: ['level'] },
      { key: 'technical-artist', label: 'Technical Artist', preferredDivisions: ['game-development'], preferredNameHints: ['technical-artist', 'technical artist'] },
      { key: 'ui-ux', label: 'UI/UX', preferredDivisions: ['design'], preferredNameHints: ['ui-designer', 'ux'] },
      { key: 'engineering', label: 'Engineering', preferredDivisions: ['engineering', 'game-development'], preferredNameHints: ['frontend', 'backend', 'unity', 'godot'] },
      { key: 'testing', label: 'Testing', preferredDivisions: ['testing'], preferredNameHints: ['test', 'qa', 'reality'] },
      { key: 'reality-check', label: 'Reality Check', preferredDivisions: ['testing'], preferredNameHints: ['reality'] },
      { key: 'marketing', label: 'Marketing', preferredDivisions: ['marketing'], preferredNameHints: ['marketing', 'growth'] },
      { key: 'content', label: 'Content', preferredDivisions: ['marketing'], preferredNameHints: ['content'] },
      { key: 'release', label: 'Release', preferredDivisions: ['marketing', 'project-management'], preferredNameHints: ['app-store', 'release'] },
    ],
  },
  {
    id: 'mobile-game',
    projectType: 'mobile-game',
    label: 'Mobile Game',
    roles: [
      { key: 'product', label: 'Product', preferredDivisions: ['product'], preferredNameHints: ['product'] },
      { key: 'game-designer', label: 'Game Designer', preferredDivisions: ['game-development'], preferredNameHints: ['game-designer'] },
      { key: 'mobile-eng', label: 'Mobile Engineering', preferredDivisions: ['engineering'], preferredNameHints: ['mobile'] },
      { key: 'ui', label: 'UI', preferredDivisions: ['design'], preferredNameHints: ['ui-designer'] },
      { key: 'tech-art', label: 'Technical Art', preferredDivisions: ['game-development'], preferredNameHints: ['technical-artist'] },
      { key: 'backend', label: 'Backend', preferredDivisions: ['engineering'], preferredNameHints: ['backend'] },
      { key: 'testing', label: 'Testing', preferredDivisions: ['testing'], preferredNameHints: ['test', 'qa'] },
      { key: 'marketing', label: 'Marketing', preferredDivisions: ['marketing'], preferredNameHints: ['marketing'] },
      { key: 'app-store', label: 'App Store', preferredDivisions: ['marketing'], preferredNameHints: ['app-store', 'aso'] },
    ],
  },
  {
    id: 'mobile-app',
    projectType: 'mobile-app',
    label: 'Mobile App',
    roles: [
      { key: 'research', label: 'Research', preferredDivisions: ['research'], preferredNameHints: ['research'] },
      { key: 'product', label: 'Product', preferredDivisions: ['product'], preferredNameHints: ['product'] },
      { key: 'ux', label: 'UX', preferredDivisions: ['design'], preferredNameHints: ['ux'] },
      { key: 'ui', label: 'UI', preferredDivisions: ['design'], preferredNameHints: ['ui-designer'] },
      { key: 'mobile-eng', label: 'Mobile Engineering', preferredDivisions: ['engineering'], preferredNameHints: ['mobile'] },
      { key: 'backend', label: 'Backend', preferredDivisions: ['engineering'], preferredNameHints: ['backend'] },
      { key: 'testing', label: 'Testing', preferredDivisions: ['testing'], preferredNameHints: ['test', 'qa'] },
      { key: 'security', label: 'Security', preferredDivisions: ['security'], preferredNameHints: ['security'] },
      { key: 'marketing', label: 'Marketing', preferredDivisions: ['marketing'], preferredNameHints: ['marketing'] },
      { key: 'app-store', label: 'App Store', preferredDivisions: ['marketing'], preferredNameHints: ['app-store'] },
    ],
  },
  {
    id: 'web-saas',
    projectType: 'saas',
    label: 'Web App / SaaS',
    roles: [
      { key: 'product', label: 'Product', preferredDivisions: ['product'], preferredNameHints: ['product'] },
      { key: 'ux', label: 'UX', preferredDivisions: ['design'], preferredNameHints: ['ux'] },
      { key: 'ui', label: 'UI', preferredDivisions: ['design'], preferredNameHints: ['ui'] },
      { key: 'frontend', label: 'Frontend', preferredDivisions: ['engineering'], preferredNameHints: ['frontend'] },
      { key: 'backend', label: 'Backend', preferredDivisions: ['engineering'], preferredNameHints: ['backend'] },
      { key: 'testing', label: 'Testing', preferredDivisions: ['testing'], preferredNameHints: ['test', 'qa'] },
      { key: 'security', label: 'Security', preferredDivisions: ['security'], preferredNameHints: ['security'] },
      { key: 'devops', label: 'DevOps', preferredDivisions: ['engineering'], preferredNameHints: ['devops'] },
      { key: 'marketing', label: 'Marketing', preferredDivisions: ['marketing'], preferredNameHints: ['marketing'] },
    ],
  },
]

export function getPresetForProjectType(type: ProjectType): TeamPreset | undefined {
  if (type === 'web-app' || type === 'website') {
    return TEAM_PRESETS.find((p) => p.id === 'web-saas')
  }
  return TEAM_PRESETS.find((p) => p.projectType === type)
}
