import { srgbToLinear } from "../../color";
import type { WorkerNation } from "../../workers/worker-unit";
import type { Point3 } from "../building-recipe";
import { getRomanPartBounds } from "../building-recipe-fit";
import { stoneLanternParts } from "../japanese-stone-lantern";
import type { WallRun } from "../nation-kit-classify";
import {
  type Box, boxOf, groundWalls, isFree, isInsidePlot, type LevelKit, type LevelPart, onWallFace, wallFace
} from "./level-kit";
import { isLeanPiece } from "./level-lean";
import { type OccupationFamily, occupationFamily, OPEN_YARD_IDS } from "./level-occupation";

/** One yard prop: its plan footprint (along the wall, out from it), height and parts at a ground point. */
export interface YardProp {
  size: [number, number, number];
  build: (kit: LevelKit, at: Point3, alongX: boolean) => LevelPart[];
}

const TERRACOTTA = srgbToLinear(.74, .4, .24);
const LEAN = 6;

const crates: YardProp = { size: [.3, .36, .26], build: (_kit, [x, , z]) => [
  { position: [x - .02, .11, z], shape: "bevel-box", size: [.24, .22, .22], surface: "wood" },
  { position: [x + .03, .29, z + .01], rotation: [0, .35, 0], shape: "bevel-box", size: [.16, .14, .15], surface: "wood" }
] };

const barrels: YardProp = { size: [.42, .3, .22], build: (_kit, [x, , z], alongX) => [-1, 1].map(side => ({
  position: [x + (alongX ? side * .1 : 0), .13, z + (alongX ? 0 : side * .1)], radialSegments: LEAN,
  shape: "barrel", size: [.18, .27, .18], surface: "wood" }) satisfies LevelPart) };

const sacks: YardProp = { size: [.36, .24, .22], build: (_kit, [x, , z], alongX) => [-1, 1].map(side => ({
  position: [x + (alongX ? side * .09 : 0), .11, z + (alongX ? 0 : side * .09)], rotation: [0, side * .4, 0],
  shape: "sack", size: [.17, .22, .15], surface: "sacking" }) satisfies LevelPart) };

/** Three logs stacked two-and-one, lying along the wall. */
const logs: YardProp = { size: [.46, .2, .24], build: (_kit, [x, , z], alongX) => {
  const rotation: Point3 = alongX ? [0, 0, Math.PI / 2] : [Math.PI / 2, 0, 0];
  const at = (across: number, y: number): Point3 => alongX ? [x, y, z + across] : [x + across, y, z];
  return [[-.055, .05], [.055, .05], [0, .14]].map(([across, y]) => ({ position: at(across!, y!), rotation,
    shape: "cylinder", size: [.1, .42, .1], surface: "bark" }) satisfies LevelPart);
} };

const stones: YardProp = { size: [.36, .26, .2], build: (_kit, [x, , z], alongX) => [
  { position: [x - (alongX ? .08 : 0), .08, z - (alongX ? 0 : .08)], shape: "stone-block", size: [.17, .16, .16],
    surface: "stone" },
  { position: [x + (alongX ? .1 : 0), .065, z + (alongX ? 0 : .1)], shape: "stone-block", size: [.14, .13, .15],
    surface: "stone" }
] };

const coal: YardProp = { size: [.32, .16, .28], build: (_kit, [x, , z]) => [
  { position: [x, .05, z], shape: "rock", size: [.3, .13, .26], surface: "dark" },
  { position: [x + .04, .1, z - .02], shape: "rock", size: [.16, .1, .14], surface: "dark" }
] };

/** A spear rack: two posts, a rail and three spears with iron heads. */
const spears: YardProp = { size: [.34, .5, .12], build: (kit, [x, , z], alongX) => {
  const at = (along: number, y: number): Point3 => alongX ? [x + along, y, z] : [x, y, z + along];
  const rail: Point3 = alongX ? [.34, .03, .03] : [.03, .03, .34];
  const parts: LevelPart[] = [-1, 1].map(side => ({ position: at(side * .15, .17), shape: "box", size: [.04, .34, .04],
    surface: "wood" }) satisfies LevelPart);
  parts.push({ position: at(0, .3), shape: "box", size: rail, surface: "wood" });
  for (const along of kit.detailed ? [-.08, 0, .08] : [0]) {
    parts.push({ position: at(along, .24), shape: "cylinder", size: [.018, .46, .018], surface: "wood",
      radialSegments: 4 });
    parts.push({ position: at(along, .5), shape: "cone", size: [.035, .07, .035], surface: "iron", radialSegments: 4 });
  }
  return parts;
} };

