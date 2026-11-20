import type { BuildingSurface, Point3 } from "../building-recipe";
import { type LevelKit, roofHalves, slopePoint } from "./level-kit";
import {
  addGableEnd, addSmallGableRoof, isRoofSpotFree, liftTilesUnder, ridgeAxisOf, SMALL_ROOF_PITCH
} from "./level-roof-pieces";
import { addOpenDormerBody, addRoofVentWindow } from "./level-roof-vent";

/** Each nation's dormer: wall and gable material, window dressing and the ornament on its gable. */
export interface DormerStyle {
  wall: BuildingSurface;
  gable: BuildingSurface;
  window: "shuttered" | "lattice" | "framed" | "louvered";
  ornament?: (kit: LevelKit, apex: Point3, facing: Point3) => void;
}

/** The dormer stands on the slope facing the usual camera (front or east), off the roof centre. */
const ALONG_SHARE = -.35;
const FRONT_T = .7;
/** Dormer widths tried in turn: a shallow or short slope takes the narrow one. */
const WIDTHS = [.34, .26];
const MAX_WALL = .26;
const MIN_WALL = .12;

/** Rise of the main roof per unit run across the ridge, measured on the dressed roof. */
const mainSlope = (kit: LevelKit, along: number) => {
  const high = slopePoint(kit.site, along, 1, .3), low = slopePoint(kit.site, along, 1, .7);
  if (!high || !low) return null;
  const run = Math.hypot(high[0] - low[0], high[2] - low[2]);
  return run > 0 ? (high[1] - low[1]) / run : null;
};

const addWindow = (kit: LevelKit, style: DormerStyle, centre: Point3, out: Point3, size: number) => {
  const pane: Point3 = [centre[0] + out[0] * .012, centre[1], centre[2] + out[2] * .012];
  const flat = (width: number, height: number): Point3 => out[0] ? [.012, height, width] : [width, height, .012];
  if (style.window === "louvered") {
    addRoofVentWindow(kit, centre, out, size, size, true);
    return;
  }
  addRoofVentWindow(kit, centre, out, size, size);
  if (!kit.detailed) return;
  if (style.window === "lattice") {
    for (const offset of [-1, 0, 1]) {
      const bar: Point3 = [pane[0] + out[0] * .006, pane[1], pane[2] + out[2] * .006];
      bar[out[0] ? 2 : 0] += offset * size / 3.2;
      kit.add({ position: bar, shape: "box", size: flat(.012, size), stage: 4, surface: "wood" });
    }
    return;
  }
  const sill: Point3 = [pane[0] + out[0] * .02, pane[1] - size / 2 - .015, pane[2] + out[2] * .02];
  kit.add({ position: sill, shape: "box", size: out[0] ? [.05, .03, size + .06] : [size + .06, .03, .05], stage: 4,
    surface: style.window === "framed" ? "cut-stone" : "wood" });
  if (style.window !== "shuttered") return;
  for (const side of [-1, 1]) {
    const leaf: Point3 = [pane[0] + out[0] * .01, pane[1], pane[2] + out[2] * .01];
    if (out[0]) leaf[2] += side * (size * .75 + .01);
    else leaf[0] += side * (size * .75 + .01);
    kit.add({ position: leaf, shape: "bevel-box", size: flat(size / 2, size + .02), stage: 4, surface: "wood",
      tint: [.42, .58, .46] });
  }
};

/**
 * Level 4 dormer on the main roof: walls rising from the slope back until they meet the roof, a
 * pitched roof of its own running into the main slope, a window and the nation's gable ornament.
 * `alongShare` places it along the ridge (a share of the roof's half length).
 */
export const addDormer = (kit: LevelKit, style: DormerStyle, alongShare = ALONG_SHARE) => {
  const roof = kit.site.roof;
  if (!roof || roof.ridgeAxis === null) return;
  const axis = ridgeAxisOf(kit), across = axis === 0 ? 2 : 0, along = roofHalves(kit.site).along * alongShare;
  const slope = mainSlope(kit, along), front = slopePoint(kit.site, along, 1, FRONT_T);
  if (!slope || slope < .3 || !front) return;
  const reach = Math.abs(front[across]! - roof.centre[across]!) - .08;
  const fit = WIDTHS.map(width => {
    const rise = Math.tan(SMALL_ROOF_PITCH) * (width / 2 + .04);
    return { rise, wall: Math.min(MAX_WALL, reach * slope - rise - .02), width };
  }).find(option => option.wall >= MIN_WALL);
  if (!fit) return;
  const { rise, wall, width } = fit;
  const depth = (wall + rise) / slope + .04, out: Point3 = [0, 0, 0];
  out[across] = Math.sign(front[across]! - roof.centre[across]!) || 1;
  const centre: Point3 = [...front];
  centre[across] -= out[across]! * depth / 2;
  const bottom = front[1] - .03, eave = front[1] + wall;
  const bodySize: Point3 = across === 2 ? [width, eave - bottom, depth] : [depth, eave - bottom, width];
  if (!isRoofSpotFree(kit, [centre[0], (bottom + eave + rise) / 2, centre[2]],
    [bodySize[0] + .1, eave + rise - bottom, bodySize[2] + .1], front[1])) return;
  liftTilesUnder(kit, [centre[0], (bottom + eave) / 2, centre[2]], bodySize);
  const opening = Math.min(.16, wall * .7);
  addOpenDormerBody(kit, front, out, bottom, eave, width, depth, opening, style.wall);
  addSmallGableRoof(kit, centre, across as 0 | 2, { eave, length: depth + .08, width: width });
  const face: Point3 = [...front];
  face[across] += out[across]! * .005;
  addGableEnd(kit, [face[0], eave, face[2]], across as 0 | 2, width, rise, { stage: 4, surface: style.gable });
  addWindow(kit, style, [front[0], front[1] + wall * .5, front[2]], out, opening);
  style.ornament?.(kit, [front[0], eave + rise, front[2]], out);
};
