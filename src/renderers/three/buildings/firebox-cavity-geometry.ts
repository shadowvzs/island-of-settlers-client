import { BufferGeometry, Float32BufferAttribute } from "three";

import type { BuildingPart } from "../../../render-common/buildings/building-recipe";
import { fireboxOutline } from "../../../render-common/buildings/roman-firebox-cavity";

type Vertex = number[];
type Plane = readonly [number, number, number, number];

/** Split a polygon against one convex-void plane while preserving all interpolated UV/normal attributes. */
const clip = (polygon: Vertex[], plane: Plane, inside: boolean): Vertex[] => {
  const result: Vertex[] = [], sign = inside ? 1 : -1;
  const distance = (v: Vertex) => sign * (plane[0] * v[0]! + plane[1] * v[1]! + plane[2] * v[2]! + plane[3]);
  for (let index = 0; index < polygon.length; index++) {
    const a = polygon[index]!, b = polygon[(index + 1) % polygon.length]!;
    const da = distance(a), db = distance(b), keepA = da >= -1e-10, keepB = db >= -1e-10;
    if (keepA) result.push(a);
    if (keepA !== keepB) {
      const t = da / (da - db);
      result.push(a.map((value, axis) => value + (b[axis]! - value) * t));
    }
  }
  return result;
};

/** Subtract an authored convex arched tunnel. Outer surfaces, UVs and normals remain the original geometry. */
export const cutFireboxCavityGeometry = (source: BufferGeometry, planes: readonly Plane[]) => {
  const attributes = Object.entries(source.attributes).sort(([a], [b]) => {
    if (a === "position") return -1;
    if (b === "position") return 1;
    return a.localeCompare(b);
  });
  const stride = attributes.reduce((sum, [, attribute]) => sum + attribute.itemSize, 0), output: number[] = [];
  const read = (index: number): Vertex => attributes.flatMap(([, attribute]) =>
    Array.from({ length: attribute.itemSize }, (_, axis) => attribute.array[index * attribute.itemSize + axis]!));
  const append = (polygon: Vertex[]) => {
    for (let index = 1; index + 1 < polygon.length; index++) output.push(...polygon[0]!, ...polygon[index]!, ...polygon[index + 1]!);
  };
  const count = source.index?.count ?? source.getAttribute("position").count;
  for (let at = 0; at < count; at += 3) {
    let remainder = [0, 1, 2].map(offset => read(source.index ? source.index.getX(at + offset) : at + offset));
    for (const plane of planes) {
      if (!remainder.length) break;
      append(clip(remainder, plane, false));
      remainder = clip(remainder, plane, true);
    }
  }
  const geometry = new BufferGeometry(); let offset = 0;
  for (const [name, attribute] of attributes) {
    const values: number[] = [];
    for (let at = 0; at < output.length; at += stride)
      for (let axis = 0; axis < attribute.itemSize; axis++) values.push(output[at + offset + axis]!);
    geometry.setAttribute(name, new Float32BufferAttribute(values, attribute.itemSize)); offset += attribute.itemSize;
  }
  geometry.normalizeNormals(); source.dispose();
  return geometry;
};

/** An open-front refractory tunnel: only the interior-facing reveals, no false black front cap. */
export const createFireboxRevealGeometry = (part: BuildingPart, detailed: boolean) => {
  const outline = fireboxOutline(part.fireboxSpring ?? -.1, detailed ? 12 : 6), positions: number[] = [], uv: number[] = [];
  for (let index = 0; index < outline.length; index++) {
    const a = outline[index]!, b = outline[(index + 1) % outline.length]!;
    const vertices = [[...a, -.5], [...a, .5], [...b, .5], [...a, -.5], [...b, .5], [...b, -.5]];
    for (const vertex of vertices) { positions.push(...vertex); uv.push(vertex[0]! + .5, vertex[2]! + .5); }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uv, 2)); geometry.computeVertexNormals();
  return geometry;
};
