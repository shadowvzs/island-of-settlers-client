import { DMath } from "../../shared/math/deterministic-math";
import { HEADQUARTERS_TYPE_ID } from "../../shared/settlement/building-type-ids";
import type { Point3 } from "./building-recipe";
import type { RoofEnvelope, WallRun } from "./nation-kit-classify";
import {
  alongWall, envelopeCenter, envelopeSize,   type KitContext,
meetsCorner, onWall, runBetween, timberDoorFrame, wallNormal} from "./nation-kit-parts";
import { addShingledSlab, shingledSlopeYaw } from "./nation-roof-shingles";
import { gableDragon } from "./viking-gable-dragon";

/**
 * Owner 2026-10-13: the Viking HQ is a great mead hall with a stave tower crowned by Thor
 * (viking-headquarters.ts). Rollback: false restores the previous kit-built HQ (pavilion roof on the
 * Roman colonnade, turned finials instead of gable dragons, no Thor).
 */
export const VIKING_GREAT_HALL_HQ = true;

/** The previous kit-built Viking HQ, kept for rollback. */
export const isPreviousVikingHq = (typeId: number) => typeId === HEADQUARTERS_TYPE_ID && !VIKING_GREAT_HALL_HQ;

const LOG_COURSE = .12;
const LOG_DIAMETER = .13;
const BATTEN_SPACING = .22;
const LOG_OVERHANG = .07;
/** Roof boards stay this far inside the Roman roof outline (the plot envelope). */
const BOARD_INSET = .05;

/** Corner overhang of a log course: only on long walls meeting a corner, inside the plot envelope. */
const logOverhang = (context: KitContext, wall: WallRun, end: 0 | 1) => {
  if (wall.length < .5 || !meetsCorner(wall, context.walls, end)) return 0;
  const tip = Math.abs(end ? wall.max[wall.along]! : wall.min[wall.along]!);
  const extent = wall.along === 0 ? context.limit.extentX : context.limit.extentZ;
  return Math.max(0, Math.min(LOG_OVERHANG, extent - tip - .005));
};

/** Small huts are notched log houses; larger halls are stave-built from upright planks on a sill. */
export const vikingWall = (context: KitContext, wall: WallRun, logBuilt: boolean) => {
  const { add, center, detailed } = context, normal = wallNormal(wall, center);
  if (logBuilt) {
    // Logs overhang only where walls meet at a corner, never into a doorway or wall opening.
    const start = logOverhang(context, wall, 0), end = logOverhang(context, wall, 1);
    const t = (end - start) / 2 / wall.length + .5, offset = wall.along === 0 ? 0 : LOG_COURSE / 2;
    for (let y = wall.base + .06 + offset; y < wall.base + wall.height - LOG_COURSE / 3; y += LOG_COURSE)
      add({ position: onWall(wall, center, t, y), rotation: wall.along === 0 ? [0, 0, Math.PI / 2] : [Math.PI / 2, 0, 0],
        shape: "cylinder", size: [LOG_DIAMETER, wall.length + start + end, LOG_DIAMETER], stage: 1, surface: "bark" });
    return;
  }
  add({ position: onWall(wall, center, .5, wall.base + wall.height / 2), shape: "box",
    size: alongWall(wall, wall.length, wall.height, normal.thickness), stage: 1, surface: "planks" });
  if (wall.base < .1) add({ position: onWall(wall, center, .5, .06, .02), shape: "bevel-box",
    size: alongWall(wall, wall.length + .06, .12, normal.thickness + .06), stage: 1, surface: "stone" });
  if (!detailed || context.lean) return;
  const battens = Math.max(1, Math.round(wall.length / BATTEN_SPACING));
  for (let index = 0; index <= battens; index++) add({ position: onWall(wall, center, index / battens,
    wall.base + wall.height / 2, normal.thickness / 2 + .01), shape: "box", size: alongWall(wall, .035, wall.height, .025),
  stage: 2, surface: "wood" });
};

/** Ridge axis, eave, rise and a point helper (`along` the ridge, `across` it) of a Viking roof. */
export const vikingRoofFrame = (roof: RoofEnvelope) => {
  const size = envelopeSize(roof), base = envelopeCenter(roof);
  const alongX = size.width >= size.depth, length = alongX ? size.width : size.depth;
  const run = (alongX ? size.depth : size.width) / 2, rise = roof.rise ?? Math.min(.75, Math.max(.35, run));
  const at = (along: number, across: number, y: number): Point3 =>
    alongX ? [base[0] + along, y, base[2] + across] : [base[0] + across, y, base[2] + along];
  return { alongX, at, eave: base[1], length, rise, run, slope: DMath.atan2(rise, run) };
};

/**
 * Steep shingled gable along the long side: stepped shingle courses (High), plank gable ends, ridge,
 * crossed boards with dragon heads (main roof) or turned finials.
 */
export const vikingRoof = (context: KitContext, roof: RoofEnvelope, main = true, minimalFinials = false) => {
  const { add, detailed } = context;
  const { alongX, at, eave, length, rise, run, slope } = vikingRoofFrame(roof), slab = DMath.hypot(rise, run);
  for (const side of [-1, 1]) addShingledSlab(add, { bare: BOARD_INSET + .04,
    centre: at(0, side * run / 2, eave + rise / 2), depth: slab - .1, length, slope,
    yaw: shingledSlopeYaw(alongX, side) }, detailed);
  for (const end of [-1, 1]) add({ position: at(end * (length / 2 - .06), 0, eave + rise / 2 - .02),
    rotation: alongX ? [0, Math.PI / 2, 0] : undefined, shape: "gable", size: [run * 2 - .05, rise - .04, .08],
    stage: 3, surface: "planks" });
  add({ position: at(0, 0, eave + rise + .04), rotation: alongX ? [0, 0, Math.PI / 2] : [Math.PI / 2, 0, 0],
    roofSupport: true, shape: "cylinder", size: [.11, length - .04, .11], stage: 4, surface: "bark" });
  const past = .26;
  for (const end of [-1, 1]) for (const side of [-1, 1]) {
    const foot = at(end * (length / 2 - BOARD_INSET), side * (run - BOARD_INSET), eave + .04);
    const tip = at(end * (length / 2 - BOARD_INSET), -side * past * DMath.cos(slope), eave + rise + past * DMath.sin(slope) + .06);
    runBetween(add, foot, tip, [.045, .07], { shape: "bevel-box", surface: "wood" });
    // The main roof's boards end in carved dragon heads; Minimal leaves the lesser roofs plain.
    if (main) add(gableDragon(foot, tip));
    else if (detailed || minimalFinials) add({ position: [tip[0], tip[1] + .05, tip[2]], shape: "cone", size: [.06, .12, .06], stage: 4,
      surface: "wood" });
  }
  if (!detailed || context.lean) return;
  add({ position: at(0, 0, eave + rise + .06), rotation: alongX ? [0, 0, Math.PI / 2] : [Math.PI / 2, 0, 0],
    shape: "cylinder", size: [.19, length, .19], stage: 4, surface: "roof" });
};

export const vikingDoor = (context: KitContext) => timberDoorFrame(context.add, context.door, "wood");