/** A stretched hide on a little drying frame. */
const hideFrame: YardProp = { size: [.36, .42, .1], build: (_kit, [x, , z], alongX) => {
  const at = (along: number, y: number): Point3 => alongX ? [x + along, y, z] : [x, y, z + along];
  return [
    ...[-1, 1].map(side => ({ position: at(side * .16, .2), shape: "box", size: [.035, .4, .035],
      surface: "wood" }) satisfies LevelPart),
    { position: at(0, .38), shape: "box", size: alongX ? [.36, .03, .03] : [.03, .03, .36], surface: "wood" },
    { position: at(0, .23), shape: "box", size: alongX ? [.26, .26, .012] : [.012, .26, .26], surface: "hide" }
  ];
} };

const saplings: YardProp = { size: [.36, .3, .16], build: (kit, [x, , z], alongX) =>
  (kit.detailed ? [-1, 0, 1] : [0]).flatMap(step => {
    const position: Point3 = alongX ? [x + step * .12, .05, z] : [x, .05, z + step * .12];
    return [
      { position, shape: "cylinder", size: [.1, .1, .1], surface: "paint", tint: TERRACOTTA, radialSegments: LEAN },
      { position: [position[0], .17, position[2]], shape: "sphere", size: [.12, .16, .12], surface: "leaf",
        radialSegments: LEAN }
    ] satisfies LevelPart[];
  }) };

const amphorae: YardProp = { size: [.34, .3, .18], build: (_kit, [x, , z], alongX) => [-1, 1].map(side => ({
  position: [x + (alongX ? side * .08 : 0), .14, z + (alongX ? 0 : side * .08)], radialSegments: LEAN,
  shape: "clay-jar", size: [.15, .28, .15], surface: "paint", tint: TERRACOTTA }) satisfies LevelPart) };

const riceBales: YardProp = { size: [.4, .3, .2], build: (_kit, [x, , z], alongX) => [
  ...[-1, 1].map(side => ({ position: [x + (alongX ? side * .1 : 0), .08, z + (alongX ? 0 : side * .1)],
    radialSegments: LEAN, rotation: alongX ? [0, 0, Math.PI / 2] : [Math.PI / 2, 0, 0], shape: "rice-bale",
    size: [.17, .2, .17], surface: "straw" }) satisfies LevelPart),
  { position: [x, .24, z], radialSegments: LEAN, rotation: alongX ? [0, 0, Math.PI / 2] : [Math.PI / 2, 0, 0],
    shape: "rice-bale", size: [.16, .19, .16], surface: "straw" }
] };

export const nubianJars: YardProp = { size: [.34, .3, .2], build: (_kit, [x, , z], alongX) =>
  [-1, 1].map((side, index) => ({
  decorVariant: index, position: [x + (alongX ? side * .08 : 0), .14 - index * .03, z + (alongX ? 0 : side * .08)],
  shape: "nubian-vase", size: [.16 - index * .03, .28 - index * .06, .16 - index * .03],
  surface: "nubian-decor" }) satisfies LevelPart) };

const stoneLantern: YardProp = { size: [.22, .5, .22], build: (kit, [x, , z]) => stoneLanternParts(x, z, kit.detailed) };

const FAMILY_PROPS: Readonly<Record<OccupationFamily, readonly YardProp[]>> = {
  fire: [coal, crates, barrels], food: [sacks, barrels, crates], guard: [spears, barrels, crates],
  home: [logs, barrels, crates], leather: [hideFrame, barrels, crates], stone: [stones, crates, barrels],
  store: [crates, barrels, sacks], timber: [logs, saplings, crates]
};

/** Each nation's own household goods replace the generic barrels; the tōrō leads every Japanese yard. */
const nationProps = (nation: WorkerNation, props: readonly YardProp[]) => {
  const own = { chinese: riceBales, persian: amphorae, maya: sacks, indigenous: hideFrame, japanese: riceBales, nubian: nubianJars, roman: amphorae, viking: barrels }[nation];
  const swapped = props.map(prop => prop === barrels ? own : prop);
  return nation === "japanese" ? [stoneLantern, ...swapped] : swapped;
};

/** Half widths of the worker lane through the door and of the carriers' service lane beside it. */
const DOOR_LANE = .42;
const SERVICE_LANE = .32;
/** Props stand clear of the plinth: tight where it is slim, further out past a Viking footing. */
const PLINTH_STANDOFFS = [.05, .09];
/** Work and exit points keep this much free ground round them. */
const STANDING_CLEARANCE = .4;
const STOCK_CLEARANCE = .32;
/** The carriers' handoff stands this far (fitted grid units) beside the door lane. */
const HANDOFF_OFFSET = .42;

const nearStock = (kit: LevelKit, at: Point3) => kit.site.parts.some(part => {
  if (!part.stock) return false;
  const { max, min } = getRomanPartBounds(part);
  const dx = Math.max(min[0] - at[0], 0, at[0] - max[0]), dz = Math.max(min[2] - at[2], 0, at[2] - max[2]);
  return Math.hypot(dx, dz) < STOCK_CLEARANCE;
});

