import { type GridSize,sampleSmooth } from "../shared/world/grid-geometry";
import { RENDER_SUBDIVISION } from "./chunk-sampling";
import { splitsOnMainDiagonal } from "./terrain-chunks";

/** A world point (or direction) picked on the ground. */
export interface PickPoint {
  x: number;
  y: number;
  z: number;
}

/** A pick ray in world units: from the camera (or above the map) into the scene. */
export interface PickRay {
  direction: PickPoint;
  origin: PickPoint;
}

/** The heights the ground is in, as the picking needs them (the world data). */
export interface PickGround extends GridSize {
  heights: ArrayLike<number>;
}

/**
 * Heights a pick ray is searched between: below the deepest sea bed and above the highest peak
 * the editor can raise (the default island spans about -5.5 .. 13).
 */
export const PICK_HEIGHT_RANGE = { max: 32, min: -12 } as const;

const STEP = 1 / RENDER_SUBDIVISION;
/** A ray this close to the surface touches it (a grazing ray through a vertex is a hit). */
const TOUCH = 1e-9;

/** Corner heights of the render quad being crossed (a: x0 z0, b: x1 z0, c: x0 z1, d: x1 z1). */
interface RenderQuad {
  a: number;
  b: number;
  c: number;
  column: number;
  d: number;
  main: boolean;
  row: number;
}

/** Grid walk through the render quads (Amanatides & Woo), t along the ray. */
interface QuadWalk {
  column: number;
  columnDeltaT: number;
  columnNextT: number;
  columnStep: number;
  row: number;
  rowDeltaT: number;
  rowNextT: number;
  rowStep: number;
}

/** Where the march is: t on the ray and how far the ray is above the ground there. */
interface MarchState {
  above: number;
  t: number;
}

/** The part of the ray inside the map box (x, z on the map, y in the pick height range). */
const clipRay = (ground: PickGround, { direction, origin }: PickRay) => {
  const axes = [
    [origin.x, direction.x, 0, ground.cellsX],
    [origin.y, direction.y, PICK_HEIGHT_RANGE.min, PICK_HEIGHT_RANGE.max],
    [origin.z, direction.z, 0, ground.cellsZ]
  ] as const;
  let start = 0;
  let end = Infinity;
  for (const [from, along, min, max] of axes) {
    if (along === 0) {
      if (from < min || from > max) return null;
      continue;
    }
    const first = (min - from) / along;
    const second = (max - from) / along;
    start = Math.max(start, Math.min(first, second));
    end = Math.min(end, Math.max(first, second));
  }
  return start <= end ? { end, start } : null;
};

const loadQuad = (ground: PickGround, quad: RenderQuad, column: number, row: number) => {
  const x = column * STEP;
  const z = row * STEP;
  quad.a = sampleSmooth(ground, ground.heights, x, z);
  quad.b = sampleSmooth(ground, ground.heights, x + STEP, z);
  quad.c = sampleSmooth(ground, ground.heights, x, z + STEP);
  quad.d = sampleSmooth(ground, ground.heights, x + STEP, z + STEP);
  quad.main = splitsOnMainDiagonal(quad.a, quad.b, quad.c, quad.d);
  quad.column = column;
  quad.row = row;
};

/** Height of the quad's two triangles at local 0 .. 1 coordinates (the drawn surface). */
const getQuadHeight = (quad: RenderQuad, u: number, v: number) => {
  const { a, b, c, d } = quad;
  if (quad.main) return u >= v ? a + (b - a) * u + (d - b) * v : a + (d - c) * u + (c - a) * v;
  return u + v <= 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v);
};

const toLocal = (position: number, index: number) =>
  Math.min(1, Math.max(0, position / STEP - index));

/** How far the ray at `t` is above the quad's surface (negative: below the ground). */
const getHeightAbove = ({ direction, origin }: PickRay, quad: RenderQuad, t: number) => {
  const u = toLocal(origin.x + direction.x * t, quad.column);
  const v = toLocal(origin.z + direction.z * t, quad.row);
  return origin.y + direction.y * t - getQuadHeight(quad, u, v);
};

/** t where the ray crosses the quad's split diagonal (NaN or outside when it does not). */
const getDiagonalT = ({ direction, origin }: PickRay, quad: RenderQuad) => {
  if (quad.main) {
    const offset = (quad.column - quad.row) * STEP;
    return (offset - (origin.x - origin.z)) / (direction.x - direction.z);
  }
  const offset = (quad.column + quad.row + 1) * STEP;
  return (offset - (origin.x + origin.z)) / (direction.x + direction.z);
};

