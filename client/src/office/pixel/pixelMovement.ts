import { findPath, type Pt, type WalkGrid } from './pixelPath'

export type Facing = 'up' | 'down' | 'left' | 'right'

export function canWander(agent: { status: string; currentTaskId?: string }): boolean {
  return (agent.status === 'idle' || agent.status === 'waiting') && !agent.currentTaskId
}

/** Open cell centres in the connected lounge/garden, away from room entrances. */
export function wanderPoints(grid: WalkGrid): Pt[] {
  const points: Pt[] = []
  for (let cy = 0; cy < grid.rows; cy += 3) {
    for (let cx = 0; cx < grid.cols; cx += 3) {
      const x = cx * grid.cell + grid.cell / 2
      const y = cy * grid.cell + grid.cell / 2 + 2
      const inLounge = x >= 216 && x <= 552 && y >= 202 && y <= 304
      const inGarden = x >= 280 && x <= 736 && y >= 342 && y <= 450
      if ((inLounge || inGarden) && grid.grid[cy]?.[cx] === '0') points.push({ x, y })
    }
  }
  return points
}

export function nextWanderRoute(grid: WalkGrid, points: Pt[], from: Pt, seed: number, trip: number): { target: Pt; path: Pt[] } | null {
  if (!points.length) return null
  const start = ((seed >>> 0) + Math.imul(trip + 1, 2654435761)) >>> 0
  for (let i = 0; i < points.length; i++) {
    const target = points[(start + i) % points.length]
    if (Math.hypot(target.x - from.x, target.y - from.y) < 48) continue
    const path = findPath(grid, from, target)
    if (path.length) return { target, path }
  }
  return null
}

/** Mutates map coordinates only; sprite frames cannot change world position. */
export function advanceWalk(runner: { pos: Pt; path: Pt[]; facing: Facing }, seconds: number, speed: number): boolean {
  let budget = speed * Math.max(0, Math.min(seconds, 0.05))
  while (budget > 0 && runner.path.length) {
    const wp = runner.path[0]
    const dx = wp.x - runner.pos.x
    const dy = wp.y - runner.pos.y
    const distance = Math.hypot(dx, dy)
    if (distance > 0.01) runner.facing = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'down'
    if (distance <= budget) {
      runner.pos = { ...wp }
      runner.path.shift()
      budget -= distance
    } else {
      runner.pos = { x: runner.pos.x + dx / distance * budget, y: runner.pos.y + dy / distance * budget }
      budget = 0
    }
  }
  return runner.path.length === 0
}

export function wanderPause(seed: number, trip: number): number {
  return 3000 + (((seed >>> 0) + trip * 997) % 5000)
}
