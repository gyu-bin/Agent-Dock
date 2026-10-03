/** Run: node --import tsx tools/agent-instruction-client-fixture.mts */
import assert from 'node:assert/strict'
import { executionFailure } from '../client/src/domain/executionFailure.ts'
import { isWebSearchError, userFacingErrorMessage } from '../client/src/domain/taskDisplay.ts'
import { matchAgentForRole } from '../client/src/domain/templateSelector.ts'
import { planTask } from '../client/src/domain/taskPlanning/canonicalTaskPlanner.ts'
import type { Agent } from '../client/src/domain/types.ts'

const instructionMessage = '담당 에이전트의 실행 지침을 불러오지 못했습니다.'
const raw = 'Agent instructions not found for "research-synthesist"'
assert.equal(userFacingErrorMessage(raw), instructionMessage)
assert.equal(isWebSearchError(undefined, raw), false)
for (const code of ['AGENT_INSTRUCTION_FILE_NOT_FOUND', 'AGENT_INSTRUCTION_READ_FAILED', 'AGENT_INSTRUCTION_PARSE_FAILED', 'AGENT_INSTRUCTION_MISSING_FIELD', 'AGENT_SOURCE_UNAVAILABLE']) {
  assert.equal(userFacingErrorMessage('research-synthesist path error', code), instructionMessage)
  assert.equal(isWebSearchError(code, '웹 검색 실패'), false)
}
console.log('PASS F legacy research name and all instruction codes stay out of search classification')
for (const code of ['WEB_SEARCH_PROVIDER_FAILED', 'WEB_SEARCH_FAILED', 'SEARCH_PROVIDER_UNAVAILABLE']) {
  assert.equal(userFacingErrorMessage('provider failure', code), '웹 검색을 완료하지 못했습니다.')
}
assert.equal(isWebSearchError(undefined, 'search-index missing'), false)
assert.equal(isWebSearchError(undefined, '웹 검색 실패'), true)
console.log('PASS G structured search codes and narrow legacy search message')
const error = Object.assign(new Error(raw), { code: 'AGENT_INSTRUCTION_FILE_NOT_FOUND', userMessage: instructionMessage, technicalSummary: 'agentId=research-synthesist; path=/fixture/research-synthesist.toml' })
const failure = executionFailure(error)
const saved = JSON.stringify({ task: { ...failure, status: 'blocked' }, step: { ...failure, status: 'failed' }, run: { ...failure, status: 'failed', error: raw } })
const reloaded = JSON.parse(saved)
for (const item of [reloaded.task, reloaded.step, reloaded.run]) {
  assert.deepEqual(executionFailure(item), failure)
  assert.equal(userFacingErrorMessage(item.technicalSummary, item.errorCode, item.userMessage), instructionMessage)
}
console.log('PASS H task/step/run persisted metadata preserves classification after reload')
const mock: Agent = { id: 'research-synthesist', name: 'Research Synthesist', division: 'research', description: 'Research analysis', status: 'idle', enabled: true, executable: false, instructionAvailable: false }
assert.equal(matchAgentForRole({ role: 'research', team: [mock], registry: [mock], usedIds: new Set() }), null)
const input = { project: { id: 'fixture', type: 'web-app' as const, name: 'fixture' }, request: '현재 앱 시장 분석해봐', team: [mock], registry: [mock], source: { type: 'user' as const } }
const real = planTask({ ...input, executionMode: 'REAL_AI' })
assert.ok(!real.steps.some((step) => step.agentId === mock.id))
const explicitMock = planTask({ ...input, executionMode: 'MOCK' })
assert.ok(explicitMock.steps.some((step) => step.agentId === mock.id))
console.log('PASS I display-only assignment excluded in real planning; explicit mock remains available')
