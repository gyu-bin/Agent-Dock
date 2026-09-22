import type { VisualRole } from './assets/assetResolver'
import { ROLE_LOOK } from './assets/assetResolver'
import type { VisualAnimation } from './visual/agentVisual'
import styles from './PixelCharacter.module.css'

interface Props {
  role: VisualRole
  animation: VisualAnimation
  /** Stable id for tiny face variation */
  seed?: string
}

/**
 * SD character matching Agent Deck 2D Asset Sheet v1.0 —
 * large head, small body, role hair/outfit, soft outline.
 */
export function PixelCharacter({ role, animation, seed = role }: Props) {
  const look = ROLE_LOOK[role] ?? ROLE_LOOK.generic
  const wink = seed.charCodeAt(0) % 7 === 0
  const working = animation === 'work'

  return (
    <div
      className={`${styles.wrap} pixelBody`}
      data-anim={animation}
      data-role={role}
      aria-hidden
    >
      <svg className={styles.svg} viewBox="0 0 64 84" width="56" height="72">
        <ellipse cx="32" cy="80" rx="15" ry="3.2" fill="rgba(30,41,59,0.14)" />

        {/* legs — hide when working (seated) */}
        {!working ? (
          <g className={styles.legs}>
            <rect x="24" y="62" width="7" height="15" rx="3.5" fill="#475569" stroke="#1e293b" strokeWidth="1.5" />
            <rect x="33" y="62" width="7" height="15" rx="3.5" fill="#475569" stroke="#1e293b" strokeWidth="1.5" />
          </g>
        ) : (
          <g>
            <rect x="22" y="64" width="9" height="8" rx="3" fill="#475569" stroke="#1e293b" strokeWidth="1.3" />
            <rect x="33" y="64" width="9" height="8" rx="3" fill="#475569" stroke="#1e293b" strokeWidth="1.3" />
          </g>
        )}

        {/* torso */}
        <rect
          x="20"
          y={working ? 44 : 42}
          width="24"
          height={working ? 22 : 24}
          rx="8"
          fill={look.body}
          stroke="#1e293b"
          strokeWidth="1.8"
        />
        <rect x="22" y={working ? 46 : 44} width="10" height="6" rx="3" fill="#fff" opacity="0.2" />

        {/* role accents */}
        {role === 'pm' || role === 'manager' ? (
          <rect x="28" y="48" width="8" height="10" rx="1" fill="#fff" opacity="0.85" stroke="#1e293b" strokeWidth="0.8" />
        ) : null}
        {role === 'manager' ? (
          <rect x="30" y="50" width="4" height="8" fill={look.accent} />
        ) : null}
        {role === 'developer' ? (
          <path d="M20 46 Q32 40 44 46" fill={look.accent} stroke="#1e293b" strokeWidth="1.2" />
        ) : null}
        {role === 'game-designer' ? (
          <path d="M22 44 L42 44 L40 54 L24 54 Z" fill={look.accent} opacity="0.35" />
        ) : null}
        {role === 'designer' ? (
          <rect x="22" y="46" width="20" height="12" rx="2" fill={look.accent} opacity="0.25" />
        ) : null}
        {role === 'tester' ? (
          <rect x="26" y="48" width="12" height="9" rx="1.5" fill="#e2e8f0" stroke="#1e293b" strokeWidth="1" />
        ) : null}
        {role === 'marketer' && !working ? (
          <g transform="translate(44 50)">
            <rect width="9" height="10" rx="2" fill="#fff" stroke="#1e293b" strokeWidth="1.2" />
            <path d="M9 2 Q13 5 9 9" fill="none" stroke="#1e293b" strokeWidth="1.2" />
            <rect x="1.5" y="1.5" width="6" height="2.5" fill="#78350f" opacity="0.55" />
          </g>
        ) : null}

        {/* arms */}
        {!working ? (
          <>
            <rect x="13" y="46" width="8" height="13" rx="4" fill={look.body} stroke="#1e293b" strokeWidth="1.4" />
            <rect x="43" y="46" width="8" height="13" rx="4" fill={look.body} stroke="#1e293b" strokeWidth="1.4" />
          </>
        ) : (
          <>
            <rect x="14" y="50" width="8" height="10" rx="4" fill={look.body} stroke="#1e293b" strokeWidth="1.3" />
            <rect x="42" y="50" width="8" height="10" rx="4" fill={look.body} stroke="#1e293b" strokeWidth="1.3" />
          </>
        )}

        {/* head */}
        <circle cx="32" cy="24" r="16" fill="#f8c9a8" stroke="#1e293b" strokeWidth="1.9" />
        <ellipse cx="22" cy="28" rx="3.2" ry="2.2" fill="#fda4af" opacity="0.55" />
        <ellipse cx="42" cy="28" rx="3.2" ry="2.2" fill="#fda4af" opacity="0.55" />

        {/* hair by role */}
        <Hair role={role} color={look.hair} />

        {/* eyes */}
        {wink ? (
          <>
            <path d="M25 24 Q28 26 31 24" stroke="#1e293b" strokeWidth="1.6" fill="none" strokeLinecap="round" />
            <circle cx="38" cy="24" r="2.2" fill="#1e293b" />
            <circle cx="38.7" cy="23.3" r="0.7" fill="#fff" />
          </>
        ) : (
          <>
            <circle cx="26" cy="24" r="2.2" fill="#1e293b" />
            <circle cx="38" cy="24" r="2.2" fill="#1e293b" />
            <circle cx="26.7" cy="23.3" r="0.7" fill="#fff" />
            <circle cx="38.7" cy="23.3" r="0.7" fill="#fff" />
          </>
        )}

        {/* mouth */}
        <path d="M28 30 Q32 33 36 30" stroke="#e11d48" strokeWidth="1.4" fill="none" strokeLinecap="round" />

        {/* glasses for QA / researcher */}
        {(role === 'tester' || role === 'researcher') && (
          <g stroke="#334155" strokeWidth="1.5" fill="none">
            <circle cx="26" cy="24" r="5" />
            <circle cx="38" cy="24" r="5" />
            <path d="M31 24 H33" />
          </g>
        )}

        {/* work laptop */}
        {working ? (
          <g transform="translate(18 52)">
            <rect width="28" height="16" rx="2.5" fill="#64748b" stroke="#1e293b" strokeWidth="1.5" />
            <rect x="2" y="2" width="24" height="9" fill="#86efac" rx="1" />
            <rect x="2" y="2" width="24" height="2.5" fill="#fff" opacity="0.3" />
            <rect x="-2" y="14" width="32" height="3" rx="1" fill="#475569" stroke="#1e293b" strokeWidth="1" />
          </g>
        ) : null}
      </svg>
    </div>
  )
}

