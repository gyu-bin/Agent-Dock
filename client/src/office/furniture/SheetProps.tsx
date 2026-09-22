/**
 * Agent Deck Office furniture — cozy ¾ top-down 2D props.
 * Illustrated reusable assets (not CSS circles/rects toys).
 * Palette aligned with office reference + Pilot chibi scale.
 */

const INK = '#2d3748'
const WOOD = '#d4a574'
const WOOD_DK = '#b8875a'
const WOOD_LT = '#e8c9a0'
const SHADOW = 'rgba(45,55,72,0.14)'

type XY = { x?: number; y?: number }

function Sh({ cx, cy, rx, ry }: { cx: number; cy: number; rx: number; ry: number }) {
  return <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={SHADOW} />
}

/** Soft leaf cluster — organic path, not stacked ellipses alone */
function LeafCluster({
  cx,
  cy,
  scale = 1,
  tone = '#4ade80',
}: {
  cx: number
  cy: number
  scale?: number
  tone?: string
}) {
  return (
    <g transform={`translate(${cx} ${cy}) scale(${scale})`}>
      <path
        d="M0 -18 C10 -16 16 -8 14 0 C8 10 2 14 0 18 C-2 14 -8 10 -14 0 C-16 -8 -10 -16 0 -18Z"
        fill={tone}
        stroke={INK}
        strokeWidth={1.4 / scale}
      />
      <path
        d="M-8 -6 C-2 -14 8 -12 10 -2"
        fill="none"
        stroke="#166534"
        strokeWidth={0.9 / scale}
        opacity={0.35}
      />
    </g>
  )
}

export function DeskBasic({ x = 0, y = 0 }: XY) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <Sh cx={44} cy={50} rx={40} ry={6} />
      {/* desk body ¾ */}
      <path
        d="M6 28 L82 28 L86 44 L10 44 Z"
        fill={WOOD}
        stroke={INK}
        strokeWidth={1.7}
      />
      <path d="M10 44 L86 44 L84 52 L12 52 Z" fill={WOOD_DK} stroke={INK} strokeWidth={1.4} />
      <path d="M6 28 L10 44 L12 52 L8 36 Z" fill={WOOD_LT} stroke={INK} strokeWidth={1.2} />
      <rect x={14} y={46} width={6} height={10} rx={1} fill={WOOD_DK} stroke={INK} strokeWidth={1} />
      <rect x={72} y={46} width={6} height={10} rx={1} fill={WOOD_DK} stroke={INK} strokeWidth={1} />
      <MonitorUnit x={30} y={4} tint="#7dd3fc" />
      {/* keyboard */}
      <rect x={28} y={36} width={28} height={6} rx={1.5} fill="#e2e8f0" stroke={INK} strokeWidth={1} />
      <ellipse cx={62} cy={39} rx={3} ry={2} fill="#cbd5e1" stroke={INK} strokeWidth={0.8} />
    </g>
  )
}

export function DeskDual({ x = 0, y = 0, game }: XY & { game?: boolean }) {
  const tint = game ? '#86efac' : '#7dd3fc'
  return (
    <g transform={`translate(${x} ${y})`}>
      <Sh cx={52} cy={54} rx={48} ry={6} />
      <path d="M4 30 L96 30 L100 48 L8 48 Z" fill={WOOD} stroke={INK} strokeWidth={1.7} />
      <path d="M8 48 L100 48 L98 56 L10 56 Z" fill={WOOD_DK} stroke={INK} strokeWidth={1.4} />
      <rect x={12} y={50} width={6} height={10} rx={1} fill={WOOD_DK} stroke={INK} strokeWidth={1} />
      <rect x={88} y={50} width={6} height={10} rx={1} fill={WOOD_DK} stroke={INK} strokeWidth={1} />
      <MonitorUnit x={14} y={4} tint={tint} />
      <MonitorUnit x={52} y={4} tint={tint} />
      <rect x={30} y={38} width={34} height={7} rx={1.5} fill="#e2e8f0" stroke={INK} strokeWidth={1} />
      {game ? (
        <g transform="translate(78 36)">
          <rect width={18} height={11} rx={4} fill="#1e293b" stroke={INK} strokeWidth={1.2} />
          <circle cx={5} cy={5.5} r={1.7} fill="#34d399" />
          <circle cx={13} cy={5.5} r={1.7} fill="#f87171" />
        </g>
      ) : null}
    </g>
  )
}

export function DeskLarge({ x = 0, y = 0 }: XY) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <Sh cx={52} cy={56} rx={50} ry={6} />
      <path d="M4 34 L100 34 L104 52 L8 52 Z" fill={WOOD} stroke={INK} strokeWidth={1.7} />
      <path d="M8 52 L104 52 L102 60 L10 60 Z" fill={WOOD_DK} stroke={INK} strokeWidth={1.4} />
      {/* wide design display */}
      <rect x={22} y={2} width={56} height={34} rx={4} fill="#1e293b" stroke={INK} strokeWidth={1.7} />
      <rect x={26} y={6} width={48} height={24} rx={2} fill="#fda4af" />
      <rect x={26} y={6} width={48} height={5} fill="#fff" opacity={0.25} />
      <path d="M44 36 L48 42 L56 42 L52 36 Z" fill="#475569" stroke={INK} strokeWidth={1} />
      <rect x={8} y={40} width={18} height={12} rx={2} fill="#64748b" stroke={INK} strokeWidth={1.2} transform="rotate(-10 17 46)" />
    </g>
  )
}

