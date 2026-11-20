import { DMath } from "../../shared/math/deterministic-math";
import type { BuildingPart, BuildingRecipe, Point3 } from "./building-recipe";
import { getRomanPartBounds } from "./building-recipe-fit";

export interface Bounds {
  min: Point3;
  max: Point3;
}
export type FaceSide = "front" | "side" | "back";

/** The outer face of one mud-brick wall: props hang on it or stand on the ground before it. */
export interface WallFace {
  /** Horizontal axis the wall runs along and the axis of its outward normal. */
  along: 0 | 2;
  axis: 0 | 2;
  sign: 1 | -1;
  /** Coordinate of the outer face plane on `axis`. */
  plane: number;
  from: number;
  to: number;
  base: number;
  top: number;
  side: FaceSide;
  /** Rotation about Y that turns a +Z-facing prop to face outward. */
  yaw: number;
}

const MIN_WALL_HEIGHT = 0.3;
const MIN_FACE_LENGTH = 0.3;
const MAX_WALL_THICKNESS = 0.3;

/** Unrotated upright mud-brick slabs of the finished Nubian building. */
const isMudWall = (part: BuildingPart) =>
  part.shape === "box" &&
  part.surface === "plaster" &&
  part.stage === 1 &&
  !part.rotation &&
  part.size[1] > MIN_WALL_HEIGHT &&
  Math.min(part.size[0], part.size[2]) < MAX_WALL_THICKNESS &&
  Math.max(part.size[0], part.size[2]) >= MIN_FACE_LENGTH;

const faceSide = (axis: 0 | 2, sign: 1 | -1): FaceSide => {
  if (axis === 0) return "side";
  return sign > 0 ? "front" : "back";
};

const FACE_YAW: Readonly<Record<string, number>> = {
  "0:-1": -Math.PI / 2,
  "0:1": Math.PI / 2,
  "2:-1": Math.PI,
  "2:1": 0
};

const toFace = (bounds: Bounds, center: readonly number[]): WallFace => {
  const along: 0 | 2 = bounds.max[0] - bounds.min[0] >= bounds.max[2] - bounds.min[2] ? 0 : 2;
  const axis: 0 | 2 = along === 0 ? 2 : 0;
  const sign: 1 | -1 = (bounds.min[axis]! + bounds.max[axis]!) / 2 >= center[axis]! ? 1 : -1;
  return {
    along,
    axis,
    base: bounds.min[1],
    from: bounds.min[along],
    plane: sign > 0 ? bounds.max[axis] : bounds.min[axis],
    side: faceSide(axis, sign),
    sign,
    to: bounds.max[along],
    top: bounds.max[1],
    yaw: FACE_YAW[`${axis}:${sign}`]!
  };
};

/** Outer wall faces, each told which side is outdoors by the plan centre of all walls. */
export const findWallFaces = (parts: readonly BuildingPart[]) => {
  const walls = parts.filter(isMudWall).map((part) => getRomanPartBounds(part));
  if (!walls.length) return { faces: [] as WallFace[], walls };
  const xs = walls.flatMap((wall) => [wall.min[0], wall.max[0]]),
    zs = walls.flatMap((wall) => [wall.min[2], wall.max[2]]);
  const center = [
    (Math.min(...xs) + Math.max(...xs)) / 2,
    0,
    (Math.min(...zs) + Math.max(...zs)) / 2
  ];
  return { faces: walls.map((wall) => toFace(wall, center)), walls };
};

/**
 * The default camera looks from +X/+Z: the -X side wall is turned away from it, so wall props go
 * there only when the front and the +X side have no room.
 */
const HIDDEN_SIDE_PENALTY = 1.5;
export const hiddenSidePenalty = (face: Pick<WallFace, "side" | "sign">) =>
  face.side === "side" && face.sign < 0 ? HIDDEN_SIDE_PENALTY : 0;

/** A point in front of a face: `along` absolute, `y` absolute, `out` from the face plane. */
export const facePoint = (face: WallFace, along: number, y: number, out: number): Point3 => {
  const point: Point3 = [0, y, 0];
  point[face.along] = along;
  point[face.axis] = face.plane + face.sign * out;
  return point;
};

/** An axis-aligned box size: `length` along the wall, `depth` across it. */
export const faceSize = (face: WallFace, length: number, height: number, depth: number): Point3 =>
  face.along === 0 ? [length, height, depth] : [depth, height, length];

