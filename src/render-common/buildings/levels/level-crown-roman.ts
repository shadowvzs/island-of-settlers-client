import type { Point3 } from "../building-recipe";
import type { DormerStyle } from "./level-dormer";
import { heightCap, type LevelKit, ridgeHalfLength } from "./level-kit";
import { isLeanPiece } from "./level-lean";
import { isRoofSpotFree, ridgeAxisOf } from "./level-roof-pieces";
import { addOpenRoofVentStorey } from "./level-roof-vent";

/** Lantern storeys at full size: plinth, columns, entablature, dome (its rise) and finial. */
const LANTERN = { columns: .2, dome: .15, entablature: .05, finial: .1, plinth: .1, width: .34 } as const;
const LANTERN_HEIGHT = LANTERN.plinth + LANTERN.columns + LANTERN.entablature + LANTERN.dome + LANTERN.finial;

export const ROMAN_DORMER: DormerStyle = { gable: "stone", wall: "stone", window: "louvered",
  ornament: (kit, apex) => kit.add({ position: [apex[0], apex[1] + .05, apex[2]], shape: "cone",
    size: [.05, .09, .05], stage: 4, surface: "gold", radialSegments: kit.detailed ? 8 : 4 }) };

/** Lowest roof point under a square footprint round `centre` (so a plinth closes down onto the slopes). */
export const footprintFloor = (kit: LevelKit, centre: Point3, half: number) => {
  let floor = centre[1];
  for (const dx of [-half, half]) for (const dz of [-half, half]) {
    const height = kit.site.topAt(centre[0] + dx, centre[2] + dz);
    if (height !== null) floor = Math.min(floor, height);
  }
  return floor;
};

/** The roof's crown point: the ridge (or terrace) over the roof centre. */
export const crownPoint = (kit: LevelKit): Point3 | null => {
  const roof = kit.site.roof;
  if (!roof) return null;
  const top = kit.site.topAt(roof.centre[0], roof.centre[2]);
  return top === null ? null : [roof.centre[0], top, roof.centre[2]];
};

/** Size factor that keeps a crown `height` tall standing at `base` inside the height cap. */
export const crownScale = (kit: LevelKit, base: number, height: number) =>
  Math.min(1, (heightCap(kit.site) - .02 - base) / height);

/** Ridge lantern: an ashlar plinth, open colonnade (High) round a dark core, cornice, tiled dome, gilded finial. */
const ridgeLantern = (kit: LevelKit, crown: Point3) => {
  const scale = crownScale(kit, crown[1], LANTERN_HEIGHT);
  if (scale < .55) return;
  const width = LANTERN.width * scale, [x, ridge, z] = crown;
  const floor = footprintFloor(kit, crown, width / 2) - .02;
  if (!isRoofSpotFree(kit, [x, ridge + LANTERN_HEIGHT * scale / 2, z], [width, LANTERN_HEIGHT * scale, width], ridge))
    return;
  let y = ridge + LANTERN.plinth * scale;
  kit.add({ position: [x, (floor + y) / 2, z], shape: "box", size: [width, y - floor, width], stage: 4,
    surface: "stone" });
  const columns = LANTERN.columns * scale;
  addOpenRoofVentStorey(kit, [x, y + columns / 2, z], width, columns, .045 * scale, true);
  y += columns;
  kit.add({ position: [x, y + LANTERN.entablature * scale / 2, z], shape: "bevel-box",
    size: [width + .04, LANTERN.entablature * scale, width + .04], stage: 4, surface: "cut-stone" });
  y += LANTERN.entablature * scale;
  // A low tiled cupola: a turned drum narrowing to a cap (far lighter than a full dome shell).
  kit.add({ position: [x, y + LANTERN.dome * scale * .4, z], radialSegments: kit.detailed ? 12 : 8, shape: "cylinder",
    size: [width * .96, LANTERN.dome * scale * .8, width * .96], stage: 4, surface: "roof", topScale: [.45, 1, .45] });
  kit.add({ position: [x, y + LANTERN.dome * scale * .8, z], radialSegments: kit.detailed ? 10 : 6, shape: "sphere",
    size: [width * .44, LANTERN.dome * scale * .5, width * .44], stage: 4, surface: "roof" });
  y += LANTERN.dome * scale;
  kit.add({ position: [x, y + .02, z], shape: "sphere", size: [.05 * scale, .05 * scale, .05 * scale], stage: 4,
    surface: "gold", radialSegments: kit.detailed ? 8 : 4 });
  kit.add({ position: [x, y + .07 * scale, z], shape: "cone", size: [.035 * scale, .08 * scale, .035 * scale],
    stage: 4, surface: "gold", radialSegments: kit.detailed ? 8 : 4 });
};

/** Gilded acroteria on both ends of the ridge. */
const acroteria = (kit: LevelKit) => {
  const roof = kit.site.roof!, axis = ridgeAxisOf(kit), half = ridgeHalfLength(kit.site);
  for (const end of [-1, 1]) {
    const point: Point3 = [...roof.centre];
    point[axis] += end * (half - .05);
    const top = kit.site.topAt(point[0], point[2]);
    if (top === null) continue;
    kit.add({ position: [point[0], top + .06, point[2]], shape: "cone", size: [.07, .15, .07], stage: 4,
      surface: "gold", radialSegments: kit.detailed ? 8 : 4 });
  }
};

/** Level 5 Roman crown: ridge lantern and acroteria. */
export const addRomanCrown = (kit: LevelKit) => {
  const crown = crownPoint(kit);
  if (!crown) return;
  ridgeLantern(kit, crown);
  if (kit.site.roof!.ridgeAxis !== null && !isLeanPiece(kit.site, "crown-ornaments")) acroteria(kit);
};
