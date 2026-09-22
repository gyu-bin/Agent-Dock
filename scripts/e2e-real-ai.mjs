const API = 'http://127.0.0.1:8787'
const request = '새로운 Steam 게임 아이디어 하나를 간단히 분석해줘'
const report = {
  errors: [],
  model: null,
  routePlan: null,
  agents: [],
  openaiApiCalls: 0,
  tokens: { input: 0, output: 0 },
  agentRunsSaved: 0,
  finalResultLen: 0,
  taskStatus: null,
  officeIdle: null,
  provider: null,
  fixes: [],
}

function addUsage(u) {
  if (!u) return
  report.tokens.input += u.inputTokens ?? 0
  report.tokens.output += u.outputTokens ?? 0
  if (u.model) report.model = u.model
}

async function get(path) {
  const res = await fetch(API + path)
  const text = await res.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    data = { raw: text.slice(0, 400) }
  }
  if (!res.ok) throw new Error(`GET ${path} ${res.status}: ${JSON.stringify(data).slice(0, 300)}`)
  return data
}

async function post(path, body, { countOpenAi = false } = {}) {
  if (countOpenAi) report.openaiApiCalls++
  const res = await fetch(API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    data = { raw: text.slice(0, 400) }
  }
  if (!res.ok) throw new Error(`POST ${path} ${res.status}: ${JSON.stringify(data).slice(0, 400)}`)
  return data
}

async function put(path, body) {
  const res = await fetch(API + path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    data = { raw: text.slice(0, 400) }
  }
  if (!res.ok) throw new Error(`PUT ${path} ${res.status}: ${JSON.stringify(data).slice(0, 400)}`)
  return data
}

