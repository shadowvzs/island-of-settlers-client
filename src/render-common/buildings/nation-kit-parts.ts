import { DMath } from "../../shared/math/deterministic-math";
import type { BuildingPart, BuildingRecipe, Point3 } from "./building-recipe";
import type { RoofEnvelope, WallRun } from "./nation-kit-classify";

/** Roman masonry surfaces, which each nation rebuilds in its own material. */
export const MASONRY_SURFACES: ReadonlySet<string> = new Set(["stone", "plaster", "cut-stone"]);

export type Add = (part: Omit<BuildingPart, "stage"> & { stage?: number }) => void;
export interface DoorGap { left: number; right: number; spring: number; top: number; z: number }
export interface KitContext {
  add: Add; detailed: boolean; door: DoorGap; center: Point3; walls: readonly WallRun[];
  /** High quality on an already prop-heavy building: signature features only, no minor extras. */
  lean: boolean;
  typeId: number;
  tower: boolean;
  /** Half extents of the original plot envelope, never to be exceeded. */
  limit: { extentX: number; extentZ: number };
}

export const doorGapOf = (recipe: BuildingRecipe): DoorGap => {
  const width = recipe.doorDimensions?.width ?? .46;
  return { left: recipe.door[0], right: recipe.door[0] + width, spring: recipe.doorDimensions?.spring ?? .63,
    top: recipe.doorDimensions?.height ?? .77, z: recipe.door[2] };
};

/** Plan centre of the walls: tells each wall which side is outdoors. */
export const bodyCenter = (walls: readonly WallRun[]): Point3 => {
  if (!walls.length) return [0, 0, 0];
  const xs = walls.flatMap(wall => [wall.min[0], wall.max[0]]), zs = walls.flatMap(wall => [wall.min[2], wall.max[2]]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, 0, (Math.min(...zs) + Math.max(...zs)) / 2];
};

const wallMid = (wall: WallRun): Point3 =>
  [(wall.min[0] + wall.max[0]) / 2, (wall.min[1] + wall.max[1]) / 2, (wall.min[2] + wall.max[2]) / 2];

/** Axis across the wall and the sign that points outdoors. */
export const wallNormal = (wall: WallRun, center: Point3) => {
  const axis = wall.along === 0 ? 2 : 0, mid = wallMid(wall);
  return { axis, sign: mid[axis]! >= center[axis]! ? 1 : -1, thickness: wall.max[axis]! - wall.min[axis]! };
};

/** A point on the wall: `t` 0…1 along it, `y` absolute, `offset` outward from its centre plane. */
export const onWall = (wall: WallRun, center: Point3, t: number, y: number, offset = 0): Point3 => {
  const mid = wallMid(wall), normal = wallNormal(wall, center), point: Point3 = [mid[0], y, mid[2]];
  point[wall.along] = wall.min[wall.along]! + wall.length * t;
  point[normal.axis] = mid[normal.axis]! + normal.sign * offset;
  return point;
};

/** True when another wall meets this wall's end at a right angle: a real building corner. */
export const meetsCorner = (wall: WallRun, walls: readonly WallRun[], end: 0 | 1) => {
  const tip = end ? wall.max[wall.along]! : wall.min[wall.along]!, across = wall.along === 0 ? 2 : 0;
  const line = (wall.min[across]! + wall.max[across]!) / 2;
  return walls.some(other => other !== wall && other.along !== wall.along &&
    tip >= other.min[wall.along]! - .1 && tip <= other.max[wall.along]! + .1 &&
    line >= other.min[across]! - .1 && line <= other.max[across]! + .1);
};

/** A box whose long side runs along the wall. */
export const alongWall = (wall: WallRun, length: number, height: number, depth: number): Point3 =>
  wall.along === 0 ? [length, height, depth] : [depth, height, length];

/** A straight run between two points (ridge or hip tiles, boards). */
export const runBetween = (add: Add, from: Point3, to: Point3, size: [number, number], part: Partial<BuildingPart>) => {
  const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2], horizontal = DMath.hypot(dx, dz);
  add({ position: [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2],
    rotation: [DMath.atan2(-dy, horizontal), DMath.atan2(dx, dz), 0], shape: "box",
    size: [size[0], size[1], DMath.hypot(horizontal, dy) + .01], stage: 4, surface: "roof", ...part });
};

/** Square timber door frame around the shared arched leaf (posts outside the clear opening). */
export const timberDoorFrame = (add: Add, door: DoorGap, surface: BuildingPart["surface"]) => {
  for (const x of [door.left - .035, door.right + .035]) add({ position: [x, door.top / 2 + .05, door.z + .02],
    shape: "bevel-box", size: [.07, door.top + .1, .09], stage: 2, surface });
  add({ position: [(door.left + door.right) / 2, door.top + .07, door.z + .02], shape: "bevel-box",
    size: [door.right - door.left + .2, .1, .1], stage: 2, surface });
};

const WINDOW_FRAME_WIDTH = .035;
/** The sill stands a little prouder than the rest of the frame. */
const WINDOW_SILL_PROJECTION = .015;

/**
 * Timber frame round a window pane on a wall (`along` 0: x, 2: z): jambs, head and a sill, their
 * backs on the wall face, `depth` signed outward. The pane sits recessed inside the frame.
 */
export const timberWindowFrame = (add: Add, pane: BuildingPart, along: 0 | 2, face: number, depth: number) => {
  const across = along === 0 ? 2 : 0, width = pane.size[along]!, height = pane.size[1];
  const member = (offset: number, y: number, length: number, tall: number, proud = 0) => {
    const position: Point3 = [...pane.position], size: Point3 = [0, tall, 0];
    position[along] += offset;
    position[1] = y;
    position[across] = face + (depth + Math.sign(depth) * proud) / 2;
    size[along] = length;
    size[across] = Math.abs(depth) + proud;
    add({ position, shape: "box", size, stage: 2, surface: "wood" });
  };
  const jambHeight = height + 2 * WINDOW_FRAME_WIDTH;
  for (const side of [-1, 1])
    member(side * (width + WINDOW_FRAME_WIDTH) / 2, pane.position[1], WINDOW_FRAME_WIDTH, jambHeight);
  member(0, pane.position[1] + (height + WINDOW_FRAME_WIDTH) / 2, width, WINDOW_FRAME_WIDTH);
  member(0, pane.position[1] - (height + WINDOW_FRAME_WIDTH) / 2, width + WINDOW_FRAME_WIDTH, WINDOW_FRAME_WIDTH,
    WINDOW_SILL_PROJECTION);
};

export const envelopeSize = (roof: RoofEnvelope) =>
  ({ depth: roof.max[2] - roof.min[2], height: roof.max[1] - roof.min[1], width: roof.max[0] - roof.min[0] });

export const envelopeCenter = (roof: RoofEnvelope): Point3 =>
  [(roof.min[0] + roof.max[0]) / 2, roof.min[1], (roof.min[2] + roof.max[2]) / 2];

/**
 * True when a kept part lies within a roof volume (Roman gable infill under the old roof). Parts
 * rising above it, like a cupola's columns standing on a lower roof, are structure and stay.
 */
export const insideRoof = (part: BuildingPart, roofs: readonly RoofEnvelope[], bounds: { min: Point3; max: Point3 }) =>
  roofs.some(roof => bounds.min[1] >= roof.min[1] - .02 && bounds.max[1] <= roof.max[1] + .05 &&
    part.position[0] > roof.min[0] && part.position[0] < roof.max[0] &&
    part.position[2] > roof.min[2] && part.position[2] < roof.max[2]);