const createAxisWalk = (from: number, along: number, index: number) => {
  if (along === 0) return { deltaT: Infinity, nextT: Infinity, step: 0 };
  const boundary = (along > 0 ? index + 1 : index) * STEP;
  return {
    deltaT: STEP / Math.abs(along),
    nextT: (boundary - from) / along,
    step: Math.sign(along)
  };
};

const clampIndex = (index: number, count: number) => Math.min(count - 1, Math.max(0, index));

const createWalk = (ground: PickGround, { direction, origin }: PickRay, t: number): QuadWalk => {
  const x = origin.x + direction.x * t;
  const z = origin.z + direction.z * t;
  const column = clampIndex(Math.floor(x / STEP), ground.cellsX * RENDER_SUBDIVISION);
  const row = clampIndex(Math.floor(z / STEP), ground.cellsZ * RENDER_SUBDIVISION);
  const columns = createAxisWalk(origin.x, direction.x, column);
  const rows = createAxisWalk(origin.z, direction.z, row);
  return {
    column,
    columnDeltaT: columns.deltaT,
    columnNextT: columns.nextT,
    columnStep: columns.step,
    row,
    rowDeltaT: rows.deltaT,
    rowNextT: rows.nextT,
    rowStep: rows.step
  };
};

/** Into the next quad (both axes at once when the ray passes exactly through a corner). */
const stepWalk = (walk: QuadWalk) => {
  const nextT = Math.min(walk.columnNextT, walk.rowNextT);
  if (walk.columnNextT === nextT) {
    walk.column += walk.columnStep;
    walk.columnNextT += walk.columnDeltaT;
  }
  if (walk.rowNextT === nextT) {
    walk.row += walk.rowStep;
    walk.rowNextT += walk.rowDeltaT;
  }
};

/**
 * Marches to `t` inside the quad; true when the ray went under the ground on the way (the
 * state's t is then the exact crossing: the surface is linear along one triangle).
 */
const marchTo = (ray: PickRay, quad: RenderQuad, state: MarchState, t: number) => {
  const above = getHeightAbove(ray, quad, t);
  if (above > TOUCH) {
    state.above = above;
    state.t = t;
    return false;
  }
  state.t += (t - state.t) * Math.min(1, state.above / (state.above - above));
  return true;
};

const toPoint = ({ direction, origin }: PickRay, t: number): PickPoint => ({
  x: origin.x + direction.x * t,
  y: origin.y + direction.y * t,
  z: origin.z + direction.z * t
});

const isInside = (ground: PickGround, walk: QuadWalk) =>
  walk.column >= 0 &&
  walk.row >= 0 &&
  walk.column < ground.cellsX * RENDER_SUBDIVISION &&
  walk.row < ground.cellsZ * RENDER_SUBDIVISION;

/**
 * The first point where a ray meets the ground, exactly on the triangles the renderers draw
 * (the render vertices on the smooth heights, each quad split as the terrain chunks split it),
 * or null when it misses the map. Watertight: each quad's entry is the previous quad's exit, so
 * no ray slips between two triangles. The renderer picks with it, on the same heights the editor
 * changes (the shown terrain follows them in the same frame).
 */
export const pickGroundAlongRay = (ground: PickGround, ray: PickRay): PickPoint | null => {
  const clip = clipRay(ground, ray);
  if (!clip) return null;
  const walk = createWalk(ground, ray, clip.start);
  const quad: RenderQuad = { a: 0, b: 0, c: 0, column: 0, d: 0, main: true, row: 0 };
  loadQuad(ground, quad, walk.column, walk.row);
  const state: MarchState = { above: getHeightAbove(ray, quad, clip.start), t: clip.start };
  if (state.above <= TOUCH) return toPoint(ray, clip.start);
  while (isInside(ground, walk)) {
    if (quad.column !== walk.column || quad.row !== walk.row) {
      loadQuad(ground, quad, walk.column, walk.row);
    }
    const exit = Math.min(walk.columnNextT, walk.rowNextT, clip.end);
    const diagonal = getDiagonalT(ray, quad);
    const crossesDiagonal = diagonal > state.t && diagonal < exit;
    if (crossesDiagonal && marchTo(ray, quad, state, diagonal)) return toPoint(ray, state.t);
    if (marchTo(ray, quad, state, exit)) return toPoint(ray, state.t);
    if (exit >= clip.end) return null;
    stepWalk(walk);
  }
  return null;
};
