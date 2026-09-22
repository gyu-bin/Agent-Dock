/**
 * Fixture checks for officeAssignmentPolicy.
 * Run: npx tsx client/src/office/v2/officeAssignmentPolicy.verify.ts
 */
import type { Agent, AgentStatus, DivisionId } from '../../domain/types'
import {
  assignOfficeDestinations,
  assignmentForAgent,
  destinationTypeForStatus,
  LOUNGE_WAYPOINTS,
  MEETING_SEATS,
  TESTING_DESKS,
} from './officeAssignmentPolicy'

function agent(
  id: string,
  status: AgentStatus,
  division: DivisionId = 'engineering',
): Agent {
  return {
    id,
    name: id,
    division,
    description: '',
    status,
    enabled: true,
  }
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg)
}

function eq<T>(a: T, b: T, msg: string) {
  assert(a === b, `${msg}: expected ${String(b)}, got ${String(a)}`)
}

// --- Status → destination ---
eq(destinationTypeForStatus('idle'), 'lounge', 'idle')
eq(destinationTypeForStatus('waiting'), 'lounge', 'waiting')
eq(destinationTypeForStatus('working'), 'workstation', 'working')
eq(destinationTypeForStatus('blocked'), 'workstation', 'blocked')
eq(destinationTypeForStatus('reviewing'), 'meeting', 'reviewing')
eq(destinationTypeForStatus('verifying'), 'testing', 'verifying')
eq(destinationTypeForStatus('offline'), 'reception', 'offline default')
eq(
  destinationTypeForStatus('offline', 'hidden'),
  'hidden',
  'offline hidden',
)

const mixed = [
  agent('a-idle', 'idle'),
  agent('a-wait', 'waiting'),
  agent('a-work', 'working', 'engineering'),
  agent('a-block', 'blocked', 'design'),
  agent('a-rev', 'reviewing'),
  agent('a-ver', 'verifying', 'testing'),
  agent('a-off', 'offline'),
]

const r1 = assignOfficeDestinations(mixed)
const by = (id: string) => {
  const a = assignmentForAgent(r1, id)
  assert(a, `missing ${id}`)
  return a
}

eq(by('a-idle').destinationType, 'lounge', 'idle dest')
assert(by('a-idle').waypointId?.startsWith('lounge.'), 'idle lounge wp')
eq(by('a-wait').destinationType, 'lounge', 'waiting dest')
eq(by('a-work').destinationType, 'workstation', 'working dest')
eq(by('a-work').workstationGroup, 'development', 'working group')
assert(by('a-work').waypointId, 'working waypoint')
eq(by('a-block').destinationType, 'workstation', 'blocked dest')
eq(by('a-block').workstationGroup, 'design', 'blocked group')
eq(by('a-rev').destinationType, 'meeting', 'reviewing dest')
assert(by('a-rev').waypointId?.startsWith('meeting.seat.'), 'meeting seat')
eq(by('a-ver').destinationType, 'testing', 'verifying dest')
assert(by('a-ver').waypointId?.startsWith('testing.desk.'), 'testing desk')
eq(by('a-off').destinationType, 'reception', 'offline dest')
eq(by('a-off').waypointId, 'reception.spawn', 'offline spawn')

const rHidden = assignOfficeDestinations([agent('a-off2', 'offline')], {
  offlineMode: 'hidden',
})
{
  const hidden = assignmentForAgent(rHidden, 'a-off2')
  assert(hidden, 'missing a-off2')
  eq(hidden.destinationType, 'hidden', 'hidden dest')
  assert(!hidden.waypointId, 'hidden has no waypoint')
}

// --- Determinism ---
const r2 = assignOfficeDestinations(mixed)
assert(
  JSON.stringify(r1.assignments) === JSON.stringify(r2.assignments),
  'deterministic same input',
)

// --- Capacity overflow (meeting) ---
const reviewers = Array.from({ length: MEETING_SEATS.length + 2 }, (_, i) =>
  agent(`rev-${String(i).padStart(2, '0')}`, 'reviewing'),
)
const meet = assignOfficeDestinations(reviewers)
const meetOverflow = meet.assignments.filter((a) => a.overflow)
eq(meetOverflow.length, 2, 'meeting overflow count')
eq(meet.overflowByDestination.meeting?.length, 2, 'overflowByDestination')

// --- Capacity overflow (testing) ---
const verifiers = Array.from({ length: TESTING_DESKS.length + 1 }, (_, i) =>
  agent(`ver-${i}`, 'verifying', 'testing'),
)
const testR = assignOfficeDestinations(verifiers)
eq(
  testR.assignments.filter((a) => a.overflow).length,
  1,
  'testing overflow',
)

// --- Lounge capacity ---
const loungeCrowd = Array.from(
  { length: LOUNGE_WAYPOINTS.length + 3 },
  (_, i) => agent(`lg-${String(i).padStart(2, '0')}`, 'idle'),
)
const loungeR = assignOfficeDestinations(loungeCrowd)
eq(
  loungeR.assignments.filter((a) => a.overflow).length,
  3,
  'lounge overflow',
)

// --- Desk overflow (development cap 4) ---
const workers = Array.from({ length: 6 }, (_, i) =>
  agent(`dev-${i}`, 'working', 'engineering'),
)
const deskR = assignOfficeDestinations(workers)
eq(
  deskR.assignments.filter((a) => a.overflow).length,
  2,
  'workstation overflow',
)

console.log('officeAssignmentPolicy fixtures: PASS')
