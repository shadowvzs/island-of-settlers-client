import type { BuildingPart, Point3 } from "../building-recipe";
import { getRomanPartBounds } from "../building-recipe-fit";
import type { WallRun } from "../nation-kit-classify";
import { meetsCorner, onWall, wallNormal } from "../nation-kit-parts";
import type { LevelSite } from "./level-site";

export type LevelPart = Omit<BuildingPart, "stage"> & { stage?: number };
export interface Box { min: Point3; max: Point3 }

/** Collects one level's additions; `site.parts` already holds the building and earlier levels. */
export interface LevelKit {
  add: (part: LevelPart) => void;
  added: BuildingPart[];
  detailed: boolean;
  site: LevelSite;
}

export const createLevelKit = (site: LevelSite): LevelKit => {
  const added: BuildingPart[] = [];
  return { add: part => added.push({ stage: 3, compactGeometry: true, ...part }), added, detailed: site.detailed, site };
};

/** Ground slabs (floors, foundations, painted ground) never block an addition. */
const GROUND_SLAB = .035;

export const boxOf = (centre: Point3, size: Point3): Box => ({
  max: [centre[0] + size[0] / 2, centre[1] + size[1] / 2, centre[2] + size[2] / 2],
  min: [centre[0] - size[0] / 2, centre[1] - size[1] / 2, centre[2] - size[2] / 2]
});

const overlaps = (a: Box, b: Box, margin: number) => [0, 1, 2].every(axis =>
  a.min[axis]! < b.max[axis]! + margin && a.max[axis]! > b.min[axis]! - margin);

/** True when the box touches no standing part of the building (`ignore` filters parts it may touch). */
export const isFree = (site: LevelSite, box: Box, margin = .02,
  ignore: (bounds: Box, part: BuildingPart) => boolean = () => false) => site.parts.every(part => {
  const bounds = getRomanPartBounds(part);
  if (bounds.max[1] < GROUND_SLAB) return true;
  return ignore(bounds, part) || !overlaps(bounds, box, margin);
});

export const isInsidePlot = (site: LevelSite, box: Box) =>
  Math.max(Math.abs(box.min[0]), Math.abs(box.max[0])) <= site.limit.extentX &&
  Math.max(Math.abs(box.min[2]), Math.abs(box.max[2])) <= site.limit.extentZ;

/** Ground-floor wall runs long enough to dress. */
export const groundWalls = (site: LevelSite, minLength = .3) =>
  site.walls.filter(wall => wall.base < .1 && wall.length >= minLength);

/** The wall the shared door is set in, if the plan has one. */
const doorWall = (site: LevelSite) => site.walls.find(wall => wall.along === 0 &&
  Math.abs((wall.min[2] + wall.max[2]) / 2 - site.door.z) < .12 &&
  site.door.left >= wall.min[0] - .05 && site.door.right <= wall.max[0] + .05);

/**
 * The front façade the door is set in (one wall run across the door, or the runs either side of
 * it): its outer face plane and its extent along x.
 */
export const doorFront = (site: LevelSite) => {
  const walls = groundWalls(site).filter(wall => wall.along === 0 &&
    Math.abs((wall.min[2] + wall.max[2]) / 2 - site.door.z) < .12);
  if (!walls.length) return null;
  return { face: Math.max(...walls.map(wall => wallFace(site, wall).face)),
    maxX: Math.max(...walls.map(wall => wall.max[0])), minX: Math.min(...walls.map(wall => wall.min[0])),
    top: Math.max(...walls.map(wall => wall.base + wall.height)) };
};

/** Outer face plane of a wall (its coordinate on the wall's normal axis). */
export const wallFace = (site: LevelSite, wall: WallRun) => {
  const normal = wallNormal(wall, site.centre), plane = (wall.min[normal.axis]! + wall.max[normal.axis]!) / 2;
  return { ...normal, face: plane + normal.sign * normal.thickness / 2 };
};

/**
 * Wall spans (fractions 0…1 along a wall) clear of the doorway, so plinths and bands never cross
 * the door lane. Walls without the door give one full span.
 */
