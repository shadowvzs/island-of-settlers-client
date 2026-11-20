import { lerp3 } from "../../../shared/world/noise";
import type { Random } from "../../../shared/world/rng";
import { cross, type MeshBuilder, NO_UV, normalize, type Vec2, type Vec3, type VertexStyle } from "../mesh-builder";
import {
  add,
  addCurvedTube,
  growLimb,
  type LimbOptions,
  scale,
  subtract,
  taper} from "../tree-parts";

/**
 * Plant structure: every part hangs off a stem and knows its path length from the root. The
 * mesh builder turns that path into the bend weight, so wind bends a plant from its root and
 * leaves, heads and berries move with the stem they sit on instead of pivoting on their own.
 */
export interface Attach {
  path: number;
  position: Vec3;
}

export interface Stem {
  paths: number[];
  points: Vec3[];
}

const UP: Vec3 = [0, 1, 0];


/** Unit axis with two unit vectors perpendicular to it (rings around a stalk or head). */
export const getAxisFrame = (direction: Vec3) => {
  const axis = normalize(direction);
  const helper: Vec3 = Math.abs(axis[1]) < 0.9 ? UP : [1, 0, 0];
  const first = normalize(cross(axis, helper));
  return { axis, first, second: cross(axis, first) };
};

const distance = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const createStem = (points: Vec3[], startPath = 0): Stem => {
  const paths = [startPath];
  for (let index = 1; index < points.length; index += 1) {
    paths.push(paths[index - 1]! + distance(points[index - 1]!, points[index]!));
  }
  return { paths, points };
};

/** A naturally curving stem growing from an attachment point. */
export const growStem = (options: LimbOptions, random: Random, startPath = 0) =>
  createStem(growLimb(options, random), startPath);

/** Grows a stem out of a point on its parent: the child continues the parent's path. */
export const branchFrom = (parent: Attach, options: Omit<LimbOptions, "start">, random: Random) =>
  growStem({ ...options, start: parent.position }, random, parent.path);

/** Position and path at a fraction of the stem's length. */
export const attachAlong = (stem: Stem, fraction: number): Attach => {
  const position = Math.min(1, Math.max(0, fraction)) * (stem.points.length - 1);
  const index = Math.min(stem.points.length - 2, Math.floor(position));
  const t = position - index;
  return {
    path: stem.paths[index]! + (stem.paths[index + 1]! - stem.paths[index]!) * t,
    position: lerp3(stem.points[index]!, stem.points[index + 1]!, t)
  };
};

export const getTip = (stem: Stem) => attachAlong(stem, 1);

/** Direction of the stem at a fraction of its length. */
export const getHeading = (stem: Stem, fraction: number): Vec3 => {
  const ahead = attachAlong(stem, Math.min(1, fraction + 0.05)).position;
  const behind = attachAlong(stem, Math.max(0, fraction - 0.05)).position;
  return normalize(subtract(ahead, behind));
};

/** Tapered woody or green stem tube (rings carry the stem path: no flutter). */
export const addStemTube = (
  builder: MeshBuilder,
  stem: Stem,
  radii: [number, number],
  segments: number,
  style: VertexStyle
) => {
  const tube = taper(stem.points.length, radii[0], radii[1]);
  addCurvedTube(builder, stem.points, tube, segments, style, stem.paths);
};

/** Horizontal unit vector at an azimuth. */
export const horizontal = (azimuth: number): Vec3 => [Math.cos(azimuth), 0, Math.sin(azimuth)];

export interface BladeOptions {
  /** Extra lean per unit of length towards the tip (arching blades). */
  arch: number;
  azimuth: number;
  /** Lean from vertical at the base, radians. */
  lean: number;
  length: number;
  segments: number;
  /** Flutter weight at the tip. */
  tipFlutter: number;
  width: number;
}

/** Centre line of a blade leaning towards an azimuth and arching over towards its tip. */
const getBladeLine = (root: Vec3, options: BladeOptions) => {
  const out = horizontal(options.azimuth);
  const points: Vec3[] = [root];
  const step = options.length / options.segments;
  let position = root;
  for (let index = 0; index < options.segments; index += 1) {
    const angle = options.lean + options.arch * ((index + 0.5) / options.segments);
    const direction = add(scale(out, Math.sin(angle)), scale(UP, Math.cos(angle)));
    position = add(position, scale(direction, step));
    points.push(position);
  }
  return points;
};

/**
 * Grass, sedge or reed leaf: a tapered strip of `segments` quads ending in a point. Normals lean
 * up (soft grass lighting); the tip flutters a little, the base is pinned to the root.
 */