function MonitorUnit({ x, y, tint }: { x: number; y: number; tint: string }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect width={30} height={22} rx={3} fill="#1e293b" stroke={INK} strokeWidth={1.5} />
      <rect x={2.5} y={2.5} width={25} height={15} rx={1.5} fill={tint} />
      <rect x={2.5} y={2.5} width={25} height={3.5} fill="#fff" opacity={0.22} />
      {/* code-ish lines */}
      <rect x={5} y={8} width={14} height={1.4} rx={0.5} fill="#0f172a" opacity={0.25} />
      <rect x={5} y={11} width={10} height={1.4} rx={0.5} fill="#0f172a" opacity={0.2} />
      <rect x={5} y={14} width={16} height={1.4} rx={0.5} fill="#0f172a" opacity={0.18} />
      <path d="M12 22 L15 28 L19 28 L16 22 Z" fill="#475569" stroke={INK} strokeWidth={1} />
      <rect x={8} y={28} width={16} height={2.5} rx={1} fill="#334155" stroke={INK} strokeWidth={0.8} />
    </g>
  )
}

export function Chair({ x = 0, y = 0, gaming }: XY & { gaming?: boolean }) {
  const seat = gaming ? '#3b82f6' : '#60a5fa'
  const back = gaming ? '#1d4ed8' : '#93c5fd'
  return (
    <g transform={`translate(${x} ${y})`}>
      <Sh cx={16} cy={36} rx={13} ry={3.5} />
      {/* seat ¾ */}
      <path
        d="M4 16 L28 16 L30 28 L6 28 Z"
        fill={seat}
        stroke={INK}
        strokeWidth={1.5}
      />
      <path d="M6 28 L30 28 L28 32 L8 32 Z" fill={back} stroke={INK} strokeWidth={1.2} />
      {/* backrest */}
      <path
        d="M7 4 L25 4 Q28 4 28 8 L28 18 L6 18 L6 8 Q6 4 7 4Z"
        fill={back}
        stroke={INK}
        strokeWidth={1.4}
      />
      {gaming ? (
        <>
          <path d="M2 16 L6 16 L6 26 L2 24 Z" fill="#1e293b" stroke={INK} strokeWidth={1} />
          <path d="M28 16 L32 16 L32 24 L28 26 Z" fill="#1e293b" stroke={INK} strokeWidth={1} />
        </>
      ) : (
        <>
          <path d="M3 18 L6 18 L6 26 L3 24 Z" fill="#64748b" stroke={INK} strokeWidth={0.9} />
          <path d="M28 18 L31 18 L31 24 L28 26 Z" fill="#64748b" stroke={INK} strokeWidth={0.9} />
        </>
      )}
      <rect x={14} y={30} width={4} height={8} fill="#334155" stroke={INK} strokeWidth={0.8} />
      <ellipse cx={16} cy={38} rx={7} ry={2} fill="#475569" stroke={INK} strokeWidth={0.8} />
    </g>
  )
}

export function Bookshelf({ x = 0, y = 0 }: XY) {
  const books = [
    { x: 6, c: '#f87171', w: 7 },
    { x: 14, c: '#60a5fa', w: 8 },
    { x: 23, c: '#34d399', w: 7 },
    { x: 31, c: '#fbbf24', w: 6 },
  ]
  const books2 = [
    { x: 6, c: '#a78bfa', w: 8 },
    { x: 15, c: '#fb7185', w: 7 },
    { x: 23, c: '#38bdf8', w: 9 },
  ]
  return (
    <g transform={`translate(${x} ${y})`}>
      <Sh cx={22} cy={64} rx={18} ry={3.5} />
      <path d="M2 4 L42 4 L42 60 L2 60 Z" fill={WOOD_DK} stroke={INK} strokeWidth={1.7} />
      <path d="M4 6 L40 6 L40 8 L4 8 Z" fill={WOOD} />
      <path d="M4 28 L40 28 L40 30 L4 30 Z" fill={WOOD} />
      <path d="M4 50 L40 50 L40 52 L4 52 Z" fill={WOOD} />
      {books.map((b) => (
        <rect
          key={`t${b.x}`}
          x={b.x}
          y={10}
          width={b.w}
          height={16}
          rx={1}
          fill={b.c}
          stroke={INK}
          strokeWidth={0.9}
        />
      ))}
      {books2.map((b) => (
        <rect
          key={`b${b.x}`}
          x={b.x}
          y={32}
          width={b.w}
          height={16}
          rx={1}
          fill={b.c}
          stroke={INK}
          strokeWidth={0.9}
        />
      ))}
      <rect x={8} y={54} width={12} height={4} rx={1} fill="#94a3b8" stroke={INK} strokeWidth={0.8} />
      <rect x={24} y={54} width={10} height={4} rx={1} fill="#64748b" stroke={INK} strokeWidth={0.8} />
    </g>
  )
}

