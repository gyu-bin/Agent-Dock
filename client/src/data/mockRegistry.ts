import type { Agent } from '../domain/types'
import { resolveDivision } from './divisionMap'

/** Fallback registry when local server / ~/.codex/agents is unavailable. */
const RAW: Array<{ id: string; name: string; description: string }> = [
  { id: 'agents-orchestrator', name: 'Agents Orchestrator', description: 'Autonomous pipeline manager that orchestrates the entire development workflow.' },
  { id: 'trend-researcher', name: 'Trend Researcher', description: 'Market intelligence, competitive analysis, and trend identification.' },
  { id: 'product-manager', name: 'Product Manager', description: 'Owns product strategy, roadmap, and prioritization.' },
  { id: 'feedback-synthesizer', name: 'Feedback Synthesizer', description: 'Turns user feedback into actionable product decisions.' },
  { id: 'game-designer', name: 'Game Designer', description: 'Systems and mechanics architect for gameplay loops.' },
  { id: 'level-designer', name: 'Level Designer', description: 'Designs playable spaces and progression pacing.' },
  { id: 'technical-artist', name: 'Technical Artist', description: 'Bridges art pipeline and engine tooling.' },
  { id: 'ui-designer', name: 'UI Designer', description: 'Visual design systems and pixel-perfect interfaces.' },
  { id: 'ux-researcher', name: 'UX Researcher', description: 'User behavior analysis and usability insights.' },
  { id: 'frontend-developer', name: 'Frontend Developer', description: 'Modern web UI implementation and performance.' },
  { id: 'backend-architect', name: 'Backend Architect', description: 'Scalable APIs and system architecture.' },
  { id: 'mobile-app-builder', name: 'Mobile App Builder', description: 'Native and cross-platform mobile engineering.' },
  { id: 'code-reviewer', name: 'Code Reviewer', description: 'Reviews implementations for quality and correctness.' },
  { id: 'reality-checker', name: 'Reality Checker', description: 'Evidence-based readiness certification.' },
  { id: 'api-tester', name: 'API Tester', description: 'API validation and performance testing.' },
  { id: 'content-creator', name: 'Content Creator', description: 'Multi-platform campaigns and storytelling.' },
  { id: 'app-store-optimizer', name: 'App Store Optimizer', description: 'ASO and store conversion optimization.' },
  { id: 'growth-hacker', name: 'Growth Hacker', description: 'Rapid acquisition through experimentation.' },
  { id: 'account-strategist', name: 'Account Strategist', description: 'Strategic account planning and positioning.' },
  { id: 'devops-automator', name: 'DevOps Automator', description: 'CI/CD and infrastructure automation.' },
  { id: 'sprint-prioritizer', name: 'Sprint Prioritizer', description: 'Agile planning and feature prioritization.' },
  { id: 'narrative-designer', name: 'Narrative Designer', description: 'Story systems and player-facing writing.' },
  { id: 'studio-producer', name: 'Studio Producer', description: 'Multi-project portfolio coordination.' },
  { id: 'research-synthesist', name: 'Research Synthesist', description: 'Literature review and evidence synthesis.' },
  { id: 'application-security-engineer', name: 'Application Security Engineer', description: 'Threat modeling and secure delivery.' },
]

export const MOCK_REGISTRY: Agent[] = RAW.map((r) => ({
  id: r.id,
  name: r.name,
  division: resolveDivision(r.id),
  description: r.description,
  status: 'idle' as const,
  enabled: true,
}))

export const MOCK_REGISTRY_COUNT = 279
