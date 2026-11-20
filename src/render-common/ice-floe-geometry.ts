import { createRandom, type Random } from "../shared/world/rng";
import type { IceFloe } from "./ice-floe-placement";

/**
 * Winter ice floes: every floe is its own irregular slab (10..15 sided star-shaped outline,
 * elongated and lobed per floe, so no two floes repeat) merged into one static buffer, drawn in a
 * single call. Rings per floe: a slightly domed top centre, the top's inner ring, the rounded
 * top edge (bevel, twice: smooth towards the top, a crisp corner to the wall) and the submerged
 * foot. 5 triangles per side (50..75 per floe).
 */
export interface IceFloeMeshData {
  /** Per vertex: floe centre x, water surface, centre z, water depth at the centre. */
  centers: Float32Array;
  /** Per vertex: snow share (top 1 .. sides 0), height above the waterline (cells), seed, freeboard. */
  ice: Float32Array;
  indices: Uint32Array;
  /** Per floe: first index and index count (a floe in kept-open water is left out of the index). */
  ranges: Uint32Array;
  /** Vertex positions relative to the floe centre on the water surface (tilt baked in). */
  positions: Float32Array;
  normals: Float32Array;
  triangles: number;
}

/** Rings: top inner, top edge (bevel side), top edge (wall side), foot; the centre vertex comes first. */
const RINGS = 4;
/** Ring pairs joined by a band of quads: the bevel and the wall (the two edge rings share positions). */
const BANDS = [[0, 1], [2, 3]] as const;
const TRIANGLES_PER_SIDE = 5;
const MAX_TILT_SLOPE = 0.035;
const MIN_FREEBOARD = 0.12;
const MIN_SIDES = 10;
const MAX_SIDES = 15;

interface FloeShape {
  bevel: number;
  freeboard: number;
  outline: Float32Array;
  sides: number;
  submerged: number;
  tiltX: number;
  tiltZ: number;
}

/** Star-shaped irregular outline (x, z pairs) whose farthest point sits on the floe radius. */
const createOutline = (floe: IceFloe, sides: number, random: Random) => {
  const outline = new Float32Array(sides * 2);
  const heading = random() * Math.PI * 2;
  const stretch = 0.62 + random() * 0.38;
  const lobePhase = random() * Math.PI * 2, lobeCount = 2 + Math.floor(random() * 2);
  let farthest = 0;
  for (let side = 0; side < sides; side++) {
    const angle = ((side + (random() - 0.5) * 0.55) / sides) * Math.PI * 2;
    const lobes = 1 + 0.16 * Math.sin(angle * lobeCount + lobePhase);
    const radial = (side % 2 === 0 ? 0.84 + random() * 0.24 : 0.74 + random() * 0.3) * lobes;
    const localX = Math.cos(angle) * radial, localZ = Math.sin(angle) * radial * stretch;
    const x = localX * Math.cos(heading) - localZ * Math.sin(heading);
    const z = localX * Math.sin(heading) + localZ * Math.cos(heading);
    outline[side * 2] = x;
    outline[side * 2 + 1] = z;
    farthest = Math.max(farthest, Math.hypot(x, z));
  }
  for (let index = 0; index < outline.length; index++) outline[index] = (outline[index]! / farthest) * floe.radius;
  return outline;
};

const createShape = (floe: IceFloe): FloeShape => {
  const random = createRandom(Math.floor(floe.seed * 2 ** 31));
  const sides = MIN_SIDES + Math.floor(random() * (MAX_SIDES - MIN_SIDES + 1));
  const size = Math.min(1, floe.radius / 2);
  const freeboard = 0.15 + 0.2 * Math.min(1, random() * 0.55 + size * 0.45) * (1 - 0.3 * floe.offshore);
  const slope = Math.min(MAX_TILT_SLOPE * random(), Math.max(0, (freeboard - MIN_FREEBOARD) / floe.radius));
  const tiltAngle = random() * Math.PI * 2;
  return {
    bevel: Math.min(0.1, freeboard * 0.45),
    freeboard,
    outline: createOutline(floe, sides, random),
    sides,
    submerged: Math.max(0.05, Math.min(freeboard, floe.minDepth - 0.08)),
    tiltX: Math.cos(tiltAngle) * slope,
    tiltZ: Math.sin(tiltAngle) * slope
  };
};

/** Ring radius scale and height of a ring vertex (above the waterline, tilt applied to the top rings). */
const getRingPoint = (shape: FloeShape, ring: number, x: number, z: number, random: Random) => {
  const tilt = x * shape.tiltX + z * shape.tiltZ;
  const length = Math.hypot(x, z);
  if (ring === 0) {
    const inset = Math.max(0.2, 1 - (shape.bevel * 1.2) / length);
    return { scale: inset, y: shape.freeboard + tilt + (random() - 0.5) * 0.025 };
  }
  if (ring === 1 || ring === 2) return { scale: 1, y: shape.freeboard - shape.bevel * 0.85 + tilt };
  return { scale: 1 + random() * 0.06, y: -shape.submerged };
};