export function Whiteboard({
  x = 0,
  y = 0,
  sticky,
  chart,
}: XY & { sticky?: boolean; chart?: boolean }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <Sh cx={34} cy={52} rx={28} ry={3} />
      <rect x={2} y={2} width={64} height={42} rx={4} fill="#fffef8" stroke={INK} strokeWidth={1.7} />
      <rect x={4} y={3} width={60} height={4} fill="#f1f5f9" />
      <path d="M14 44 L18 54 M54 44 L50 54" stroke={WOOD_DK} strokeWidth={2.2} strokeLinecap="round" />
      <rect x={16} y={52} width={6} height={4} rx={1} fill={WOOD_DK} stroke={INK} strokeWidth={0.8} />
      <rect x={46} y={52} width={6} height={4} rx={1} fill={WOOD_DK} stroke={INK} strokeWidth={0.8} />
      {sticky ? (
        <>
          <rect x={8} y={12} width={13} height={13} fill="#fde047" stroke={INK} strokeWidth={1} transform="rotate(-7 14.5 18.5)" />
          <rect x={26} y={14} width={13} height={13} fill="#86efac" stroke={INK} strokeWidth={1} />
          <rect x={44} y={11} width={13} height={13} fill="#fda4af" stroke={INK} strokeWidth={1} transform="rotate(6 50.5 17.5)" />
          <path d="M12 30 Q24 26 36 32 Q48 28 56 34" fill="none" stroke="#94a3b8" strokeWidth={1.2} />
        </>
      ) : null}
      {chart ? (
        <>
          <rect x={10} y={28} width={9} height={10} rx={1} fill="#60a5fa" stroke={INK} strokeWidth={0.8} />
          <rect x={22} y={22} width={9} height={16} rx={1} fill="#34d399" stroke={INK} strokeWidth={0.8} />
          <rect x={34} y={18} width={9} height={20} rx={1} fill="#fbbf24" stroke={INK} strokeWidth={0.8} />
          <rect x={46} y={24} width={9} height={14} rx={1} fill="#f87171" stroke={INK} strokeWidth={0.8} />
        </>
      ) : null}
    </g>
  )
}

export function ServerRack({ x = 0, y = 0 }: XY) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <Sh cx={18} cy={58} rx={15} ry={3.5} />
      <path d="M3 2 L33 2 L35 54 L5 54 Z" fill="#1e293b" stroke={INK} strokeWidth={1.7} />
      <path d="M5 54 L35 54 L33 58 L7 58 Z" fill="#0f172a" stroke={INK} strokeWidth={1.2} />
      {[8, 18, 28, 38].map((yy, i) => (
        <g key={yy}>
          <rect x={7} y={yy} width={24} height={7} rx={1.5} fill="#334155" stroke={INK} strokeWidth={0.9} />
          <circle cx={11} cy={yy + 3.5} r={1.5} fill={i % 2 ? '#f87171' : '#34d399'} />
          <circle cx={16} cy={yy + 3.5} r={1.5} fill="#34d399" opacity={0.55} />
          <rect x={20} y={yy + 2} width={8} height={3} rx={0.5} fill="#0ea5e9" opacity={0.5} />
        </g>
      ))}
    </g>
  )
}

export function Plant({ x = 0, y = 0, tall, small }: XY & { tall?: boolean; small?: boolean }) {
  if (small) {
    return (
      <g transform={`translate(${x} ${y})`}>
        <Sh cx={10} cy={22} rx={8} ry={2} />
        <path
          d="M10 2 C16 4 18 10 14 14 C18 12 20 16 16 18 C12 20 8 18 6 14 C4 10 6 4 10 2Z"
          fill="#4ade80"
          stroke={INK}
          strokeWidth={1.3}
        />
        <path d="M8 8 C10 6 14 8 12 12" fill="none" stroke="#166534" strokeWidth={0.8} opacity={0.4} />
        <path d="M5 16 L15 16 L14 24 L6 24 Z" fill="#60a5fa" stroke={INK} strokeWidth={1.2} />
      </g>
    )
  }
  const s = tall ? 1.2 : 1
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <Sh cx={16} cy={52} rx={14} ry={3.5} />
      {/* snake-plant blades */}
      <path d="M16 28 C10 18 8 8 12 2 C14 10 14 20 16 28Z" fill="#22c55e" stroke={INK} strokeWidth={1.3} />
      <path d="M16 28 C22 16 26 6 22 0 C20 10 18 20 16 28Z" fill="#4ade80" stroke={INK} strokeWidth={1.3} />
      <path d="M16 28 C14 20 6 12 4 6 C10 12 14 22 16 28Z" fill="#16a34a" stroke={INK} strokeWidth={1.2} />
      <path d="M16 28 C18 20 28 14 30 8 C24 14 18 22 16 28Z" fill="#86efac" stroke={INK} strokeWidth={1.2} />
      <path d="M8 30 L24 30 L22 48 L10 48 Z" fill="#60a5fa" stroke={INK} strokeWidth={1.4} />
      <path d="M10 48 L22 48 L21 52 L11 52 Z" fill="#3b82f6" stroke={INK} strokeWidth={1} />
      <ellipse cx={16} cy={32} rx={7} ry={2.5} fill="#166534" opacity={0.25} />
    </g>
  )
}

