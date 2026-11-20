import { type BufferGeometry,ConeGeometry, TorusGeometry } from "three";

import {
  createColouredSculpt, curveThrough, ellipsoid, loftGeometry, profileTube, type SculptColor, type SculptPoint
} from "../sculpt-geometry";
import { DRAGON_CARVING_ATLAS, DRAGON_NECK_START } from "./ship-dragon-carving";

/**
 * Original carved dragon prow for the Viking player's ships: the stem timber rises from the keel and
 * flows without a joint into a knotwork-carved neck and a long-snouted head with open jaws, carved
 * teeth, a deep eye socket, swept-back ear lappets and a red-painted mane; carved oak with subtle paint
 * accents, no horns (owner 2026-10-13). Ship space, before the sailing-ship scale; the longship moves
 * it onto its bow (VIKING_FIGUREHEAD_OFFSET).
 */
const PAINT = {
  bone: [.86, .8, .66], gape: [.5, .1, .07], mane: [.55, .16, .1], oak: [.5, .36, .23], snout: [.47, .33, .21]
} as const satisfies Record<string, SculptColor>;

/** Stem (from the keel at the bow) and neck, arching up and forward to the skull: one timber. */
const STEM_AND_NECK: readonly SculptPoint[] = [[0, -.2, 1.08], [0, -.05, 1.19], [0, .15, 1.23], [0, .32, 1.22],
  [0, .4, 1.2], [0, .47, 1.205], [0, .545, 1.235], [0, .59, 1.28], [0, .605, 1.322]];
const TIMBER = curveThrough(STEM_AND_NECK);
const SKULL: SculptPoint = [0, .612, 1.345];

type Sculpt = ReturnType<typeof createColouredSculpt>;
interface Detail { detailed: boolean; round: number; sides: number }

/** Timber radius by arc length: the stem swells to the throat, the neck tapers to the skull. */
const timberRadius = (t: number) => t < DRAGON_NECK_START ? .03 + t / DRAGON_NECK_START * .012
  : .042 - (t - DRAGON_NECK_START) / (1 - DRAGON_NECK_START) * .014;

/** A jaw lofted forward from the skull (y of the loft becomes +z), pitched by `open` (down positive). */
const jaw = (rings: { rx: number; rz: number; y: number }[], sides: number, open: number, origin: SculptPoint) =>
  loftGeometry(rings, sides).rotateX(Math.PI / 2 + open).translate(...origin);

const timber = (sculpt: Sculpt, detail: Detail) => {
  sculpt.add(profileTube(TIMBER, timberRadius, detail.detailed ? 30 : 10, detail.sides), PAINT.oak,
    DRAGON_CARVING_ATLAS.neck);
  if (!detail.detailed) return;
  // A carved collar under the skull.
  const collar = TIMBER.getPointAt(.93);
  sculpt.add(new TorusGeometry(timberRadius(.93), .004, 4, 14).lookAt(TIMBER.getTangentAt(.93))
    .translate(collar.x, collar.y, collar.z), PAINT.oak, DRAGON_CARVING_ATLAS.grain);
  // A low carved mane of overlapping fins down the back of the neck.
  for (let fin = 0; fin < 6; fin++) {
    const t = DRAGON_NECK_START + .05 + fin * .06, point = TIMBER.getPointAt(t);
    sculpt.add(ellipsoid(5, [.005, .014, .02], [0, point.y + .012, point.z - timberRadius(t) * .8], -.9),
      PAINT.mane, DRAGON_CARVING_ATLAS.grain);
  }
};

const teeth = (sculpt: Sculpt, side: number) => {
  for (let tooth = 0; tooth < 5; tooth++) {
    const z = 1.385 + tooth * .013, x = side * (.017 - tooth * .0015);
    sculpt.add(new ConeGeometry(.0035, .014, 3).rotateX(Math.PI).translate(x, .6, z), PAINT.bone,
      DRAGON_CARVING_ATLAS.grain);
    sculpt.add(new ConeGeometry(.003, .012, 3).translate(x * .9, .575 - tooth * .004, z - .004), PAINT.bone,
      DRAGON_CARVING_ATLAS.grain);
  }
};

/** Brow over the eye socket, a swept ear lappet lying back along the skull, a nostril and the teeth. */
const headSide = (sculpt: Sculpt, side: number) => {
  const { grain, scales } = DRAGON_CARVING_ATLAS;
  sculpt.add(ellipsoid(7, [.016, .011, .024], [side * .027, .632, 1.352], -.3), PAINT.oak, scales);
  sculpt.add(ellipsoid(6, [.005, .009, .03], [side * .033, .627, 1.312], -.2), PAINT.oak, grain);
  sculpt.add(ellipsoid(5, [.006, .005, .007], [side * .012, .624, 1.448]), PAINT.oak, grain);
  teeth(sculpt, side);
};

const head = (sculpt: Sculpt, detail: Detail) => {
  const { grain, scales } = DRAGON_CARVING_ATLAS;
  sculpt.add(ellipsoid(detail.round, [.04, .036, .05], SKULL, -.15), PAINT.oak, scales);
  sculpt.add(jaw([{ rx: .032, rz: .022, y: 0 }, { rx: .024, rz: .017, y: .05 }, { rx: .019, rz: .014, y: .085 }],
    detail.sides, -.08, [0, .612, 1.365]), PAINT.snout, scales);
  sculpt.add(jaw([{ rx: .026, rz: .011, y: 0 }, { rx: .018, rz: .008, y: .075 }], detail.sides, .36,
    [0, .592, 1.36]), PAINT.snout, scales);
  if (!detail.detailed) return;
  sculpt.add(ellipsoid(8, [.015, .009, .03], [0, .59, 1.392], .25), PAINT.gape, grain);
  sculpt.add(profileTube(curveThrough([[0, .594, 1.38], [0, .586, 1.43], [0, .594, 1.465]]), t => .005 - t * .003, 6, 4),
    PAINT.gape, grain);
  for (const side of [-1, 1]) headSide(sculpt, side);
};

/** The carved stem and dragon (one vertex-painted, atlas-mapped mesh) and its eyes (a separate glowing mesh). */
export const createShipDragonFigurehead = (detailed: boolean): { carving: BufferGeometry; eyes: BufferGeometry } => {
  const detail: Detail = detailed ? { detailed, round: 10, sides: 10 } : { detailed, round: 5, sides: 5 };
  const sculpt = createColouredSculpt();
  timber(sculpt, detail);
  head(sculpt, detail);
  const eyes = createColouredSculpt();
  for (const side of [-1, 1]) eyes.add(ellipsoid(detailed ? 6 : 4, [.008, .007, .008], [side * .031, .626, 1.362]),
    [1, 1, 1]);
  return { carving: sculpt.buildInPlace(), eyes: eyes.buildInPlace() };
};
