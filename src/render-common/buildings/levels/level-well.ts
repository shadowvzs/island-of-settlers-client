import type { BuildingPart, Point3 } from "../building-recipe";
import { getRomanPartBounds } from "../building-recipe-fit";
import type { BuildingLevel } from "./building-level";
import { addIndigenousWellCanopy } from "./indigenous-well-canopy";
import { boxOf, isFree, isInsidePlot, type LevelKit } from "./level-kit";

/**
 * The well has no walls or house roof: its levels dress the shaft and the windlass frame instead
 * (the shared well plan: shaft round (0, -0.15), posts at z -0.6 and +0.3, top beams at 1.18-1.24).
 */
const SHAFT = { blocks: 12, centreZ: -.15, radius: .4, top: .67 } as const;
const FRONT_POST = { radius: .06, z: .305 } as const;
const POSTS_Z = [-.6, .305] as const;
const BEAM_BOTTOM = 1.18;

/** Level 2: a dressed stone coping round the shaft's rim. */
const addCoping = (kit: LevelKit) => {
  for (let block = 0; block < SHAFT.blocks; block++) kit.add({ position: [0, SHAFT.top + .03, SHAFT.centreZ],
    rotation: [0, (block + .5) * Math.PI * 2 / SHAFT.blocks, 0], shape: "stone-arc", size: [.86, .06, .86],
    stage: 1, surface: "cut-stone", tint: [.8, .78, .74] });
};

/** Level 3: a glazed lantern on an iron bracket, on the front post's camera side. */
const addPostLantern = (kit: LevelKit) => {
  const y = .98, x = FRONT_POST.radius;
  kit.add({ position: [x + .08, y, FRONT_POST.z], shape: "box", size: [.17, .022, .022], surface: "iron" });
  const lampTop = y - .011, lamp: Point3 = [x + .13, lampTop - .055, FRONT_POST.z];
  kit.add({ position: lamp, shape: "box", size: [.07, .11, .07], surface: "amber", nightLamp: true });
  kit.add({ position: [lamp[0], lampTop + .02, lamp[2]], radialSegments: 4, rotation: [0, Math.PI / 4, 0],
    shape: "cone", size: [.11, .05, .11], surface: "iron" });
};

/** Level 4: knee braces from both posts up to the top beams, stiffening the windlass frame. */
const addKneeBraces = (kit: LevelKit) => {
  const rise = .22, run = .22, length = Math.hypot(rise, run), angle = Math.atan2(rise, run);
  for (const z of POSTS_Z) for (const side of [-1, 1]) kit.add({
    position: [side * (FRONT_POST.radius + run / 2 - .01), BEAM_BOTTOM - rise / 2 + .005, z],
    rotation: [0, 0, side * angle], shape: kit.detailed ? "bevel-box" : "box", size: [length, .04, .045],
    stage: 2, surface: "wood" });
};

/** Non-Roman curbs vary in height and plan: copy their real highest course, never a fixed ring. */
const addNationalCoping = (kit: LevelKit) => {
  const before = kit.added.length;
  const curb = kit.site.parts.filter(part => !part.stock &&
    ["stone", "cut-stone", "plaster", "wood", "bark"].includes(part.surface) &&
    ["box", "bevel-box", "stone-block", "ring", "stone-arc", "persian-room", "cylinder"].includes(part.shape) &&
    Math.abs(part.position[0]) < .5 && Math.abs(part.position[2] + .15) < .5 &&
    part.size[0] < 1 && part.size[2] < 1 && getRomanPartBounds(part).max[1] <= .8);
  const top = Math.max(0, ...curb.map(part => getRomanPartBounds(part).max[1]));
  const timber = ["viking", "japanese", "indigenous"].includes(kit.site.nation);
  for (const part of curb.filter(part => getRomanPartBounds(part).max[1] >= top - .015))
    kit.add({ ...part, position: [part.position[0], top + .025, part.position[2]],
      size: [part.size[0] + .008, .05, part.size[2] + .008],
      surface: timber ? "wood" : "cut-stone", stage: 2 });
  if (kit.added.length === before) addNationalWaterStand(kit);
};

/** Grounded yard additions avoid assumptions about the national canopy's posts and beams. */
const nationalYardSpot = (kit: LevelKit, size: Point3): Point3 | null => {
  // Indigenous operators stand at (-.205, .64) world cells and collect at (-.25, .55).
  // The former front-left lamp intersected their body; the rear apron clears the complete
  // crank/pickup/carry workspace without moving its canonical contacts or water stock.
  const depths = kit.site.nation === "indigenous" ? [-.82, -1.02, -.66] : [.78, 1, .52, -.78, -.95];
  for (const z of depths) for (const x of [-.40, -.22, .39]) {
    if (z > .4 && Math.abs(x) < .28) continue;
    const centre: Point3 = [x, size[1] / 2, z], box = boxOf(centre, size);
    if (isInsidePlot(kit.site, box) && isFree(kit.site, box, .012)) return centre;
  }
  return null;
};