/** Round rug as SVG prop (not CSS circle) */
export function RoundRug({ x = 0, y = 0, color = '#60a5fa' }: XY & { color?: string }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <ellipse cx={70} cy={42} rx={70} ry={36} fill={color} stroke={INK} strokeWidth={2} opacity={0.92} />
      <ellipse cx={70} cy={42} rx={58} ry={28} fill="none" stroke="#fff" strokeWidth={3} opacity={0.35} />
      <ellipse cx={70} cy={42} rx={46} ry={20} fill="none" stroke={INK} strokeWidth={1.2} opacity={0.2} />
    </g>
  )
}

export function SofaYellow({ x = 0, y = 0, withCat = false }: XY & { withCat?: boolean }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <Sh cx={70} cy={56} rx={66} ry={8} />
      {/* back */}
      <path
        d="M10 8 L130 8 Q138 8 138 16 L138 34 L2 34 L2 16 Q2 8 10 8Z"
        fill="#f59e0b"
        stroke={INK}
        strokeWidth={1.8}
      />
      {/* seat */}
      <path
        d="M4 30 L136 30 L140 50 L0 50 Z"
        fill="#ffc04d"
        stroke={INK}
        strokeWidth={1.8}
      />
      <path d="M0 50 L140 50 L136 58 L4 58 Z" fill="#d97706" stroke={INK} strokeWidth={1.4} />
      {/* cushions */}
      <path d="M14 34 L48 34 L50 48 L12 48 Z" fill="#fde68a" stroke={INK} strokeWidth={1.2} />
      <path d="M52 34 L88 34 L90 48 L50 48 Z" fill="#fef3c7" stroke={INK} strokeWidth={1.2} />
      <path d="M92 34 L126 34 L128 48 L90 48 Z" fill="#fde68a" stroke={INK} strokeWidth={1.2} />
      {/* arms */}
      <path d="M0 18 L14 18 L14 50 L0 46 Z" fill="#f59e0b" stroke={INK} strokeWidth={1.5} />
      <path d="M126 18 L140 18 L140 46 L126 50 Z" fill="#f59e0b" stroke={INK} strokeWidth={1.5} />
      {withCat ? <MascotCat x={58} y={22} /> : null}
    </g>
  )
}

export function MascotCat({ x = 0, y = 0, dark }: XY & { dark?: boolean }) {
  const fur = dark ? '#1e293b' : '#f8fafc'
  const line = dark ? '#0f172a' : INK
  return (
    <g transform={`translate(${x} ${y})`}>
      <ellipse cx={16} cy={14} rx={15} ry={8} fill={fur} stroke={line} strokeWidth={1.4} />
      <circle cx={28} cy={12} r={6.5} fill={fur} stroke={line} strokeWidth={1.2} />
      <path d="M24 7 l3 -5.5 M32 7 l-3 -5.5" stroke={line} strokeWidth={1.2} fill="none" strokeLinecap="round" />
      <path d="M25 7.5 l2 3 M31 7.5 l-2 3" fill="#f9a8d4" />
      <circle cx={26.5} cy={11.5} r={1} fill={line} />
      <circle cx={30} cy={11.5} r={1} fill={line} />
      <ellipse cx={4} cy={14} rx={4} ry={2.5} fill={fur} stroke={line} strokeWidth={1} />
    </g>
  )
}

export function Armchair({ x = 0, y = 0, color = '#60a5fa' }: XY & { color?: string }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <Sh cx={20} cy={42} rx={18} ry={4} />
      <path
        d="M6 6 L34 6 Q38 6 38 12 L38 28 L2 28 L2 12 Q2 6 6 6Z"
        fill={color}
        stroke={INK}
        strokeWidth={1.6}
      />
      <path d="M4 26 L36 26 L38 40 L2 40 Z" fill={color} stroke={INK} strokeWidth={1.5} opacity={0.95} />
      <path d="M2 40 L38 40 L36 46 L4 46 Z" fill={INK} opacity={0.15} />
      <path d="M0 20 L6 20 L6 40 L0 36 Z" fill={color} stroke={INK} strokeWidth={1.3} />
      <path d="M34 20 L40 20 L40 36 L34 40 Z" fill={color} stroke={INK} strokeWidth={1.3} />
      <ellipse cx={20} cy={30} rx={10} ry={4} fill="#fff" opacity={0.18} />
    </g>
  )
}