/** Snow share of a ring: the top and its rounded edge carry snow, the walls are bare ice. */
const RING_SNOW = [1, 0.35, 0.35, 0] as const;

const accumulateNormal = (normals: Float32Array, positions: Float32Array, a: number, b: number, c: number) => {
  const ax = positions[a * 3]!, ay = positions[a * 3 + 1]!, az = positions[a * 3 + 2]!;
  const ux = positions[b * 3]! - ax, uy = positions[b * 3 + 1]! - ay, uz = positions[b * 3 + 2]! - az;
  const vx = positions[c * 3]! - ax, vy = positions[c * 3 + 1]! - ay, vz = positions[c * 3 + 2]! - az;
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  for (const vertex of [a, b, c]) {
    normals[vertex * 3] = normals[vertex * 3]! + nx;
    normals[vertex * 3 + 1] = normals[vertex * 3 + 1]! + ny;
    normals[vertex * 3 + 2] = normals[vertex * 3 + 2]! + nz;
  }
};

const normalize = (normals: Float32Array, from: number, to: number) => {
  for (let vertex = from; vertex < to; vertex++) {
    const length = Math.hypot(normals[vertex * 3]!, normals[vertex * 3 + 1]!, normals[vertex * 3 + 2]!) || 1;
    for (let axis = 0; axis < 3; axis++) normals[vertex * 3 + axis]! /= length;
  }
};

interface MeshCursor { index: number; vertex: number }

/** Writes one floe's vertices, indices and smooth (area-weighted) normals at the cursor. */
const writeFloe = (data: IceFloeMeshData, floe: IceFloe, cursor: MeshCursor) => {
  const shape = createShape(floe);
  const random = createRandom(Math.floor(floe.seed * 2 ** 29) + 7);
  const { sides } = shape;
  const first = cursor.vertex;
  const setVertex = (vertex: number, x: number, y: number, z: number, snow: number) => {
    data.positions.set([x, y, z], vertex * 3);
    data.centers.set([floe.x, floe.surface, floe.z, floe.depth], vertex * 4);
    data.ice.set([snow, y, floe.seed, shape.freeboard], vertex * 4);
  };
  setVertex(first, 0, shape.freeboard + 0.02 + random() * 0.03, 0, 1);
  for (let ring = 0; ring < RINGS; ring++)
    for (let side = 0; side < sides; side++) {
      const x = shape.outline[side * 2]!, z = shape.outline[side * 2 + 1]!;
      const { scale, y } = getRingPoint(shape, ring, x, z, random);
      setVertex(first + 1 + ring * sides + side, x * scale, y, z * scale, RING_SNOW[ring]!);
    }
  const ringVertex = (ring: number, side: number) => first + 1 + ring * sides + (side % sides);
  const pushTriangle = (a: number, b: number, c: number) => {
    data.indices.set([a, b, c], cursor.index);
    cursor.index += 3;
    accumulateNormal(data.normals, data.positions, a, b, c);
  };
  const start = cursor.index;
  for (let side = 0; side < sides; side++) pushTriangle(first, ringVertex(0, side + 1), ringVertex(0, side));
  for (const [top, bottom] of BANDS)
    for (let side = 0; side < sides; side++) {
      const upper = ringVertex(top, side), upperNext = ringVertex(top, side + 1);
      const lower = ringVertex(bottom, side), lowerNext = ringVertex(bottom, side + 1);
      pushTriangle(upper, upperNext, lower);
      pushTriangle(upperNext, lowerNext, lower);
    }
  cursor.vertex = first + 1 + RINGS * sides;
  normalize(data.normals, first, cursor.vertex);
  return { count: cursor.index - start, start };
};

export const createIceFloeMesh = (floes: readonly IceFloe[]): IceFloeMeshData => {
  const maxVertices = floes.length * (1 + RINGS * MAX_SIDES);
  const data: IceFloeMeshData = {
    centers: new Float32Array(maxVertices * 4),
    ice: new Float32Array(maxVertices * 4),
    indices: new Uint32Array(floes.length * MAX_SIDES * TRIANGLES_PER_SIDE * 3),
    normals: new Float32Array(maxVertices * 3),
    positions: new Float32Array(maxVertices * 3),
    ranges: new Uint32Array(floes.length * 2),
    triangles: 0
  };
  const cursor: MeshCursor = { index: 0, vertex: 0 };
  floes.forEach((floe, floeIndex) => {
    const { count, start } = writeFloe(data, floe, cursor);
    data.ranges[floeIndex * 2] = start;
    data.ranges[floeIndex * 2 + 1] = count;
  });
  return {
    centers: data.centers.slice(0, cursor.vertex * 4),
    ice: data.ice.slice(0, cursor.vertex * 4),
    indices: data.indices.slice(0, cursor.index),
    normals: data.normals.slice(0, cursor.vertex * 3),
    positions: data.positions.slice(0, cursor.vertex * 3),
    ranges: data.ranges,
    triangles: cursor.index / 3
  };
};
