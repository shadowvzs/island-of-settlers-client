import { BufferGeometry, Float32BufferAttribute } from "three";

import type { Point3 } from "../../../render-common/buildings/building-recipe";
import { srgbToLinear } from "../../../render-common/color";

export type BambooRgb = readonly [number, number, number];
/** Wind attribute: culm phase, culm bend weight, leaf flutter weight. */
export type BambooSwayValue = readonly [phase: number, bend: number, flutter: number];

export interface BambooMeshBuffers {
  colours: number[];
  indices: number[];
  normals: number[];
  positions: number[];
  sway: number[];
  uvs: number[];
}
export interface BambooRing {
  centre: Point3;
  colour: BambooRgb;
  radius: number;
  sway: BambooSwayValue;
  v: number;
  /** Angular extent of this ring (centred on the tube's arc); a narrowing arc tapers an open sleeve. */
  arc?: number;
}
export interface BambooTube {
  /** Angular extent (2π closes the tube; less leaves an open slit, as in a culm sheath). */
  arc?: number;
  rings: readonly BambooRing[];
  sides: number;
  start?: number;
  u: readonly [number, number];
}

export const createBambooBuffers = (): BambooMeshBuffers =>
  ({ colours: [], indices: [], normals: [], positions: [], sway: [], uvs: [] });

export const addBambooVertex = (buffers: BambooMeshBuffers, position: Point3, normal: Point3,
  uv: readonly [number, number], colour: BambooRgb, sway: BambooSwayValue) => {
  buffers.positions.push(...position); buffers.normals.push(...normal); buffers.uvs.push(...uv);
  buffers.colours.push(...colour); buffers.sway.push(...sway);
  return buffers.positions.length / 3 - 1;
};

export const sub3 = (a: Point3, b: Point3): Point3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const cross3 = (a: Point3, b: Point3): Point3 =>
  [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const unit3 = (a: Point3): Point3 => {
  const length = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / length, a[1] / length, a[2] / length];
};
export const lerp3 = (a: Point3, b: Point3, t: number): Point3 =>
  [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** One stable frame for a whole tube, so its rings never twist against each other. */
export const bambooTubeFrame = (rings: readonly BambooRing[]) => {
  const axis = unit3(sub3(rings.at(-1)!.centre, rings[0]!.centre));
  const reference: Point3 = Math.abs(axis[1]) < .9 ? [0, 1, 0] : [1, 0, 0];
  const first = unit3(cross3(axis, reference));
  return { first, second: cross3(axis, first) };
};

const vertexDistance = ({ positions }: BambooMeshBuffers, first: number, second: number) => Math.hypot(
  positions[first * 3]! - positions[second * 3]!, positions[first * 3 + 1]! - positions[second * 3 + 1]!,
  positions[first * 3 + 2]! - positions[second * 3 + 2]!);

/** Smooth ring-to-ring tube with radial normals; quads join consecutive rings. */
export const addBambooTube = (buffers: BambooMeshBuffers, tube: BambooTube) => {
  const { first, second } = bambooTubeFrame(tube.rings);
  const arc = tube.arc ?? Math.PI * 2, start = tube.start ?? 0, stride = tube.sides + 1;
  const base = buffers.positions.length / 3;
  for (const ring of tube.rings) for (let side = 0; side <= tube.sides; side++) {
    const ringArc = ring.arc ?? arc, offset = start + (arc - ringArc) / 2;
    const angle = offset + ringArc * side / tube.sides, cosine = Math.cos(angle), sine = Math.sin(angle);
    const normal: Point3 = [first[0] * cosine + second[0] * sine, first[1] * cosine + second[1] * sine,
      first[2] * cosine + second[2] * sine];
    const position: Point3 = [ring.centre[0] + normal[0] * ring.radius, ring.centre[1] + normal[1] * ring.radius,
      ring.centre[2] + normal[2] * ring.radius];
    addBambooVertex(buffers, position, normal, [tube.u[0] + (tube.u[1] - tube.u[0]) * side / tube.sides, ring.v],
      ring.colour, ring.sway);
  }
  const tapered = tube.rings.some(ring => ring.arc !== undefined);
  for (let ring = 0; ring < tube.rings.length - 1; ring++) for (let side = 0; side < tube.sides; side++) {
    const a = base + ring * stride + side, b = a + stride;
    // A narrowing arc rotates the rows against each other: split along the shorter diagonal so no
    // triangle cuts inside the surface it wraps (a tapered sheath tongue).
    if (tapered && vertexDistance(buffers, a, b + 1) < vertexDistance(buffers, a + 1, b))
      buffers.indices.push(a, a + 1, b + 1, a, b + 1, b);
    else buffers.indices.push(a, a + 1, b, a + 1, b + 1, b);
  }
};

/** A closing cone from the last ring of the previous tube to an apex. */
export const addBambooApex = (buffers: BambooMeshBuffers, ringStart: number, sides: number, apex: Point3,
  normal: Point3, uv: readonly [number, number], colour: BambooRgb, sway: BambooSwayValue) => {
  const tip = addBambooVertex(buffers, apex, normal, uv, colour, sway);
  for (let side = 0; side < sides; side++) buffers.indices.push(ringStart + side, ringStart + side + 1, tip);
};

const linearColours = (colours: readonly number[]) => {
  const linear = new Float32Array(colours.length);
  for (let index = 0; index < colours.length; index += 3)
    linear.set(srgbToLinear(colours[index]!, colours[index + 1]!, colours[index + 2]!), index);
  return linear;
};

export const bambooGeometry = (buffers: BambooMeshBuffers, windMargin: number) => {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(buffers.positions, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(buffers.normals, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(buffers.uvs, 2));
  // Palettes are authored in sRGB (like every decoration palette); vertex colours are linear.
  geometry.setAttribute("color", new Float32BufferAttribute(linearColours(buffers.colours), 3));
  geometry.setAttribute("bambooSway", new Float32BufferAttribute(buffers.sway, 3));
  geometry.setIndex(buffers.indices);
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  // Sway moves the crown by a few decimetres; keep culling conservative.
  geometry.boundingSphere!.radius += windMargin;
  return geometry;
};