/**
 * Ground in front of the façade is open only off the door lane and the carriers' service lane
 * (createBuildingLogisticsAnchors), and clear of the worker's exit and work points.
 */
export const blocksTraffic = (kit: LevelKit, box: Box, clearance = STANDING_CLEARANCE) => {
  const { door, recipe } = kit.site, centre = (door.left + door.right) / 2;
  const standing = [recipe.workerExit, recipe.workPoint].some(point =>
    Math.max(box.min[0] - point[0], 0, point[0] - box.max[0]) ** 2 +
    Math.max(box.min[2] - point[2], 0, point[2] - box.max[2]) ** 2 < clearance ** 2);
  if (standing) return true;
  if (box.max[2] < door.z - .05) return false;
  const side = recipe.workerExit[0] >= 0 ? -1 : 1, service = centre + side * HANDOFF_OFFSET / kit.site.scale;
  const crosses = (middle: number, half: number) => box.max[0] > middle - half && box.min[0] < middle + half;
  return crosses(centre, DOOR_LANE) || crosses(service, SERVICE_LANE);
};

/** A ground spot against `wall` at fraction `t`, `standoff` out from its face; `at` is the prop's centre. */
export interface YardSpot { at: Point3; alongX: boolean; facing: number; standoff: number; t: number; wall: WallRun }

/** Ground spots against the walls, open on every side, inside the plot and away from the door and stock. */
export const findYardSpots = (kit: LevelKit, size: YardProp["size"], taken: readonly Point3[] = [],
  standoffs: readonly number[] = PLINTH_STANDOFFS) => {
  const spots: YardSpot[] = [];
  for (const wall of groundWalls(kit.site, .4)) for (const t of [.12, .3, .5, .7, .88]) {
    const spot = spotOnWall(kit, wall, t, size, standoffs);
    if (!spot) continue;
    if (taken.some(point => Math.hypot(point[0] - spot.at[0], point[2] - spot.at[2]) < .45)) continue;
    spots.push(spot);
  }
  return spots.sort((a, b) => b.facing - a.facing);
};

const spotOnWall = (kit: LevelKit, wall: WallRun, t: number, propSize: YardProp["size"],
  standoffs: readonly number[]): YardSpot | null => {
  const { axis, face, sign } = wallFace(kit.site, wall);
  const [along, height, depth] = propSize;
  const size: Point3 = wall.along === 0 ? [along, height, depth] : [depth, height, along];
  // The wall it leans on (and what lies behind its face) never blocks it.
  const behindFace = (bounds: Box) => sign > 0 ? bounds.max[axis]! <= face + .08 : bounds.min[axis]! >= face - .08;
  for (const standoff of standoffs) {
    const at = onWallFace(kit.site, wall, t, 0, depth / 2 + standoff);
    const box = boxOf([at[0], height / 2 + .01, at[2]], size);
    if (!isInsidePlot(kit.site, box) || !isFree(kit.site, box, .02, behindFace) || nearStock(kit, at) ||
      blocksTraffic(kit, box)) continue;
    // Spots facing the usual camera (south-east) read best.
    return { alongX: wall.along === 0, at, facing: axis === 2 ? sign * .8 : sign * .6, standoff, t, wall };
  }
  return null;
};

/**
 * The best open ground spot against a wall for something of this size (along, height, out);
 * `standoffs` lets tall pieces stand further out, clear of the eaves.
 */
export const findYardSpot = (kit: LevelKit, size: YardProp["size"], standoffs?: readonly number[]) =>
  findYardSpots(kit, size, [], standoffs)[0] ?? null;

/** Prop groups on High and Minimal, full and lean. */
const YARD_GROUPS = { high: [3, 1], minimal: [1, 0] } as const;

/** Level 4 yard goods of the trade, in the nation's own containers (Minimal keeps one group). */
export const addYardProps = (kit: LevelKit) => {
  if (OPEN_YARD_IDS.has(kit.site.definition.id)) return;
  const props = nationProps(kit.site.nation, FAMILY_PROPS[occupationFamily(kit.site.definition)]);
  const taken: Point3[] = [];
  const groups = (kit.detailed ? YARD_GROUPS.high : YARD_GROUPS.minimal)[isLeanPiece(kit.site, "yard-props") ? 1 : 0];
  for (const prop of props.slice(0, groups)) {
    const spot = findYardSpots(kit, prop.size, taken)[0];
    if (!spot) continue;
    taken.push(spot.at);
    for (const part of prop.build(kit, spot.at, spot.alongX)) kit.add({ stage: 3, ...part });
  }
};