const addNationalLamp = (kit: LevelKit) => {
  const spot = nationalYardSpot(kit, [.14, .77, .14]);
  if (!spot) return;
  const [x, , z] = spot;
  kit.add({ position: [x, .32, z], shape: "bevel-box", size: [.055, .64, .055], surface: "wood" });
  kit.add({ position: [x, .665, z], shape: "box", size: [.09, .10, .09], surface: "amber", nightLamp: true });
  kit.add({ position: [x, .735, z], shape: "cone", size: [.14, .04, .14], surface: "iron" });
};

const addNationalWaterStand = (kit: LevelKit) => {
  const spot = nationalYardSpot(kit, [.18, .36, .18]);
  if (!spot) return;
  const [x, , z] = spot;
  kit.add({ position: [x, .075, z], shape: "bevel-box", size: [.18, .15, .18], surface: "wood" });
  kit.add({ position: [x, .245, z], shape: "clay-jar", size: [.14, .19, .14], surface: "plaster" });
  kit.add({ position: [x, .345, z], shape: "cylinder", size: [.07, .02, .07], surface: "wood" });
};

const TROUGH = { height: .16, length: .36, rim: .022, width: .16 } as const;
/** Nations whose level 5 well adds a drinking trough (formerly a flag marker; owner rule 2026-11-08). */
const TROUGH_SURFACE: Readonly<Partial<Record<LevelKit["site"]["nation"], BuildingPart["surface"]>>> = {
  indigenous: "bark", maya: "cut-stone", viking: "wood"
};

/** Level 5: a drinking trough filled from the well, its water held inside a raised rim on two sleepers. */
const addWellTrough = (kit: LevelKit) => {
  const surface = TROUGH_SURFACE[kit.site.nation];
  if (!surface) return;
  const spot = troughSpot(kit);
  if (spot) buildTrough(kit, spot.at, spot.alongX, surface);
};

/** Plan grid the trough spot search walks (camera side first). */
const TROUGH_GRID = { step: .06, x: .42, z: 1.02 } as const;
/** Front operator lane of the shared well plan (the windlass crank and the carriers' pickup). */
const OPERATOR_LANE = { x: .28, z: .4 } as const;

/**
 * An open ground spot for the trough, either orientation: off the front operator lane (Indigenous:
 * behind the shaft only, as their operators work the front apron) and clear of the well and stock.
 */
const troughSpot = (kit: LevelKit) => {
  const rearOnly = kit.site.nation === "indigenous";
  for (let z = TROUGH_GRID.z; z >= -TROUGH_GRID.z; z -= TROUGH_GRID.step)
    for (let x = TROUGH_GRID.x; x >= -TROUGH_GRID.x; x -= TROUGH_GRID.step) {
      if (rearOnly ? z > -.6 : z > OPERATOR_LANE.z && Math.abs(x) < OPERATOR_LANE.x) continue;
      for (const alongX of [true, false]) {
        const size = troughSize(TROUGH.length + .02, TROUGH.height, TROUGH.width + .02, alongX);
        const box = boxOf([x, size[1] / 2, z], size);
        if (isInsidePlot(kit.site, box) && isFree(kit.site, box, .03)) return { alongX, at: [x, 0, z] as Point3 };
      }
    }
  return null;
};
/** A size given along the trough, up and across it, as a plan box size. */
const troughSize = (along: number, up: number, across: number, alongX: boolean): Point3 =>
  alongX ? [along, up, across] : [across, up, along];

const buildTrough = (kit: LevelKit, [x, , z]: Point3, alongX: boolean, surface: BuildingPart["surface"]) => {
  const { height, length, rim, width } = TROUGH, sleeper = .04, water = height - .02;
  const at = (along: number, y: number, across = 0): Point3 => alongX ? [x + along, y, z + across]
    : [x + across, y, z + along];
  for (const side of [-1, 1]) kit.add({ position: at(side * (length / 2 - .06), sleeper / 2), shape: "box",
    size: troughSize(.05, sleeper, width + .02, alongX), surface: "wood" });
  kit.add({ position: at(0, (sleeper + water) / 2), shape: kit.detailed ? "bevel-box" : "box",
    size: troughSize(length, water - sleeper, width, alongX), surface });
  kit.add({ position: at(0, water + .002), shape: "box", size: troughSize(length - rim * 2, .004, width - rim * 2,
    alongX), surface: "feed-water" });
  for (const side of [-1, 1]) {
    kit.add({ position: at(0, (water + height) / 2, side * (width - rim) / 2), shape: "box",
      size: troughSize(length, height - water, rim, alongX), surface });
    kit.add({ position: at(side * (length - rim) / 2, (water + height) / 2), shape: "box",
      size: troughSize(rim, height - water, width - rim * 2, alongX), surface });
  }
};

/** What each level adds to a well. */
export const WELL_LEVEL_STEPS: Readonly<Record<Exclude<BuildingLevel, 1>, (kit: LevelKit) => void>> = {
  2: kit => {
    if (kit.site.nation === "indigenous") { addIndigenousWellCanopy(kit); return; }
    if (kit.site.nation === "roman") { addCoping(kit); return; }
    addNationalCoping(kit);
  },
  3: kit => kit.site.nation === "roman" ? addPostLantern(kit) : addNationalLamp(kit),
  4: kit => kit.site.nation === "roman" ? addKneeBraces(kit) : addNationalWaterStand(kit),
  5: addWellTrough
};
