import { smoothstep } from "../../../shared/world/noise";
import { BARK_FAMILY, toBarkUv } from "../../trees/bark-uv";
import { cross, dot, MeshBuilder, normalize, type PropMesh, type Vec2, type Vec3 } from "../mesh-builder";

/**
 * Shared geometry of the shore shells (seashells, sea stars, snail and sea-snail shells, shell
 * fragments): parametric grid surfaces with the procedural shell uv of the prop shader
 * (three-shell-shading.ts), rigid placement (tilt, sink into the sand) and small relief knobs.
 */

/** Procedural surface families of the prop shader (bark uv families after the trees). */
export const SHELL_FAMILY = {
  bivalve: BARK_FAMILY.shellBivalve,
  nacre: BARK_FAMILY.shellNacre,
  seaStar: BARK_FAMILY.seaStar,
  spiral: BARK_FAMILY.spiralShell
} as const;

/** Pattern index stride inside the along coordinate (the shader splits along by it). */
export const SHELL_PATTERN_STRIDE = 16;

/** Shader uv of a shell surface point: around 0..1, along local coordinate + pattern offset. */
export const toShellUv = (family: number, around: number, along: number, pattern: number): Vec2 =>
  toBarkUv(Math.min(0.999, Math.max(0, around)), along + pattern * SHELL_PATTERN_STRIDE, family);

/** A grid surface: node (u across columns, v along rows, both 0..1) to point, colour and uv. */
export interface ShellSurface {
  colorAt: (u: number, v: number) => Vec3;
  columns: number;
  /** A point behind the surface at (u, v): the normal faces away from it. */
  insideAt: (u: number, v: number) => Vec3;
  pointAt: (u: number, v: number) => Vec3;
  rows: number;
  uvAt: (u: number, v: number) => Vec2;
}

export type Placement = (point: Vec3) => Vec3;

export const rotateX = (angle: number): Placement => ([x, y, z]) =>
  [x, y * Math.cos(angle) - z * Math.sin(angle), y * Math.sin(angle) + z * Math.cos(angle)];

export const rotateY = (angle: number): Placement => ([x, y, z]) =>
  [x * Math.cos(angle) + z * Math.sin(angle), y, -x * Math.sin(angle) + z * Math.cos(angle)];

export const rotateZ = (angle: number): Placement => ([x, y, z]) =>
  [x * Math.cos(angle) - y * Math.sin(angle), x * Math.sin(angle) + y * Math.cos(angle), z];

export const compose = (...steps: Placement[]): Placement => (point) =>
  steps.reduce((current, step) => step(current), point);

export const placeSurface = (surface: ShellSurface, place: Placement): ShellSurface => ({
  ...surface,
  insideAt: (u, v) => place(surface.insideAt(u, v)),
  pointAt: (u, v) => place(surface.pointAt(u, v))
});

/** Lowest grid point of the surfaces. */
const getLowest = (surfaces: readonly ShellSurface[]) => {
  let lowest = Infinity;
  for (const surface of surfaces) {
    for (let row = 0; row <= surface.rows; row += 1) {
      for (let column = 0; column <= surface.columns; column += 1) {
        lowest = Math.min(lowest, surface.pointAt(column / surface.columns, row / surface.rows)[1]);
      }
    }
  }
  return lowest;
};

/**
 * Moves the surfaces down so their lowest point lies `depth` below the ground: the part under
 * the ground is hidden by the sand (seated shells, half-buried fragments).
 */
export const sinkSurfaces = (surfaces: readonly ShellSurface[], depth: number) => {
  const offset = -depth - getLowest(surfaces);
  const sink: Placement = ([x, y, z]) => [x, y + offset, z];
  return surfaces.map((surface) => placeSurface(surface, sink));
};

const STEP = 0.25;

