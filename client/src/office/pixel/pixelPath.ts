/**
 * 4-direction A* over the generated pixel-office walk grid.
 * Grid rows are strings of '0' (walkable) / '1' (blocked), one char per cell.
 */
export type Pt = { x: number; y: number }

export interface WalkGrid {
  cell: number
  cols: number
  rows: number
  grid: string[]
}

function blocked(g: WalkGrid, cx: number, cy: number): boolean {
  if (cx < 0 || cy < 0 || cx >= g.cols || cy >= g.rows) return true
  return g.grid[cy].charCodeAt(cx) === 49 // '1'
}

function cellOf(g: WalkGrid, p: Pt): [number, number] {
  return [
    Math.min(g.cols - 1, Math.max(0, Math.floor(p.x / g.cell))),
    Math.min(g.rows - 1, Math.max(0, Math.floor((p.y - 2) / g.cell))),
  ]
}

/** Nearest walkable cell (BFS ring search) — characters may stand on blocked seats. */
function nearestOpen(g: WalkGrid, cx: number, cy: number): [number, number] {
  if (!blocked(g, cx, cy)) return [cx, cy]
  for (let r = 1; r < 6; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue
        if (!blocked(g, cx + dx, cy + dy)) return [cx + dx, cy + dy]
      }
    }
  }
  return [cx, cy]
}

export function findPath(g: WalkGrid, from: Pt, to: Pt): Pt[] {
  const [sx, sy] = nearestOpen(g, ...cellOf(g, from))
  const [gx0, gy0] = cellOf(g, to)
  const [gx, gy] = nearestOpen(g, gx0, gy0)
  if (blocked(g, sx, sy) || blocked(g, gx, gy)) return []
  const key = (x: number, y: number) => y * g.cols + x
  const start = key(sx, sy)
  const goal = key(gx, gy)
  const came = new Map<number, number>()
  const gScore = new Map<number, number>([[start, 0]])
  // tiny binary heap on f-score
  const heap: Array<[number, number]> = [[0, start]]
  const push = (f: number, k: number) => {
    heap.push([f, k])
    let i = heap.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (heap[p][0] <= heap[i][0]) break
      ;[heap[p], heap[i]] = [heap[i], heap[p]]
      i = p
    }
  }
  const pop = (): [number, number] | undefined => {
    if (!heap.length) return undefined
    const top = heap[0]
    const last = heap.pop()!
    if (heap.length) {
      heap[0] = last
      let i = 0
      for (;;) {
        const l = i * 2 + 1
        const r = l + 1
        let m = i
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r
        if (m === i) break
        ;[heap[m], heap[i]] = [heap[i], heap[m]]
        i = m
      }
    }
    return top
  }
  let found = start === goal
  let guard = 0
  while (!found && guard++ < 6000) {
    const cur = pop()
    if (!cur) break
    const k = cur[1]
    if (k === goal) {
      found = true
      break
    }
    const cx = k % g.cols
    const cy = Math.floor(k / g.cols)
    const base = gScore.get(k) ?? 0
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = cx + dx
      const ny = cy + dy
      const nk = key(nx, ny)
      if (blocked(g, nx, ny) && nk !== goal) continue
      // small penalty for turning keeps paths in straight corridors
      const prev = came.get(k)
      const turn = prev !== undefined && (prev % g.cols === cx) !== (dx === 0) ? 0.3 : 0
      const tentative = base + 1 + turn
      if (tentative < (gScore.get(nk) ?? Infinity)) {
        gScore.set(nk, tentative)
        came.set(nk, k)
        push(tentative + Math.abs(nx - gx) + Math.abs(ny - gy), nk)
      }
    }
  }
  // A missing route must never turn into a straight walk through furniture/walls.
  if (!found) return []
  const cells: number[] = []
  for (let k: number | undefined = goal; k !== undefined && k !== start; k = came.get(k)) cells.push(k)
  cells.push(start)
  cells.reverse()
  const half = g.cell / 2
  const pts = cells.map((k) => ({ x: (k % g.cols) * g.cell + half, y: Math.floor(k / g.cols) * g.cell + half + 2 }))
  // drop collinear points
  const out: Pt[] = []
  for (let i = 0; i < pts.length; i++) {
    const a = out[out.length - 1]
    const b = pts[i]
    const c = pts[i + 1]
    if (a && c && ((a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y))) continue
    out.push(b)
  }
  out.push(to)
  return out
}
