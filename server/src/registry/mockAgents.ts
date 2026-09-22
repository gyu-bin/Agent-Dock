import type { DivisionId } from '../types.js'
import fallbackMap from './agencyDivisionMap.json' with { type: 'json' }
import { resolveDivision } from './divisionMap.js'

const RAW: Array<{ id: string; name: string; description: string }> = [
  { id: 'agents-orchestrator', name: 'Agents Orchestrator', description: 'Autonomous pipeline manager.' },
  { id: 'trend-researcher', name: 'Trend Researcher', description: 'Market intelligence and trends.' },
  { id: 'product-manager', name: 'Product Manager', description: 'Product strategy and roadmap.' },
  { id: 'feedback-synthesizer', name: 'Feedback Synthesizer', description: 'Turns feedback into product decisions.' },
  { id: 'game-designer', name: 'Game Designer', description: 'Gameplay systems architect.' },
  { id: 'level-designer', name: 'Level Designer', description: 'Playable spaces and pacing.' },
  { id: 'technical-artist', name: 'Technical Artist', description: 'Art pipeline and tooling.' },
  { id: 'ui-designer', name: 'UI Designer', description: 'Visual design systems.' },
  { id: 'ux-researcher', name: 'UX Researcher', description: 'Usability insights.' },
  { id: 'frontend-developer', name: 'Frontend Developer', description: 'Modern web UI.' },
  { id: 'backend-architect', name: 'Backend Architect', description: 'APIs and architecture.' },
  { id: 'mobile-app-builder', name: 'Mobile App Builder', description: 'Mobile engineering.' },
  { id: 'code-reviewer', name: 'Code Reviewer', description: 'Code quality review.' },
  { id: 'reality-checker', name: 'Reality Checker', description: 'Readiness certification.' },
  { id: 'api-tester', name: 'API Tester', description: 'API validation.' },
  { id: 'content-creator', name: 'Content Creator', description: 'Campaigns and storytelling.' },
  { id: 'app-store-optimizer', name: 'App Store Optimizer', description: 'ASO optimization.' },
  { id: 'growth-hacker', name: 'Growth Hacker', description: 'Acquisition experiments.' },
  { id: 'account-strategist', name: 'Account Strategist', description: 'Account planning.' },
  { id: 'devops-automator', name: 'DevOps Automator', description: 'CI/CD automation.' },
  { id: 'sprint-prioritizer', name: 'Sprint Prioritizer', description: 'Sprint planning.' },
  { id: 'narrative-designer', name: 'Narrative Designer', description: 'Story systems.' },
  { id: 'studio-producer', name: 'Studio Producer', description: 'Portfolio coordination.' },
  { id: 'research-synthesist', name: 'Research Synthesist', description: 'Evidence synthesis.' },
  { id: 'application-security-engineer', name: 'Application Security Engineer', description: 'Secure delivery.' },
]

const FALLBACK = fallbackMap.slugToDivision as Record<string, DivisionId>

export function getMockRegistry() {
  return RAW.map((r) => ({
    id: r.id,
    name: r.name,
    division: resolveDivision(r.id, FALLBACK),
    description: r.description,
    status: 'idle' as const,
    enabled: true as const,
  }))
}

export const MOCK_TOTAL_HINT = 279
