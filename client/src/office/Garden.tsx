import { t } from '../i18n'
import { PropSprite } from './furniture/PropSprite'
import {
  Bench,
  GardenArch,
  GardenSign,
  GrassPatch,
  MascotCat,
  Plant,
  StonePath,
  Tree,
} from './furniture/SheetProps'
import styles from './Garden.module.css'

/** Garden — PNG grass / path / tree / bench / plants (SheetProps fallback only). */
export function Garden() {
  return (
    <div className={styles.room} data-room="plaza">
      <div className={styles.floorWash} aria-hidden />
      <div className={styles.wallTop} aria-hidden />
      <header className={styles.header}>
        <span>{t('room.garden')}</span>
      </header>
      <svg className={styles.scene} viewBox="0 0 320 180" preserveAspectRatio="xMidYMid meet" aria-hidden>
        <PropSprite kind="environment" id="wall" x={20} y={-4} width={140} height={28} fallback={null} />
        <PropSprite kind="environment" id="wall" x={160} y={-4} width={140} height={28} fallback={null} />

        <PropSprite
          kind="environment"
          id="grass"
          x={4}
          y={95}
          width={78}
          height={78}
          fallback={<GrassPatch x={4} y={95} w={78} />}
        />
        <PropSprite kind="environment" id="grass" x={70} y={100} width={78} height={78} fallback={null} />
        <PropSprite kind="environment" id="grass" x={140} y={95} width={78} height={78} fallback={null} />
        <PropSprite kind="environment" id="grass" x={210} y={100} width={78} height={78} fallback={null} />
        <PropSprite kind="environment" id="grass" x={248} y={88} width={68} height={68} fallback={null} />

        <PropSprite
          kind="environment"
          id="garden-path"
          x={138}
          y={68}
          width={44}
          height={88}
          fallback={<StonePath x={95} y={118} />}
        />

        <PropSprite
          kind="plant"
          id="tree"
          x={2}
          y={2}
          width={80}
          height={110}
          fallback={<Tree x={2} y={2} variant="a" />}
        />
        <PropSprite
          kind="plant"
          id="tree"
          x={232}
          y={0}
          width={80}
          height={110}
          fallback={<Tree x={232} y={0} variant="b" />}
        />

        <GardenArch x={118} y={6} />
        <GardenSign x={250} y={68} />
        <PropSprite
          kind="environment"
          id="doorway"
          x={130}
          y={8}
          width={55}
          height={40}
          fallback={null}
        />

        <PropSprite
          kind="environment"
          id="bench"
          x={95}
          y={108}
          width={100}
          height={55}
          fallback={<Bench x={95} y={108} />}
        />
        <MascotCat x={122} y={100} dark />
        <text x={154} y={104} fontSize={9} fill="#64748b" fontWeight="700" fontFamily="system-ui,sans-serif">
          Zzz
        </text>

        <PropSprite
          kind="plant"
          id="garden-plant"
          x={40}
          y={108}
          width={42}
          height={55}
          fallback={<Plant x={40} y={108} />}
        />
        <PropSprite
          kind="plant"
          id="garden-plant"
          x={262}
          y={110}
          width={42}
          height={55}
          fallback={<Plant x={262} y={110} />}
        />
        <PropSprite
          kind="plant"
          id="plant-small"
          x={78}
          y={132}
          fallback={<Plant x={78} y={132} small />}
        />
      </svg>
    </div>
  )
}
