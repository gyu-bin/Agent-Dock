import type { KnowledgeItem, KnowledgeCategory } from '../persistence/knowledgeTypes.js'

export const KNOWLEDGE_CONTEXT_BUDGET = {
  maxItems: 5,
  excerptChars: 600,
  blockChars: 2400,
} as const

/**
 * Select confirmed knowledge only — never proposed/deprecated.
 * Prefer category match + keyword overlap with request/step.
 * Project isolation is caller's responsibility (pass project-scoped items only).
 */
export function selectRelevantKnowledge(input: {
  items: KnowledgeItem[]
  userRequest: string
  stepTask?: string
  preferredCategories?: KnowledgeCategory[]
  max?: number
}): { selected: KnowledgeItem[]; omitted: number } {
  const max = input.max ?? KNOWLEDGE_CONTEXT_BUDGET.maxItems
  const confirmed = input.items.filter((i) => i.status === 'confirmed')
  // Latest version per family only
  const latest = new Map<string, KnowledgeItem>()
  for (const it of confirmed) {
    const prev = latest.get(it.familyId)
    if (!prev || it.version > prev.version) latest.set(it.familyId, it)
  }
  const pool = [...latest.values()]
  const text = `${input.userRequest} ${input.stepTask ?? ''}`.toLowerCase()
  const preferred = new Set(input.preferredCategories ?? [])

  const scored = pool.map((item) => {
    let score = 1
    if (preferred.has(item.category)) score += 40
    const hay = `${item.title} ${item.content} ${item.category}`.toLowerCase()
    for (const token of text.split(/\s+/).filter((t) => t.length >= 2)) {
      if (hay.includes(token)) score += 3
    }
    // Light category keyword hints
    if (/디자인|design|ui|ux/.test(text) && item.category === 'design') score += 10
    if (/기술|tech|api|arch/.test(text) && item.category === 'technical')
      score += 10
    if (/게임|steam|game/.test(text) && item.category === 'game-design')
      score += 10
    if (/마케팅|market/.test(text) && item.category === 'marketing') score += 10
    if (/제약|constraint|하면 안|금지/.test(text) && item.category === 'constraint')
      score += 10
    if (/조사|research|트렌드/.test(text) && item.category === 'research')
      score += 10
    return { item, score }
  })

  scored.sort((a, b) => b.score - a.score || b.item.updatedAt.localeCompare(a.item.updatedAt))
  const selected = scored.slice(0, max).map((s) => s.item)
  return {
    selected,
    omitted: Math.max(0, pool.length - selected.length),
  }
}

export function formatKnowledgeExcerpts(items: KnowledgeItem[]): string {
  if (items.length === 0) return '(none)'
  return items
    .map((k) => {
      const body =
        k.content.length <= KNOWLEDGE_CONTEXT_BUDGET.excerptChars
          ? k.content
          : `${k.content.slice(0, KNOWLEDGE_CONTEXT_BUDGET.excerptChars - 1)}…`
      return `### ${k.title} (${k.category}, v${k.version}, id=${k.id})\n${body}`
    })
    .join('\n\n')
    .slice(0, KNOWLEDGE_CONTEXT_BUDGET.blockChars)
}

export function inferPreferredKnowledgeCategories(input: {
  userRequest: string
  stepTask?: string
  agentId?: string
}): KnowledgeCategory[] {
  const text = `${input.userRequest} ${input.stepTask ?? ''} ${input.agentId ?? ''}`.toLowerCase()
  const cats: KnowledgeCategory[] = []
  if (/game|steam|게임|코어/.test(text)) cats.push('game-design')
  if (/design|ui|ux|디자인/.test(text)) cats.push('design')
  if (/tech|api|arch|코드|구현|technical/.test(text)) cats.push('technical')
  if (/market|마케팅|출시/.test(text)) cats.push('marketing')
  if (/research|조사|트렌드/.test(text)) cats.push('research')
  if (/constraint|제약|금지|하면 안/.test(text)) cats.push('constraint')
  if (/product|요구|requirement|기획/.test(text)) {
    cats.push('product', 'requirement')
  }
  if (/decision|결정/.test(text)) cats.push('decision')
  if (/convention|규칙|스타일/.test(text)) cats.push('convention')
  return [...new Set(cats)]
}