export const spansClearOfDoor = (site: LevelSite, wall: WallRun, reach = .06): Array<[number, number]> => {
  // Split front walls also border the two-lane portal: their plinth ends must not grow into it.
  const storageFront = site.recipe.doubleDoor && wall.along === 0 &&
    Math.abs((wall.min[2] + wall.max[2]) / 2 - site.door.z) < .16;
  if (!storageFront && wall !== doorWall(site)) return [[0, 1]];
  const start = Math.max(0, Math.min(1, (site.door.left - reach - wall.min[0]) / wall.length));
  const end = Math.max(0, Math.min(1, (site.door.right + reach - wall.min[0]) / wall.length));
  return ([[0, start], [end, 1]] as Array<[number, number]>).filter(([from, to]) => (to - from) * wall.length > .08);
};

/** A box laid along a wall span, `out` beyond its face, from `bottom` up `height`. */
export const alongWallBox = (site: LevelSite, wall: WallRun, span: [number, number],
  shape: { bottom: number; depth: number; height: number; out: number; extend?: number }) => {
  const { axis, face, sign } = wallFace(site, wall);
  const extendStart = span[0] === 0 && meetsCorner(wall, site.walls, 0) ? shape.extend ?? 0 : 0;
  const extendEnd = span[1] === 1 && meetsCorner(wall, site.walls, 1) ? shape.extend ?? 0 : 0;
  const from = wall.min[wall.along]! + span[0] * wall.length - extendStart;
  const to = wall.min[wall.along]! + span[1] * wall.length + extendEnd;
  const position: Point3 = [0, shape.bottom + shape.height / 2, 0], size: Point3 = [0, shape.height, 0];
  position[wall.along] = (from + to) / 2;
  size[wall.along] = to - from;
  position[axis] = face + sign * (shape.out - shape.depth / 2);
  size[axis] = shape.depth;
  return { position, size };
};

/** A point on a wall's outer face, `out` beyond it. */
export const onWallFace = (site: LevelSite, wall: WallRun, t: number, y: number, out: number) => {
  const { thickness } = wallNormal(wall, site.centre);
  return onWall(wall, site.centre, t, y, thickness / 2 + out);
};

/** Real corners of the plan: wall ends meeting another wall at a right angle. */
export const wallCorners = (site: LevelSite) => {
  const corners: Array<{ wall: WallRun; end: 0 | 1 }> = [];
  for (const wall of groundWalls(site))
    for (const end of [0, 1] as const) if (meetsCorner(wall, site.walls, end)) corners.push({ end, wall });
  return corners;
};

/** Roof point on the slope facing `side` (±1 across the ridge), `t` from the ridge (0) to the eave (1). */
export const slopePoint = (site: LevelSite, along: number, side: number, t: number): Point3 | null => {
  const roof = site.roof;
  if (!roof || roof.ridgeAxis === null) return null;
  const across = roof.ridgeAxis === 0 ? 2 : 0, point: Point3 = [...roof.centre];
  const half = (roof.envelope.max[across]! - roof.envelope.min[across]!) / 2;
  point[roof.ridgeAxis] += along;
  point[across] += side * t * half;
  const top = site.topAt(point[0], point[2]);
  if (top === null) return null;
  point[1] = top;
  return point;
};

/** Half length of the main roof along its ridge, and half depth across it. */
export const roofHalves = (site: LevelSite) => {
  const roof = site.roof!, axis = roof.ridgeAxis ?? (roof.envelope.max[0] - roof.envelope.min[0] >=
    roof.envelope.max[2] - roof.envelope.min[2] ? 0 : 2);
  const across = axis === 0 ? 2 : 0;
  return { across, along: (roof.envelope.max[axis]! - roof.envelope.min[axis]!) / 2, axis,
    depth: (roof.envelope.max[across]! - roof.envelope.min[across]!) / 2 };
};

/** Highest point the additions may reach: 130 % of the level 1 building. */
export const heightCap = (site: LevelSite) => site.baseHeight * 1.3;
/** Half length of the level ridge line (a hip roof's ridge stops short of its ends). */
export const ridgeHalfLength = (site: LevelSite) => {
  const roof = site.roof;
  if (!roof || roof.ridgeAxis === null) return 0;
  const axis = roof.ridgeAxis, limit = roofHalves(site).along, step = .04;
  let reach = 0;
  for (let along = step; along <= limit; along += step) {
    const point: Point3 = [...roof.centre];
    point[axis] += along;
    const height = site.topAt(point[0], point[2]);
    if (height === null || height < roof.top - .035) break;
    reach = along;
  }
  return reach;
};