/** Box in front of a face, `out` from…to measured outward from the plane. */
export const faceBox = (
  face: WallFace,
  along: readonly [number, number],
  y: readonly [number, number],
  out: readonly [number, number]
): Bounds => {
  const a = facePoint(face, along[0], y[0], out[0]),
    b = facePoint(face, along[1], y[1], out[1]);
  return {
    max: [Math.max(a[0], b[0]), y[1], Math.max(a[2], b[2])],
    min: [Math.min(a[0], b[0]), y[0], Math.min(a[2], b[2])]
  };
};

export const overlaps = (a: Bounds, b: Bounds, gap = 0) =>
  [0, 1, 2].every((axis) => a.min[axis]! < b.max[axis]! + gap && b.min[axis]! < a.max[axis]! + gap);

const contains = (box: Bounds, point: Point3) =>
  [0, 1, 2].every(
    (axis) => point[axis]! >= box.min[axis]! - 0.001 && point[axis]! <= box.max[axis]! + 0.001
  );

export const mergeBounds = (boxes: readonly Bounds[]): Bounds => ({
  max: [0, 1, 2].map((axis) => Math.max(...boxes.map((box) => box.max[axis]!))) as Point3,
  min: [0, 1, 2].map((axis) => Math.min(...boxes.map((box) => box.min[axis]!))) as Point3
});

/** Plan distance from a point to a segment (worker walking lines). */
const segmentDistance = (point: Point3, from: Point3, to: Point3) => {
  const dx = to[0] - from[0],
    dz = to[2] - from[2],
    length = dx * dx + dz * dz;
  const t = length
    ? Math.max(0, Math.min(1, ((point[0] - from[0]) * dx + (point[2] - from[2]) * dz) / length))
    : 0;
  return DMath.hypot(point[0] - from[0] - dx * t, point[2] - from[2] - dz * t);
};

/** Ground props keep this far (plan, box edge) off the worker's walk from the door to exit and work point. */
const WALK_CLEARANCE = 0.22;
/** Wall props lower than this may brush a passing worker; they keep off the walking lines as well. */
const HEAD_HEIGHT = 0.85;
const DOOR_LANE_HALF_WIDTH = 0.34;

/** Recipe facts every candidate prop is checked against. */
export interface DecorSite {
  boxes: Bounds[];
  walls: Bounds[];
  limit: { extentX: number; extentZ: number };
  recipe: BuildingRecipe;
}

const keepsWalksClear = (box: Bounds, recipe: BuildingRecipe) => {
  if (box.min[1] > HEAD_HEIGHT) return true;
  const width = recipe.doorDimensions?.width ?? 0.46,
    doorCenter = recipe.door[0] + width / 2;
  if (
    box.min[0] < doorCenter + DOOR_LANE_HALF_WIDTH &&
    box.max[0] > doorCenter - DOOR_LANE_HALF_WIDTH &&
    box.max[2] > recipe.door[2] - 0.05
  )
    return false;
  const center: Point3 = [(box.min[0] + box.max[0]) / 2, 0, (box.min[2] + box.max[2]) / 2];
  const radius = DMath.hypot(box.max[0] - box.min[0], box.max[2] - box.min[2]) / 2;
  const door: Point3 = [doorCenter, 0, recipe.door[2]];
  return (
    segmentDistance(center, door, recipe.workerExit) > radius + WALK_CLEARANCE &&
    segmentDistance(center, recipe.workerExit, recipe.workPoint) > radius + WALK_CLEARANCE
  );
};

const insideEnvelope = (box: Bounds, limit: DecorSite["limit"]) =>
  Math.max(Math.abs(box.min[0]), Math.abs(box.max[0])) <= limit.extentX &&
  Math.max(Math.abs(box.min[2]), Math.abs(box.max[2])) <= limit.extentZ;

/** Open air in front of the prop: no wall (a wing or a courtyard enclosure) closes it in. */
const OPEN_DEPTH = 0.5;
/** Nothing (a rack, a column, a stock pile) stands this close in front of a prop and hides it. */
const VIEW_DEPTH = 0.4;

const alongRange = (face: WallFace, box: Bounds): [number, number] => [
  box.min[face.along]!,
  box.max[face.along]!
];
const outward = (face: WallFace, box: Bounds) =>
  face.sign * ((face.sign > 0 ? box.max : box.min)[face.axis]! - face.plane);