export function RoundTable({ x = 0, y = 0, withCat }: XY & { withCat?: boolean }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <ellipse cx={28} cy={26} rx={28} ry={10} fill={SHADOW} />
      <ellipse cx={28} cy={18} rx={26} ry={10} fill={WOOD_DK} stroke={INK} strokeWidth={1.5} />
      <ellipse cx={28} cy={14} rx={24} ry={9} fill={WOOD_LT} stroke={INK} strokeWidth={1.4} />
      <ellipse cx={20} cy={11} rx={5} ry={2.5} fill="#fff" opacity={0.35} />
      {withCat ? <MascotCat x={14} y={2} /> : null}
    </g>
  )
}

export function CoffeeMachine({ x = 0, y = 0 }: XY) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <Sh cx={18} cy={42} rx={14} ry={3} />
      <path d="M4 6 L32 6 L34 38 L6 38 Z" fill="#1e293b" stroke={INK} strokeWidth={1.7} />
      <path d="M6 38 L34 38 L32 42 L8 42 Z" fill="#0f172a" stroke={INK} strokeWidth={1.2} />
      <rect x={8} y={10} width={20} height={10} rx={2} fill="#f8fafc" stroke="#94a3b8" strokeWidth={1} />
      <rect x={10} y={24} width={16} height={5} rx={1.5} fill="#475569" />
      <path d="M14 30 L22 30 L20 36 L16 36 Z" fill="#78716c" stroke={INK} strokeWidth={1} />
      <circle cx={18} cy={16} r={2} fill="#38bdf8" />
    </g>
  )
}

export function CafeCounter({ x = 0, y = 0 }: XY) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <Sh cx={48} cy={40} rx={44} ry={5} />
      <path d="M4 10 L92 10 L96 28 L8 28 Z" fill="#f8fafc" stroke={INK} strokeWidth={1.7} />
      <path d="M8 28 L96 28 L92 40 L12 40 Z" fill="#e2e8f0" stroke={INK} strokeWidth={1.4} />
      <rect x={14} y={14} width={14} height={10} rx={2} fill="#fef3c7" stroke={INK} strokeWidth={1} />
      <rect x={32} y={12} width={12} height={12} rx={2} fill="#fecaca" stroke={INK} strokeWidth={1} />
      <rect x={48} y={13} width={14} height={11} rx={2} fill="#bbf7d0" stroke={INK} strokeWidth={1} />
      <CoffeeMachine x={64} y={-2} />
    </g>
  )
}

export function BarStool({ x = 0, y = 0 }: XY) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <Sh cx={10} cy={28} rx={9} ry={2.5} />
      <ellipse cx={10} cy={6} rx={9} ry={4} fill={WOOD} stroke={INK} strokeWidth={1.3} />
      <ellipse cx={10} cy={5} rx={6} ry={2.2} fill={WOOD_LT} opacity={0.7} />
      <rect x={8} y={8} width={4} height={18} fill={WOOD_DK} stroke={INK} strokeWidth={0.9} />
      <ellipse cx={10} cy={26} rx={7} ry={2} fill={WOOD_DK} stroke={INK} strokeWidth={0.9} />
    </g>
  )
}

export function Fridge({ x = 0, y = 0 }: XY) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <Sh cx={16} cy={52} rx={13} ry={3} />
      <path d="M4 2 L28 2 L30 50 L6 50 Z" fill="#e2e8f0" stroke={INK} strokeWidth={1.6} />
      <path d="M6 50 L30 50 L28 54 L8 54 Z" fill="#cbd5e1" stroke={INK} strokeWidth={1.1} />
      <rect x={7} y={6} width={18} height={20} rx={2} fill="#f8fafc" stroke={INK} strokeWidth={1} />
      <rect x={7} y={28} width={18} height={18} rx={2} fill="#f1f5f9" stroke={INK} strokeWidth={1} />
      <rect x={22} y={12} width={2} height={8} rx={1} fill="#64748b" />
      <rect x={22} y={34} width={2} height={8} rx={1} fill="#64748b" />
    </g>
  )
}

export function WaterCooler({ x = 0, y = 0 }: XY) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <Sh cx={14} cy={48} rx={12} ry={3} />
      <path d="M6 18 L22 18 L24 46 L4 46 Z" fill="#e2e8f0" stroke={INK} strokeWidth={1.5} />
      <ellipse cx={14} cy={12} rx={10} ry={10} fill="#7dd3fc" stroke={INK} strokeWidth={1.5} />
      <ellipse cx={14} cy={8} rx={6} ry={4} fill="#bae6fd" opacity={0.7} />
      <rect x={8} y={30} width={12} height={4} rx={1} fill="#64748b" />
    </g>
  )
}