/** Normal by finite differences along both grid axes, facing away from the inside point. */
const getNormal = (surface: ShellSurface, u: number, v: number) => {
  const du = STEP / surface.columns;
  const dv = STEP / surface.rows;
  const uA = Math.max(0, u - du), uB = Math.min(1, u + du);
  const vA = Math.max(0, v - dv), vB = Math.min(1, v + dv);
  const pu = surface.pointAt(uB, v), mu = surface.pointAt(uA, v);
  const pv = surface.pointAt(u, vB), mv = surface.pointAt(u, vA);
  const alongU: Vec3 = [pu[0] - mu[0], pu[1] - mu[1], pu[2] - mu[2]];
  const alongV: Vec3 = [pv[0] - mv[0], pv[1] - mv[1], pv[2] - mv[2]];
  const point = surface.pointAt(u, v);
  const inside = surface.insideAt(u, v);
  const away: Vec3 = [point[0] - inside[0], point[1] - inside[1], point[2] - inside[2]];
  const normal = cross(alongU, alongV);
  if (Math.hypot(normal[0], normal[1], normal[2]) < 1e-12) return normalize(away);
  const unit = normalize(normal);
  return dot(unit, away) < 0 ? ([-unit[0], -unit[1], -unit[2]] as Vec3) : unit;
};

/**
 * Darkens colour near the ground (sand contact): full colour from `height` above the ground,
 * 0.62 at and below it.
 */
export const groundShade = (color: Vec3, y: number, height: number): Vec3 => {
  const light = 0.62 + 0.38 * smoothstep(-height * 0.2, height, y);
  return [color[0] * light, color[1] * light, color[2] * light];
};

/** Adds a grid surface; `shadeHeight` is the contact shade height (see groundShade). */
export const addShellSurface = (builder: MeshBuilder, surface: ShellSurface, shadeHeight: number) => {
  const first = builder.vertexCount;
  for (let row = 0; row <= surface.rows; row += 1) {
    for (let column = 0; column <= surface.columns; column += 1) {
      const u = column / surface.columns, v = row / surface.rows;
      const point = surface.pointAt(u, v);
      const color = groundShade(surface.colorAt(u, v), point[1], shadeHeight);
      builder.addVertex(point, getNormal(surface, u, v), { color: () => color, flutter: 0 },
        surface.uvAt(u, v));
    }
  }
  const stride = surface.columns + 1;
  for (let row = 0; row < surface.rows; row += 1) {
    for (let column = 0; column < surface.columns; column += 1) {
      const a = first + row * stride + column;
      builder.addTriangle(a, a + 1, a + stride);
      builder.addTriangle(a + 1, a + stride + 1, a + stride);
    }
  }
};

export interface Knob {
  color: Vec3;
  /** Base centre on the surface and the surface normal there. */
  normal: Vec3;
  point: Vec3;
  radius: number;
  height: number;
  uv: Vec2;
}

/** A small four-sided knob (tubercle, spine stub) standing on a surface: 4 triangles. */
export const addKnob = (builder: MeshBuilder, knob: Knob) => {
  const { color, height, normal, point, radius, uv } = knob;
  const helper: Vec3 = Math.abs(normal[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const side = normalize(cross(normal, helper));
  const other = cross(normal, side);
  const style = { color: () => color, flutter: 0 };
  const sink = radius * 0.3;
  const apex = builder.addVertex(
    [point[0] + normal[0] * height, point[1] + normal[1] * height, point[2] + normal[2] * height],
    normal, style, uv);
  const corners = [side, other, [-side[0], -side[1], -side[2]], [-other[0], -other[1], -other[2]]]
    .map((direction) => builder.addVertex([
      point[0] + direction[0] * radius - normal[0] * sink,
      point[1] + direction[1] * radius - normal[1] * sink,
      point[2] + direction[2] * radius - normal[2] * sink
    ], normalize([direction[0] + normal[0], direction[1] + normal[1], direction[2] + normal[2]]),
    style, uv));
  for (let index = 0; index < 4; index += 1) builder.addTriangle(apex, corners[index]!, corners[(index + 1) % 4]!);
};

/** Shells lie still: no wind sway or flutter on any vertex. */
export const finishStill = (builder: MeshBuilder): PropMesh => {
  const mesh = builder.finish({ flex: 0 });
  mesh.wind.fill(0);
  return mesh;
};

export const scaleColor = (color: Vec3, amount: number): Vec3 =>
  [color[0] * amount, color[1] * amount, color[2] * amount];

export const mixColor = (from: Vec3, to: Vec3, amount: number): Vec3 => [
  from[0] + (to[0] - from[0]) * amount,
  from[1] + (to[1] - from[1]) * amount,
  from[2] + (to[2] - from[2]) * amount
];