const isOutdoors = (face: WallFace, box: Bounds, walls: readonly Bounds[]) => {
  const reach = faceBox(face, alongRange(face, box), [box.min[1], box.max[1]], [0.01, OPEN_DEPTH]);
  return !walls.some((wall) => overlaps(wall, reach));
};

const isInView = (face: WallFace, box: Bounds, boxes: readonly Bounds[]) => {
  const front = outward(face, box) + 0.005;
  const view = faceBox(
    face,
    alongRange(face, box),
    [box.min[1], box.max[1]],
    [front, front + VIEW_DEPTH]
  );
  return !boxes.some((other) => overlaps(other, view));
};

/**
 * Towards the default gameplay camera (from +X/+Z, about 30 degrees up). A prop on the front or the +X
 * side is swept along this ray: a rack or frame standing diagonally before it must not cross its core
 * (the middle of the prop; its rim may be overlapped).
 */
const CAMERA_RAY: Point3 = [.61, .5, .61];
const CAMERA_SWEEP = { count: 32, length: .06 } as const;
/** Share of the prop's width and height kept as its core, centred. */
const CORE_SHARE = .6;

const facesCamera = (face: WallFace) => face.sign > 0;

const propCore = (face: WallFace, box: Bounds): Bounds => {
  const core: Bounds = { max: [...box.max], min: [...box.min] };
  for (const axis of [face.along, 1] as const) {
    const inset = (box.max[axis]! - box.min[axis]!) * (1 - CORE_SHARE) / 2;
    core.min[axis] += inset;
    core.max[axis] -= inset;
  }
  return core;
};

/** The prop's core keeps a clear line to the gameplay camera. */
const isCameraVisible = (face: WallFace, box: Bounds, boxes: readonly Bounds[]) => {
  if (!facesCamera(face)) return true;
  const core = propCore(face, box);
  for (let step = 1; step <= CAMERA_SWEEP.count; step++) {
    const distance = step * CAMERA_SWEEP.length;
    const moved: Bounds = {
      max: core.max.map((value, axis) => value + CAMERA_RAY[axis]! * distance) as Point3,
      min: core.min.map((value, axis) => value + CAMERA_RAY[axis]! * distance) as Point3
    };
    if (boxes.some((other) => overlaps(other, moved))) return false;
  }
  return true;
};

/** A roof, portico or upper storey above the space in front: the prop would sit in the shade. */
const SHELTER_HEIGHT = 1;
export const isSheltered = (face: WallFace, box: Bounds, boxes: readonly Bounds[]) => {
  const above = faceBox(
    face,
    alongRange(face, box),
    [box.max[1] + 0.02, box.max[1] + SHELTER_HEIGHT],
    [0.06, 0.45]
  );
  return boxes.some((other) => overlaps(other, above));
};

/** Every back corner and the centre sit on solid masonry (a wall, lintel or pier). */
export const isBacked = (face: WallFace, box: Bounds, site: DecorSite) => {
  const along = [
    box.min[face.along]! + 0.01,
    (box.min[face.along]! + box.max[face.along]!) / 2,
    box.max[face.along]! - 0.01
  ];
  const heights = [box.min[1] + 0.01, (box.min[1] + box.max[1]) / 2, box.max[1] - 0.01];
  return along.every((a) =>
    heights.every((y) => site.boxes.some((other) => contains(other, facePoint(face, a, y, -0.01))))
  );
};

/** Side and vertical gap kept to every neighbouring part. */
const LATERAL_GAP = 0.012;

/**
 * A prop fits when it stays inside the plot envelope, out of every existing part (a little lateral
 * gap), in open air and off the door lane and worker walks.
 */
export const fitsSite = (face: WallFace, occupied: Bounds, site: DecorSite) => {
  if (!insideEnvelope(occupied, site.limit) || !keepsWalksClear(occupied, site.recipe))
    return false;
  if (!isOutdoors(face, occupied, site.walls) || !isInView(face, occupied, site.boxes))
    return false;
  const clearance: Bounds = { max: [...occupied.max], min: [...occupied.min] };
  for (const axis of [face.along, 1] as const) {
    clearance.min[axis] -= LATERAL_GAP;
    clearance.max[axis] += LATERAL_GAP;
  }
  return !site.boxes.some((box) => overlaps(box, clearance)) && isCameraVisible(face, occupied, site.boxes);
};