export function MegaphoneBoard({ x = 0, y = 0 }: XY) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x={2} y={2} width={54} height={40} rx={4} fill="#ccfbf1" stroke={INK} strokeWidth={1.6} />
      <path d="M12 12 L32 7 L32 32 L12 27 Z" fill="#ffc04d" stroke={INK} strokeWidth={1.3} />
      <circle cx={12} cy={20} r={5.5} fill="#f9a79e" stroke={INK} strokeWidth={1.2} />
      <rect x={10} y={34} width={36} height={3} rx={1} fill="#0f766e" opacity={0.4} />
    </g>
  )
}

export function Devices({ x = 0, y = 0 }: XY) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x={2} y={4} width={13} height={24} rx={2.5} fill="#1e293b" stroke={INK} strokeWidth={1.3} />
      <rect x={4} y={6} width={9} height={16} rx={1} fill="#fef08a" />
      <rect x={20} y={8} width={13} height={20} rx={2} fill="#334155" stroke={INK} strokeWidth={1.3} />
      <rect x={38} y={2} width={18} height={26} rx={1.5} fill="#475569" stroke={INK} strokeWidth={1.3} />
      <rect x={40} y={4} width={14} height={18} rx={1} fill="#e2e8f0" />
    </g>
  )
}

export function Globe({ x = 0, y = 0 }: XY) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <Sh cx={16} cy={34} rx={10} ry={2.5} />
      <circle cx={16} cy={14} r={13} fill="#7dd3fc" stroke={INK} strokeWidth={1.5} />
      <path d="M6 12 Q16 4 26 12 Q16 20 6 12" fill="#22c55e" opacity={0.55} stroke={INK} strokeWidth={0.8} />
      <path d="M16 1 V27 M3 14 H29" stroke={INK} strokeWidth={1} opacity={0.25} />
      <rect x={13} y={27} width={6} height={6} rx={1} fill="#78716c" stroke={INK} strokeWidth={1} />
      <ellipse cx={16} cy={33} rx={8} ry={2} fill="#64748b" stroke={INK} strokeWidth={0.8} />
    </g>
  )
}

export function Poster({ x = 0, y = 0, variant = 'space' }: XY & { variant?: 'space' | 'pad' }) {
  if (variant === 'pad') {
    return (
      <g transform={`translate(${x} ${y})`}>
        <rect x={2} y={2} width={26} height={34} rx={3} fill="#fda4af" stroke={INK} strokeWidth={1.5} />
        <rect x={6} y={8} width={18} height={14} rx={2} fill="#fff" opacity={0.5} />
        <rect x={8} y={26} width={14} height={4} rx={1} fill="#fff" opacity={0.4} />
      </g>
    )
  }
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x={2} y={2} width={26} height={34} rx={3} fill="#508def" stroke={INK} strokeWidth={1.5} />
      <circle cx={15} cy={14} r={7} fill="#ffc04d" stroke={INK} strokeWidth={1.2} />
      <path d="M10 22 L20 22 L18 28 L12 28 Z" fill="#1e293b" stroke={INK} strokeWidth={1} />
      <rect x={7} y={30} width={16} height={3} rx={1} fill="#fff" opacity={0.55} />
    </g>
  )
}

export function MeetingTable({ x = 0, y = 0 }: XY) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <ellipse cx={90} cy={62} rx={86} ry={14} fill={SHADOW} />
      {/* rectangular wooden conference table */}
      <path
        d="M12 28 L168 28 L176 52 L4 52 Z"
        fill={WOOD}
        stroke={INK}
        strokeWidth={1.9}
      />
      <path d="M4 52 L176 52 L170 62 L10 62 Z" fill={WOOD_DK} stroke={INK} strokeWidth={1.5} />
      <ellipse cx={90} cy={38} rx={40} ry={6} fill={WOOD_LT} opacity={0.5} />
      <Chair x={20} y={4} />
      <Chair x={58} y={-2} />
      <Chair x={100} y={-2} />
      <Chair x={138} y={4} />
      <Chair x={40} y={58} />
      <Chair x={100} y={58} />
    </g>
  )
}

export function WallScreen({ x = 0, y = 0 }: XY) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x={0} y={0} width={120} height={40} rx={5} fill="#1e293b" stroke={INK} strokeWidth={1.7} />
      <rect x={5} y={4} width={110} height={30} rx={3} fill="#e0f2fe" />
      <text x={22} y={24} fontSize={9} fill="#0369a1" fontFamily="system-ui,sans-serif" fontWeight="700">
        Better Together
      </text>
    </g>
  )
}

export function ReceptionDesk({ x = 0, y = 0 }: XY) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <Sh cx={120} cy={70} rx={110} ry={10} />
      <path
        d="M8 30 Q120 4 232 30 L224 68 Q120 96 16 68 Z"
        fill="#f8fafc"
        stroke={INK}
        strokeWidth={1.9}
      />
      <path
        d="M22 34 Q120 16 218 34 L212 58 Q120 76 28 58 Z"
        fill="#fff"
        stroke="#cbd5e1"
        strokeWidth={1.2}
      />
      <circle cx={120} cy={48} r={11} fill="#508def" stroke={INK} strokeWidth={1.4} />
      <ellipse cx={120} cy={50} rx={6} ry={5} fill="#f8fafc" stroke={INK} strokeWidth={1} />
      <MascotCat x={168} y={28} />
    </g>
  )
}