export const addBlade = (
  builder: MeshBuilder,
  root: Attach,
  options: BladeOptions,
  style: VertexStyle
) => {
  const line = getBladeLine(root.position, options);
  const side = horizontal(options.azimuth + Math.PI / 2);
  const normal = normalize(add(scale(horizontal(options.azimuth), -0.35), UP));
  const first = builder.vertexCount;
  line.forEach((point, index) => {
    const t = index / options.segments;
    const wind = {
      flutter: t * t * options.tipFlutter,
      path: root.path + t * options.length
    };
    if (index === options.segments) {
      builder.addVertex(point, normal, style, NO_UV, wind);
      return;
    }
    const half = scale(side, options.width * 0.5 * Math.pow(1 - t, 0.6));
    builder.addVertex(subtract(point, half), normal, style, NO_UV, wind);
    builder.addVertex(add(point, half), normal, style, NO_UV, wind);
  });
  for (let index = 0; index < options.segments - 1; index += 1) {
    const a = first + index * 2;
    builder.addTriangle(a, a + 2, a + 1);
    builder.addTriangle(a + 1, a + 2, a + 3);
  }
  const last = first + (options.segments - 1) * 2;
  builder.addTriangle(last, last + 2, last + 1);
};

export interface LeafOptions {
  direction: Vec3;
  /** Downward curl of the tip (world units). */
  droop: number;
  length: number;
  width: number;
}

/**
 * Geometry leaf (diamond: base on the stem, two side points, tip). Lies roughly flat, faces up;
 * the base stays on its stem, side points and tip flutter.
 */
export const addLeaf = (
  builder: MeshBuilder,
  attach: Attach,
  options: LeafOptions,
  style: VertexStyle,
  flutter = 1,
  uv: Vec2 = NO_UV
) => {
  const along = normalize(options.direction);
  const side = normalize(cross(along, UP));
  const sideways = Math.hypot(side[0], side[2]) > 0.01 ? side : ([1, 0, 0] as Vec3);
  let normal = normalize(cross(sideways, along));
  if (normal[1] < 0) normal = scale(normal, -1);
  const base = attach.position;
  const middle = add(base, scale(along, options.length * 0.45));
  const tip = add(add(base, scale(along, options.length)), [0, -options.droop, 0]);
  const half = scale(sideways, options.width / 2);
  const corners: [Vec3, number][] = [
    [base, 0],
    [subtract(middle, half), 0.5],
    [tip, 1],
    [add(middle, half), 0.5]
  ];
  const first = builder.vertexCount;
  for (const [position, t] of corners) {
    const wind = { flutter: t * flutter, path: attach.path + t * options.length };
    builder.addVertex(position, normal, style, uv, wind);
  }
  builder.addTriangle(first, first + 1, first + 2);
  builder.addTriangle(first, first + 2, first + 3);
};

export interface SpindleOptions {
  axis: Vec3;
  length: number;
  /** Radius along the axis, t = 0 at the base .. 1 at the top. */
  profile: (t: number) => number;
  rings: number;
  sides: number;
}

/**
 * Small closed body around an axis (cattail head, buds, berries, thistle heads). It sits on its
 * stem: the whole body moves with the attachment point (heavy heads do not flutter).
 */
export const addSpindle = (
  builder: MeshBuilder,
  attach: Attach,
  options: SpindleOptions,
  style: VertexStyle
) => {
  const { axis, first, second } = getAxisFrame(options.axis);
  const wind = { flutter: 0, path: attach.path + options.length * 0.2 };
  const start = builder.vertexCount;
  for (let ring = 0; ring <= options.rings; ring += 1) {
    const t = ring / options.rings;
    const centre = add(attach.position, scale(axis, t * options.length));
    const radius = options.profile(t);
    for (let side = 0; side < options.sides; side += 1) {
      const angle = (side / options.sides) * Math.PI * 2;
      const out = add(scale(first, Math.cos(angle)), scale(second, Math.sin(angle)));
      const normal = normalize(add(out, scale(axis, (0.5 - t) * -1.2)));
      builder.addVertex(add(centre, scale(out, radius)), normal, style, NO_UV, wind);
    }
  }
  for (let ring = 0; ring < options.rings; ring += 1) {
    for (let side = 0; side < options.sides; side += 1) {
      const a = start + ring * options.sides + side;
      const b = start + ring * options.sides + ((side + 1) % options.sides);
      builder.addTriangle(a, b, a + options.sides);
      builder.addTriangle(b, b + options.sides, a + options.sides);
    }
  }
};

/** Rounded body profile (berries, buds): zero radius at both ends. */
export const roundProfile = (radius: number) => (t: number) => Math.sin(Math.PI * t) * radius;
