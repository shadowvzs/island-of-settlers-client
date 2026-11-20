import { lerp3 } from "../../shared/world/noise";
import type { Random } from "../../shared/world/rng";
import type { AtlasRect } from "../trees/foliage-atlas";
import {
  cross,
  dot,
  type MeshBuilder,
  NO_PATH,
  NO_UV,
  normalize,
  type Vec2,
  type Vec3,
  type VertexStyle
} from "./mesh-builder";

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: Vec3, factor: number): Vec3 => [
  a[0] * factor,
  a[1] * factor,
  a[2] * factor
];
export const subtract = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/** Two unit vectors perpendicular to `direction` (and to each other). */
const getPerpendiculars = (direction: Vec3) => {
  const helper: Vec3 = Math.abs(direction[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const first = normalize(cross(direction, helper));
  return { first, second: normalize(cross(direction, first)) };
};

/** Direction from spherical angles: azimuth around y, elevation above the horizon. */
export const fromAngles = (azimuth: number, elevation: number): Vec3 => [
  Math.cos(azimuth) * Math.cos(elevation),
  Math.sin(elevation),
  Math.sin(azimuth) * Math.cos(elevation)
];

/** Random unit vector perpendicular to `direction`. */
export const randomPerpendicular = (direction: Vec3, random: Random): Vec3 => {
  const { first, second } = getPerpendiculars(direction);
  const angle = random() * Math.PI * 2;
  return normalize(add(scale(first, Math.cos(angle)), scale(second, Math.sin(angle))));
};

export interface LeafCardOptions {
  /** Share of the card length that reaches behind the attachment point (default 0.2). */
  anchor?: number;
  /** Spray cell in the foliage atlas (its twig starts at the cell's v0 edge). */
  cell: AtlasRect;
  /** Side the card shows (its plane normal leans this way); unset: a random turn about growth. */
  facing?: Vec3;
  /**
   * V-fold along the painted twig (u = 0.5): the two leaf halves rise towards `facing` by this
   * share of the half width. 0 / unset: a flat quad (2 triangles); folded: 4 triangles.
   */
  fold?: number;
  /** Points from the twig base to the leaf tips (the texture's twig grows upwards). */
  growth: Vec3;
  /** Lighting normal: blended towards the crown's outward direction for soft volume. */
  outward: Vec3;
  size: number;
}

/**
 * Cards keep their base on the twig: only the tip flutters (a uniformly fluttering card slid off
 * its twig). Plant cards (attachPath set) also bend with their stem path.
 */
const getCardWind = (
  attachPath: number | undefined,
  tip: number,
  options: LeafCardOptions,
  style: VertexStyle
) => {
  const flutter = tip * style.flutter;
  if (attachPath === undefined) return { flutter, path: NO_PATH };
  return { flutter, path: attachPath + tip * options.size * 0.6 };
};

/** Card side axis: across the facing side when given, else a random turn (always draws once). */
const getCardRight = (up: Vec3, options: LeafCardOptions, random: Random) => {
  const turned = randomPerpendicular(up, random);
  if (!options.facing) return turned;
  const right = cross(up, options.facing);
  const length = Math.hypot(...right);
  return length < 1e-4 ? turned : scale(right, 1 / length);
};

/** Card corner columns: u across (0, 0.5 spine, 1), side offset and lift along the card normal. */
const getCardColumns = (fold: number): [number, number, number][] =>
  fold > 0 ? [[0, -0.5, fold * 0.5], [0.5, 0, 0], [1, 0.5, fold * 0.5]] : [[0, -0.5, 0], [1, 0.5, 0]];

/**
 * Alpha tested card showing a whole twig of leaves: a flat quad, or folded along the twig into a
 * shallow V (the leaves on both sides rise like on a real shoot), so close views see volume and
 * the two halves catch the light differently. Normals blend the card's own (bent) normal with
 * the crown's outward direction: the crown still reads as one soft volume.
 */
export const addLeafCard = (
  builder: MeshBuilder,
  base: Vec3,
  options: LeafCardOptions,
  random: Random,
  style: VertexStyle,
  attachPath?: number
) => {
  const up = normalize(options.growth);
  const right = getCardRight(up, options, random);
  const plane = normalize(cross(right, up));
  const fold = options.fold ?? 0;
  const own = fold > 0 ? 0.55 : 0.35;
  const bottom = subtract(base, scale(up, options.size * (options.anchor ?? 0.2)));
  const columns = getCardColumns(fold);
  const first = builder.vertexCount;
  const { cell } = options;
  for (const v of [1, 0]) {
    const row = add(bottom, scale(up, options.size * (1 - v)));
    for (const [u, across, lift] of columns) {
      const offset = add(scale(right, across * options.size), scale(plane, lift * options.size));
      const position = add(row, offset);
      const bent = normalize(add(plane, scale(right, -across * fold * 2)));
      const normal = normalize(add(scale(bent, own), scale(normalize(options.outward), 1 - own)));
      const crownNormal = normalize(add(normal,
        scale(subtract(position, base), .22 / Math.max(.001, options.size))));
      const uv: Vec2 = [cell.u0 + (cell.u1 - cell.u0) * u, cell.v0 + (cell.v1 - cell.v0) * (1 - v)];
      builder.addVertex(position, crownNormal, style, uv, getCardWind(attachPath, 1 - v, options, style));
    }
  }
  const width = columns.length;
  for (let column = 0; column < width - 1; column += 1) {
    const low = first + column;
    const high = low + width;
    builder.addTriangle(low, low + 1, high + 1);
    builder.addTriangle(low, high + 1, high);
  }
};


interface TubeFrame {
  binormal: Vec3;
  normal: Vec3;
  tangent: Vec3;
}

/** Ring orientation per point by parallel transport: no twists or kinks along a bent limb. */
const getTubeFrames = (points: Vec3[]): TubeFrame[] => {
  let normal: Vec3 = getPerpendiculars(normalize(subtract(points[1]!, points[0]!))).first;
  return points.map((_, index) => {
    const previous = points[Math.max(0, index - 1)]!;
    const next = points[Math.min(points.length - 1, index + 1)]!;
    const tangent = normalize(subtract(next, previous));
    normal = normalize(subtract(normal, scale(tangent, dot(normal, tangent))));
    return { binormal: cross(tangent, normal), normal, tangent };
  });
};

/** Texture coordinate of a tube vertex: point index along the limb, 0..1 around it. */
export type TubeUv = (index: number, around: number) => Vec2;

/** Parent axis at a branch attachment; a mesh-only collar reuses the first two tube rings. */
export interface TubeJunction {
  axis: Vec3;
  origin: Vec3;
  radius: number;
}

/**
 * One seamless tube along a polyline: rings share vertices between segments and are oriented
 * by parallel transport, so a limb bends smoothly without gaps, twists or kinks. Plant stems
 * pass their path lengths (see VertexWind) so the wind bends them from the root; textured
 * wood passes its own uv mapping (untextured by default).
 */
export const addCurvedTube = (
  builder: MeshBuilder,
  points: Vec3[],
  radii: number[],
  segments: number,
  style: VertexStyle,
  paths?: number[],
  uvAt?: TubeUv,
  junction?: TubeJunction
) => {
  const first = builder.vertexCount;
  const frames = getTubeFrames(points);
  const seam = junction ? .5 + Math.atan2(dot(junction.axis, frames[0]!.binormal),
    dot(junction.axis, frames[0]!.normal)) / (Math.PI * 2) : 0;
  points.forEach((point, index) => {
    const { binormal, normal, tangent } = frames[index]!;
    const before = Math.max(0, index - 1), after = Math.min(points.length - 1, index + 1);
    const span = Math.hypot(...subtract(points[after]!, points[before]!));
    const taperSlope = (radii[after]! - radii[before]!) / Math.max(.001, span);
    const collar = junction ? Math.max(0, 1 - index / 2) : 0;
    const flare = junction
      ? Math.min(.35, Math.max(0, junction.radius / Math.max(.001, radii[index]!) - 1) * .25) : 0;
    const radius = radii[index]! * (1 + collar * flare);
    const wind = paths ? { flutter: 0, path: paths[index]! } : undefined;
    const shaded: VertexStyle = collar > 0 ? { ...style, color: (at, facing) => {
      const colour = style.color(at, facing), shade = 1 - collar * .12;
      return [colour[0] * shade, colour[1] * shade, colour[2] * shade];
    } } : style;
    for (let segment = 0; segment <= segments; segment += 1) {
      const angle = (segment / segments) * Math.PI * 2;
      const direction = add(scale(normal, Math.cos(angle)), scale(binormal, Math.sin(angle)));
      const position = add(point, scale(direction, radius));
      let surfaceNormal = normalize(subtract(direction, scale(tangent, taperSlope)));
      if (junction) {
        const offset = subtract(position, junction.origin);
        const parentNormal = normalize(subtract(offset, scale(junction.axis, dot(offset, junction.axis))));
        surfaceNormal = normalize(add(scale(surfaceNormal, 1 - collar * .65), scale(parentNormal, collar * .65)));
      }
      const uv = uvAt ? uvAt(index, segment / segments + seam) : NO_UV;
      builder.addVertex(position, surfaceNormal, shaded, uv, wind);
    }
  });
  const ring = segments + 1;
  for (let index = 0; index < points.length - 1; index += 1) {
    for (let segment = 0; segment < segments; segment += 1) {
      const a = first + index * ring + segment;
      const b = a + ring;
      builder.addTriangle(a, b, a + 1);
      builder.addTriangle(b, b + 1, a + 1);
    }
  }
};

export interface LimbOptions {
  /** Upward pull per step (positive: branches turn up, negative: they droop). */
  bend: number;
  direction: Vec3;
  length: number;
  start: Vec3;
  steps: number;
  wobble: number;
}

/** Points of a naturally curving limb: the direction turns up (or down) and wobbles a little. */
export const growLimb = (options: LimbOptions, random: Random): Vec3[] => {
  const points: Vec3[] = [options.start];
  let direction = normalize(options.direction);
  let position = options.start;
  const step = options.length / options.steps;
  for (let index = 0; index < options.steps; index += 1) {
    const wobble = scale(randomPerpendicular(direction, random), options.wobble);
    direction = normalize(add(add(direction, [0, options.bend, 0]), wobble));
    position = add(position, scale(direction, step));
    points.push(position);
  }
  return points;
};

/** Radius per point: smooth taper from base to tip. */
export const taper = (count: number, base: number, tip: number) =>
  Array.from(
    { length: count },
    (_, index) => base + (tip - base) * Math.pow(index / (count - 1), 0.8)
  );

/** Point at a fraction of a polyline's length. */
export const pointAlong = (points: Vec3[], fraction: number): Vec3 => {
  const position = fraction * (points.length - 1);
  const index = Math.min(points.length - 2, Math.floor(position));
  return lerp3(points[index]!, points[index + 1]!, position - index);
};