export function GoodIdeasSign({ x = 0, y = 0 }: XY) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x={0} y={0} width={72} height={28} rx={6} fill="#0f172a" stroke={INK} strokeWidth={1.6} />
      <circle cx={16} cy={14} r={7} fill="#508def" stroke={INK} strokeWidth={1.1} />
      <text x={28} y={12} fontSize={6.5} fill="#86efac" fontFamily="system-ui,sans-serif" fontWeight="700">
        GOOD
      </text>
      <text x={28} y={21} fontSize={6.5} fill="#fde68a" fontFamily="system-ui,sans-serif" fontWeight="700">
        IDEAS :)
      </text>
    </g>
  )
}

export function VendingMachine({ x = 0, y = 0 }: XY) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <Sh cx={18} cy={64} rx={15} ry={3} />
      <path d="M3 2 L33 2 L35 60 L5 60 Z" fill="#64748b" stroke={INK} strokeWidth={1.7} />
      <rect x={7} y={8} width={24} height={38} rx={2} fill="#e0f2fe" stroke={INK} strokeWidth={1.1} />
      <rect x={9} y={12} width={8} height={10} rx={1} fill="#f87171" stroke={INK} strokeWidth={0.8} />
      <rect x={20} y={12} width={8} height={10} rx={1} fill="#60a5fa" stroke={INK} strokeWidth={0.8} />
      <rect x={9} y={26} width={8} height={10} rx={1} fill="#fbbf24" stroke={INK} strokeWidth={0.8} />
      <rect x={20} y={26} width={8} height={10} rx={1} fill="#34d399" stroke={INK} strokeWidth={0.8} />
      <rect x={9} y={50} width={20} height={6} rx={1} fill="#1e293b" stroke={INK} strokeWidth={0.9} />
    </g>
  )
}

export function Bench({ x = 0, y = 0 }: XY) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <Sh cx={44} cy={32} rx={42} ry={4} />
      <path d="M4 8 L84 8 L86 18 L2 18 Z" fill={WOOD} stroke={INK} strokeWidth={1.6} />
      <path d="M2 18 L86 18 L84 24 L4 24 Z" fill={WOOD_DK} stroke={INK} strokeWidth={1.3} />
      {/* metal arms */}
      <path d="M6 4 L6 28 M10 4 L10 8" stroke="#1e293b" strokeWidth={2.2} strokeLinecap="round" />
      <path d="M78 4 L78 28 M74 4 L74 8" stroke="#1e293b" strokeWidth={2.2} strokeLinecap="round" />
      <rect x={8} y={24} width={5} height={12} rx={1} fill={WOOD_DK} stroke={INK} strokeWidth={1} />
      <rect x={75} y={24} width={5} height={12} rx={1} fill={WOOD_DK} stroke={INK} strokeWidth={1} />
    </g>
  )
}

export function BeanBag({ x = 0, y = 0, color = '#f87171' }: XY & { color?: string }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <Sh cx={18} cy={30} rx={16} ry={3.5} />
      <path
        d="M18 2 C30 4 36 14 34 24 C32 32 24 34 18 34 C12 34 4 32 2 24 C0 14 6 4 18 2Z"
        fill={color}
        stroke={INK}
        strokeWidth={1.5}
      />
      <ellipse cx={18} cy={14} rx={10} ry={5} fill="#fff" opacity={0.18} />
    </g>
  )
}

export function TrashCan({ x = 0, y = 0 }: XY) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <Sh cx={10} cy={28} rx={9} ry={2} />
      <path d="M3 8 L17 8 L16 26 L4 26 Z" fill="#60a5fa" stroke={INK} strokeWidth={1.3} />
      <rect x={1} y={5} width={18} height={5} rx={1.5} fill="#3b82f6" stroke={INK} strokeWidth={1.1} />
    </g>
  )
}

export function FloorLamp({ x = 0, y = 0 }: XY) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <Sh cx={14} cy={58} rx={10} ry={2.5} />
      <rect x={12} y={22} width={4} height={34} fill="#64748b" stroke={INK} strokeWidth={1} />
      <path
        d="M14 4 C26 8 28 18 22 22 C18 18 10 18 6 22 C0 18 2 8 14 4Z"
        fill="#fef3c7"
        stroke={INK}
        strokeWidth={1.4}
      />
      <ellipse cx={14} cy={56} rx={9} ry={3} fill="#475569" stroke={INK} strokeWidth={1} />
    </g>
  )
}

export function WallLamp({ x = 0, y = 0 }: XY) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x={6} y={2} width={4} height={6} fill="#94a3b8" stroke={INK} strokeWidth={0.9} />
      <path
        d="M8 8 C18 10 20 20 8 24 C-4 20 -2 10 8 8Z"
        fill="#fde68a"
        stroke={INK}
        strokeWidth={1.2}
        opacity={0.95}
      />
      <ellipse cx={8} cy={28} rx={10} ry={4} fill="#fef08a" opacity={0.35} />
    </g>
  )
}

