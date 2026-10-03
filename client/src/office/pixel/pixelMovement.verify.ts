/** Run: node --import tsx client/src/office/pixel/pixelMovement.verify.ts */
import map from '../../../public/assets/pixel-office/office-map.json'
import manifest from '../../../public/assets/pixel-office/characters.json'
import { findPath } from './pixelPath'
import { advanceWalk, canWander, nextWanderRoute, wanderPause, wanderPoints, type Facing } from './pixelMovement'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

assert(canWander({ status: 'idle' }), 'unassigned idle staff should roam')
assert(canWander({ status: 'waiting' }), 'unassigned waiting staff should roam')
for (const status of ['working', 'reviewing', 'verifying', 'blocked', 'offline']) {
  assert(!canWander({ status }), `${status} must retain its real destination`)
}
assert(!canWander({ status: 'waiting', currentTaskId: 'approval-task' }), 'assigned waiting staff must not roam')

const disconnected = { cell: 8, cols: 3, rows: 3, grid: ['010', '111', '010'] }
assert(findPath(disconnected, { x: 4, y: 6 }, { x: 20, y: 22 }).length === 0, 'unreachable destination cannot fly through walls')
const points = wanderPoints(map)
assert(points.length > 20, 'connected leisure floor needs varied open destinations')
assert(points.some((p) => p.y < 304) && points.some((p) => p.y > 342), 'both lounge and garden must be included')
let frames = 0
let visitedGarden = false
let visitedLounge = false
for (const seed of [0, 31, 891, 0xffffffff]) {
  const runner = { pos: { ...points[0] }, path: [] as { x: number; y: number }[], facing: 'down' as Facing }
  for (let trip = 0; trip < 24; trip++) {
    const route = nextWanderRoute(map, points, runner.pos, seed, trip)
    assert(route, 'each leisure trip should have a walkable route')
    runner.path = route.path
    let steps = 0
    while (runner.path.length && steps++ < 3000) {
      const before = { ...runner.pos }
      advanceWalk(runner, 1 / 60, 54)
      assert(Math.hypot(runner.pos.x - before.x, runner.pos.y - before.y) <= 54 / 60 + 0.0001, 'speed must be bounded without teleports')
      assert(runner.pos.x > 0 && runner.pos.x < map.width && runner.pos.y > 0 && runner.pos.y < map.height, 'sprite must stay in map bounds')
      const cx = Math.floor(runner.pos.x / map.cell)
      const cy = Math.floor((runner.pos.y - 2) / map.cell)
      assert(map.grid[cy][cx] === '0', 'walking must not cross blocked furniture or walls')
      const anim = manifest.animations[`walk-${runner.facing}`]
      assert(anim && anim.frames === 4, 'each walking direction must have valid sprite frames')
      frames++
    }
    assert(steps < 3000, 'route must finish, never drift indefinitely')
    assert(Math.hypot(runner.pos.x - route.target.x, runner.pos.y - route.target.y) < 0.001, 'route stops exactly at destination')
    const resting = { ...runner.pos }
    advanceWalk(runner, 10, 54)
    assert(resting.x === runner.pos.x && resting.y === runner.pos.y, 'empty route remains still while resting')
    const pause = wanderPause(seed, trip)
    assert(pause >= 3000 && pause < 8000, 'rest periods stay within 3–8 seconds')
    visitedGarden ||= runner.pos.y > 342
    visitedLounge ||= runner.pos.y < 304
  }
}
assert(visitedGarden && visitedLounge, 'repeated trips should actually travel between lounge and garden')
console.log(`Pixel idle movement verified: 96 trips, ${frames} sampled frames, bounded speed, open-grid routes, rests, valid directional animations, task precedence, unreachable route safety.`)
