import type { ProjectType } from '../types'
import type { AgentCapability } from './capabilityTypes'

/** Derived project capability needs — does not replace Team Presets. */
export function capabilityNeedsForProjectType(
  type: ProjectType | undefined,
): AgentCapability[] {
  switch (type) {
    case 'mobile-app':
    case 'web-app':
    case 'saas':
    case 'website':
      return [
        'project.plan',
        'design.ui',
        'code.inspect',
        'code.write',
        'code.test',
        'qa.verify',
      ]
    case 'steam-game':
    case 'mobile-game':
      return [
        'project.plan',
        'research.web',
        'code.write',
        'qa.test',
        'marketing.plan',
      ]
    case 'custom':
    default:
      return ['project.plan', 'document.write', 'code.inspect']
  }
}