/** Garden tree — layered organic canopy */
export function Tree({ x = 0, y = 0, variant = 'a' }: XY & { variant?: 'a' | 'b' }) {
  const tone = variant === 'b' ? '#4ade80' : '#22c55e'
  const tone2 = variant === 'b' ? '#22c55e' : '#16a34a'
  return (
    <g transform={`translate(${x} ${y}) scale(1.15)`}>
      <Sh cx={28} cy={78} rx={24} ry={5.5} />
      <path d="M24 38 L32 38 L35 78 L21 78 Z" fill="#92400e" stroke={INK} strokeWidth={1.4} />
      <path d="M26 38 L30 38 L29 52 L27 52 Z" fill="#a16207" />
      <LeafCluster cx={14} cy={30} scale={1.5} tone={tone} />
      <LeafCluster cx={42} cy={28} scale={1.35} tone={tone2} />
      <LeafCluster cx={28} cy={10} scale={1.65} tone="#86efac" />
      <LeafCluster cx={28} cy={34} scale={1.25} tone={tone} />
      <LeafCluster cx={20} cy={18} scale={0.9} tone={tone2} />
    </g>
  )
}

export function GrassPatch({ x = 0, y = 0, w = 120 }: XY & { w?: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <ellipse cx={w / 2} cy={18} rx={w / 2} ry={16} fill="#86efac" stroke="#16a34a" strokeWidth={1.6} />
      <ellipse cx={w / 2} cy={14} rx={w / 2 - 8} ry={12} fill="#4ade80" opacity={0.55} />
      {Array.from({ length: 8 }, (_, i) => (
        <path
          key={i}
          d={`M${12 + i * (w / 9)} 18 Q${14 + i * (w / 9)} 6 ${16 + i * (w / 9)} 18`}
          fill="none"
          stroke="#166534"
          strokeWidth={1.2}
          opacity={0.45}
        />
      ))}
    </g>
  )
}

export function Pond({ x = 0, y = 0 }: XY) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <ellipse cx={36} cy={20} rx={36} ry={16} fill="#38bdf8" stroke={INK} strokeWidth={1.5} opacity={0.85} />
      <ellipse cx={36} cy={18} rx={28} ry={10} fill="#7dd3fc" opacity={0.5} />
      <ellipse cx={22} cy={16} rx={8} ry={4} fill="#bbf7d0" stroke={INK} strokeWidth={0.9} />
      <ellipse cx={48} cy={20} rx={6} ry={3} fill="#86efac" stroke={INK} strokeWidth={0.9} />
    </g>
  )
}

export function GardenArch({ x = 0, y = 0 }: XY) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <path d="M8 48 L8 12 Q28 0 48 12 L48 48" fill="none" stroke={WOOD_DK} strokeWidth={4} strokeLinecap="round" />
      <path d="M14 48 L14 16 Q28 6 42 16 L42 48" fill="none" stroke={WOOD} strokeWidth={2.2} />
      <LeafCluster cx={18} cy={10} scale={0.55} tone="#4ade80" />
      <LeafCluster cx={38} cy={12} scale={0.5} tone="#22c55e" />
      <LeafCluster cx={28} cy={4} scale={0.45} tone="#86efac" />
    </g>
  )
}

export function Flower({ x = 0, y = 0, color = '#fb7185' }: XY & { color?: string }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x={5} y={8} width={2} height={10} fill="#16a34a" stroke={INK} strokeWidth={0.6} />
      <circle cx={6} cy={6} r={4} fill={color} stroke={INK} strokeWidth={1} />
      <circle cx={6} cy={6} r={1.5} fill="#fef08a" />
    </g>
  )
}

export function GardenSign({ x = 0, y = 0 }: XY) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x={18} y={16} width={4} height={22} fill={WOOD_DK} stroke={INK} strokeWidth={1} />
      <rect x={0} y={0} width={40} height={20} rx={3} fill={WOOD} stroke={INK} strokeWidth={1.4} />
      <text x={4} y={9} fontSize={4.5} fill={INK} fontFamily="system-ui,sans-serif" fontWeight="700">
        Good People
      </text>
      <text x={3} y={16} fontSize={4} fill="#475569" fontFamily="system-ui,sans-serif">
        Better Tomorrow
      </text>
    </g>
  )
}

export function StonePath({ x = 0, y = 0 }: XY) {
  return (
    <g transform={`translate(${x} ${y})`}>
      {[0, 18, 36, 54, 72].map((dx, i) => (
        <ellipse
          key={dx}
          cx={dx + 10}
          cy={8 + (i % 2) * 3}
          rx={9}
          ry={5}
          fill="#cbd5e1"
          stroke={INK}
          strokeWidth={1}
        />
      ))}
    </g>
  )
}
