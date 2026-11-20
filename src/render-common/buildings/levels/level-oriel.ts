import type { Point3 } from "../building-recipe";
import type { WallRun } from "../nation-kit-classify";
import type { LevelKit } from "./level-kit";
import { addRoofVentWindow } from "./level-roof-vent";
import { findWallSpot, oriented, spotFrame, type WallPiece } from "./level-wall-pieces";

/**
 * Level 5 mashrabiya: a timber oriel window projecting from an upper wall on two corbels, its
 * lattice front over a recessed shaded opening and a cap shedding sun and sand. Size along the
 * wall, height of the box and its projection.
 */
interface OrielSize { depth: number; height: number; width: number }
/** The full oriel, then a narrow one for crowded walls. */
const SIZES: readonly OrielSize[] = [{ depth: .16, height: .34, width: .3 }, { depth: .13, height: .27, width: .24 }];
const CORBEL = .1;
const CAP = .03;
const wallTop = (wall: WallRun) => wall.base + wall.height;

/** High on the wall (its cap under the eave), else level with the door head, else just over the plinth band. */
const orielPiece = (oriel: OrielSize): WallPiece => ({
  bottoms: (kit, wall) => [Math.min(kit.site.door.top + .04, wallTop(wall) - oriel.height - CAP - CORBEL - .06),
    kit.site.door.top - .05 - CORBEL, .3],
  clearOfWindows: true, overTrim: .05, size: [oriel.width + .06, oriel.height + CORBEL + CAP, oriel.depth + .04]
});

/** Lattice bars across the front: High a 3 x 2 grid, Minimal one cross. */
const LATTICE = { high: { columns: 3, rows: 2 }, minimal: { columns: 1, rows: 1 } } as const;

/** The first oriel size with an open camera-side wall spot. */
const findOrielSpot = (kit: LevelKit) => {
  for (const oriel of SIZES) {
    const spot = findWallSpot(kit, orielPiece(oriel));
    if (spot) return { oriel, spot };
  }
  return null;
};

/** Mashrabiya oriel on a camera-side wall; false when no wall has room for it. */
export const addOriel = (kit: LevelKit) => {
  const found = findOrielSpot(kit);
  if (!found) return false;
  const { oriel, spot } = found, frame = spotFrame(kit, spot), floor = spot.bottom + CORBEL;
  const top = floor + oriel.height, out = (reach: number) => frame.standoff + reach, { depth, width } = oriel;
  const at = (y: number, reach: number, shift = 0) => {
    const point = frame.at(y, out(reach));
    point[frame.along] += shift;
    return point;
  };
  const timber = kit.detailed ? "bevel-box" : "box", reachIn = frame.standoff;
  for (const side of [-1, 1]) kit.add({ position: at(spot.bottom + CORBEL / 2, depth / 2 - reachIn / 2,
    side * (width / 2 - .05)), shape: timber, size: oriented(frame.along, .04, CORBEL, depth + reachIn),
  surface: "wood" });
  kit.add({ position: at(floor + .0175, (depth + .02) / 2 - reachIn / 2), shape: timber,
    size: oriented(frame.along, width + .04, .035, depth + .02 + reachIn), surface: "wood" });
  for (const side of [-1, 1]) kit.add({ position: at((floor + top) / 2, depth / 2 - reachIn / 2,
    side * (width / 2 - .01)), shape: "box", size: oriented(frame.along, .02, oriel.height, depth + reachIn),
  surface: "wood" });
  addFront(kit, { at, floor, frame, oriel, top });
  kit.add({ position: at(top + CAP / 2, (depth + .06) / 2 - reachIn / 2), shape: timber,
    size: oriented(frame.along, width + .08, CAP, depth + .06 + reachIn), surface: "wood" });
  return true;
};

type Frame = ReturnType<typeof spotFrame>;
type At = (y: number, reach: number, shift?: number) => Point3;

interface OrielFront { at: At; floor: number; frame: Frame; oriel: OrielSize; top: number }

/** The front: sill and head rails round a recessed dark opening, crossed by the lattice bars. */
const addFront = (kit: LevelKit, { at, floor, frame, oriel, top }: OrielFront) => {
  const { depth, width } = oriel, rail = .04, opening = top - floor - rail * 2, face = depth - .0125;
  for (const y of [floor + .035 + rail / 2, top - rail / 2]) kit.add({ position: at(y, face),
    shape: "box", size: oriented(frame.along, width - .04, rail, .025), surface: "wood" });
  const normal: Point3 = [0, 0, 0];
  normal[frame.axis] = frame.sign;
  const centreY = (floor + .035 + top) / 2, paneWidth = width - .04;
  addRoofVentWindow(kit, at(centreY, depth - .01), normal, paneWidth, opening - .035);
  const { columns, rows } = kit.detailed ? LATTICE.high : LATTICE.minimal;
  for (let column = 1; column <= columns; column++) kit.add({ position: at(centreY, depth,
    paneWidth * (column / (columns + 1) - .5)), shape: "box", size: oriented(frame.along, .012, opening, .012),
  surface: "wood" });
  const sill = floor + .035 + rail;
  for (let row = 1; row <= rows; row++) kit.add({ position: at(sill + (opening - .035) * row / (rows + 1), depth),
    shape: "box", size: oriented(frame.along, paneWidth, .012, .012), surface: "wood" });
};