try {
  const provider = await get('/api/provider')
  report.provider = {
    configured: provider.configured,
    model: provider.model,
    label: provider.label,
  }
  if (!provider.configured) throw new Error('Provider not configured')
  report.model = provider.model

  const projectsSnap = await get('/api/projects')
  const project =
    (projectsSnap.projects || []).find((p) => p.id === projectsSnap.activeProjectId) ||
    (projectsSnap.projects || [])[0]
  if (!project) throw new Error('No project available')

  const team = project.agentIds?.length
    ? project.agentIds
    : [
        'trend-researcher',
        'game-designer',
        'reality-checker',
        'level-designer',
        'product-manager',
      ]

  const orch = await post(
    '/api/ai/orchestrate',
    {
      userRequest: request,
      projectType: project.type || 'steam-game',
      projectName: project.name,
      teamAgentIds: team,
    },
    { countOpenAi: true },
  )
  report.routePlan = orch.plan
  addUsage(orch.usage)

  const now = new Date().toISOString()
  const taskId = `task_e2e_${Date.now().toString(36)}`
  const steps = orch.plan.steps.map((s, i) => ({
    id: `${taskId}_step_${i + 1}`,
    taskId,
    agentId: s.agentId,
    order: i + 1,
    label: s.task,
    status: 'queued',
  }))
  let task = {
    id: taskId,
    projectId: project.id,
    title: request,
    description: request,
    status: 'running',
    workflow: orch.plan.workflow,
    priority: 'normal',
    assignedAgentIds: orch.plan.steps.map((s) => s.agentId),
    recommendedExtraAgentIds: [],
    progress: 0,
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    executionMode: 'REAL_AI',
  }

  const agentRuns = []
  const agentRuntime = {}
  for (const a of orch.plan.steps) agentRuntime[a.agentId] = { status: 'idle' }

  await put('/api/work-state', {
    recover: false,
    tasks: [task, ...(projectsSnap.tasks || []).filter((t) => t.id !== taskId)],
    pipelineSteps: [
      ...steps,
      ...(projectsSnap.pipelineSteps || []).filter((s) => s.taskId !== taskId),
    ],
    agentRuns: [...(projectsSnap.agentRuns || [])],
  })
  report.fixes.push('work persist path: /api/work-state')

  let previous = undefined
  const stepOutputs = []

  for (const step of steps) {
    agentRuntime[step.agentId] = {
      status: step.order === steps.length && steps.length > 1 ? 'reviewing' : 'working',
      currentTaskId: taskId,
      currentTaskLabel: step.label,
      speech: `${step.label}…`,
    }
    step.status = agentRuntime[step.agentId].status === 'reviewing' ? 'reviewing' : 'running'
    step.startedAt = new Date().toISOString()

    const runId = `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
    const runStarted = new Date().toISOString()
    let run = {
      id: runId,
      taskId,
      stepId: step.id,
      agentId: step.agentId,
      status: 'running',
      inputSummary: step.label,
      output: '',
      startedAt: runStarted,
    }
    agentRuns.push(run)

    const result = await post(
      '/api/ai/run-step',
      {
        agentId: step.agentId,
        stepTask: step.label,
        userRequest: request,
        projectType: project.type || 'steam-game',
        projectName: project.name,
        previousResult: previous,
      },
      { countOpenAi: true },
    )

    previous = result.output
    const completedAt = new Date().toISOString()
    step.status = 'completed'
    step.completedAt = completedAt
    run = {
      ...run,
      status: 'completed',
      output: result.output,
      inputSummary: result.inputSummary,
      completedAt,
      model: result.usage?.model,
      inputTokens: result.usage?.inputTokens ?? 0,
      outputTokens: result.usage?.outputTokens ?? 0,
    }
    agentRuns[agentRuns.findIndex((r) => r.id === runId)] = run
    addUsage(result.usage)
    report.agents.push(step.agentId)
    stepOutputs.push({
      agentId: step.agentId,
      agentName: step.agentId,
      task: step.label,
      output: result.output,
    })

    agentRuntime[step.agentId] = {
      status: 'idle',
      speech: '완료!',
      currentTaskId: undefined,
      currentTaskLabel: undefined,
    }
    task.progress = Math.round(
      (steps.filter((s) => s.status === 'completed').length / steps.length) * 100,
    )
    task.updatedAt = completedAt
  }

  const synth = await post(
    '/api/ai/synthesize',
    {
      userRequest: request,
      workflow: orch.plan.workflow,
      stepOutputs,
    },
    { countOpenAi: true },
  )
  addUsage(synth.usage)

  const doneAt = new Date().toISOString()
  task = {
    ...task,
    status: 'completed',
    progress: 100,
    updatedAt: doneAt,
    completedAt: doneAt,
    finalResult: synth.output,
  }
  report.finalResultLen = synth.output?.length ?? 0

  for (const a of orch.plan.steps) {
    agentRuntime[a.agentId] = {
      status: 'idle',
      currentTaskId: undefined,
      currentTaskLabel: undefined,
      speech: undefined,
    }
  }

  const before = await get('/api/projects')
  await put('/api/work-state', {
    recover: false,
    tasks: [task, ...(before.tasks || []).filter((t) => t.id !== taskId)],
    pipelineSteps: [
      ...steps,
      ...(before.pipelineSteps || []).filter((s) => s.taskId !== taskId),
    ],
    agentRuns: [
      ...agentRuns,
      ...(before.agentRuns || []).filter((r) => r.taskId !== taskId),
    ],
  })

  const after = await get('/api/projects')
  const savedTask = (after.tasks || []).find((t) => t.id === taskId)
  const savedRuns = (after.agentRuns || []).filter((r) => r.taskId === taskId)
  report.taskStatus = savedTask?.status ?? null
  report.agentRunsSaved = savedRuns.length
  report.savedRunStatuses = savedRuns.map((r) => ({
    agentId: r.agentId,
    status: r.status,
    model: r.model,
    in: r.inputTokens,
    out: r.outputTokens,
  }))
  report.hasFinalResult = Boolean(savedTask?.finalResult && savedTask.finalResult.length > 0)
  report.officeIdle = Object.values(agentRuntime).every(
    (r) => r.status === 'idle' && !r.currentTaskId,
  )
  report.pipelineSteps = steps.map((s) => ({ agentId: s.agentId, status: s.status }))

  if (report.taskStatus !== 'completed') report.errors.push('task not completed')
  if (!report.hasFinalResult) report.errors.push('finalResult missing')
  if (report.agentRunsSaved !== steps.length) {
    report.errors.push(`agentRuns count ${report.agentRunsSaved} != ${steps.length}`)
  }
  if (!report.officeIdle) report.errors.push('office not idle')
  if (savedRuns.some((r) => r.status !== 'completed')) {
    report.errors.push('some agentRuns not completed')
  }
} catch (e) {
  report.errors.push(String(e.message || e))
}

console.log(JSON.stringify(report, null, 2))
