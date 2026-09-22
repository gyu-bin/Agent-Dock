import { DEPARTMENTS, getDepartment } from '../domain/departments'
import type { Agent, DivisionId } from '../domain/types'

export interface AgentDeptGroup {
  division: DivisionId
  label: string
  color: string
  agents: Agent[]
}

/** Group agents by department, ordered by DEPARTMENTS priority then label. */
export function groupAgentsByDepartment(agents: Agent[]): AgentDeptGroup[] {
  const buckets = new Map<DivisionId, Agent[]>()
  for (const a of agents) {
    const list = buckets.get(a.division)
    if (list) list.push(a)
    else buckets.set(a.division, [a])
  }

  const order = new Map(DEPARTMENTS.map((d, i) => [d.id, i]))
  const ids = [...buckets.keys()].sort((a, b) => {
    const ai = order.get(a) ?? 999
    const bi = order.get(b) ?? 999
    if (ai !== bi) return ai - bi
    return getDepartment(a).label.localeCompare(getDepartment(b).label, 'ko')
  })

  return ids.map((division) => {
    const dept = getDepartment(division)
    const list = buckets.get(division) ?? []
    list.sort((a, b) => a.name.localeCompare(b.name, 'en'))
    return {
      division,
      label: dept.label,
      color: dept.color,
      agents: list,
    }
  })
}