function Hair({ role, color }: { role: VisualRole; color: string }) {
  switch (role) {
    case 'pm':
      return (
        <path
          d="M16 24 Q16 6 32 6 Q48 6 48 24 Q46 12 32 11 Q18 12 16 24 Z"
          fill={color}
          stroke="#1e293b"
          strokeWidth="1.6"
        />
      )
    case 'developer':
      return (
        <path
          d="M15 26 Q15 8 32 7 Q49 8 49 26 Q46 14 32 13 Q18 14 15 26 Z"
          fill={color}
          stroke="#1e293b"
          strokeWidth="1.6"
        />
      )
    case 'game-designer':
      return (
        <g>
          <ellipse cx="32" cy="14" rx="17" ry="11" fill={color} stroke="#1e293b" strokeWidth="1.6" />
          <path d="M15 20 Q18 32 16 36" stroke={color} strokeWidth="5" strokeLinecap="round" fill="none" />
          <path d="M49 20 Q46 32 48 36" stroke={color} strokeWidth="5" strokeLinecap="round" fill="none" />
        </g>
      )
    case 'designer':
      return (
        <g>
          <path
            d="M15 22 Q15 6 32 5 Q49 6 49 22 Q46 12 32 11 Q18 12 15 22 Z"
            fill={color}
            stroke="#1e293b"
            strokeWidth="1.6"
          />
          <path d="M14 24 Q10 36 16 42" stroke={color} strokeWidth="5" strokeLinecap="round" fill="none" />
          <path d="M50 24 Q54 36 48 42" stroke={color} strokeWidth="5" strokeLinecap="round" fill="none" />
        </g>
      )
    case 'researcher':
      return (
        <path
          d="M16 22 Q18 6 32 5 Q46 6 48 22 L46 16 Q32 10 18 16 Z"
          fill={color}
          stroke="#1e293b"
          strokeWidth="1.6"
        />
      )
    case 'marketer':
      return (
        <g>
          <ellipse cx="32" cy="13" rx="16" ry="10" fill={color} stroke="#1e293b" strokeWidth="1.6" />
          <circle cx="20" cy="10" r="3.5" fill={color} stroke="#1e293b" strokeWidth="1" />
          <circle cx="44" cy="10" r="3.5" fill={color} stroke="#1e293b" strokeWidth="1" />
        </g>
      )
    case 'tester':
      return (
        <path
          d="M16 24 Q16 7 32 6 Q48 7 48 24 Q45 13 32 12 Q19 13 16 24 Z"
          fill={color}
          stroke="#1e293b"
          strokeWidth="1.6"
        />
      )
    case 'manager':
      return (
        <path
          d="M17 22 Q18 8 32 7 Q46 8 47 22 Q44 13 32 12 Q20 13 17 22 Z"
          fill={color}
          stroke="#1e293b"
          strokeWidth="1.6"
        />
      )
    default:
      return (
        <ellipse cx="32" cy="14" rx="16" ry="11" fill={color} stroke="#1e293b" strokeWidth="1.6" />
      )
  }
}
