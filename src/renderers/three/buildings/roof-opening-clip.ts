import { BufferGeometry, Float32BufferAttribute } from "three";

import type { RoofOpening } from "../../../render-common/buildings/building-recipe";

type ClipVertex = { color: number[]; position: number[]; uv: number[] };

/** Round holes are cut as a fine polygon: the chamfer stays under the tower body, out of sight. */
const OPENING_SIDES = 24;
const EPSILON = 1e-9;

const mixVertex = (a: ClipVertex, b: ClipVertex, share: number): ClipVertex => {
  const blend = (from: number[], to: number[]) => from.map((value, axis) =>
    value + (to[axis]! - value) * share);
  return { color: blend(a.color, b.color), position: blend(a.position, b.position), uv: blend(a.uv, b.uv) };
};

const clipHalfPlane = (polygon: readonly ClipVertex[], normalX: number, normalZ: number,
  opening: RoofOpening, limit: number, keepOutside: boolean) => {
  const output: ClipVertex[] = [];
  const distance = (vertex: ClipVertex) => (vertex.position[0]! - opening.x) * normalX +
    (vertex.position[2]! - opening.z) * normalZ - limit;
  for (let index = 0; index < polygon.length; index++) {
    const start = polygon[index]!, end = polygon[(index + 1) % polygon.length]!;
    const startDistance = distance(start), endDistance = distance(end);
    const startKept = keepOutside ? startDistance >= -EPSILON : startDistance <= EPSILON;
    const endKept = keepOutside ? endDistance >= -EPSILON : endDistance <= EPSILON;
    if (startKept) output.push(start);
    if (startKept !== endKept)
      output.push(mixVertex(start, end, startDistance / (startDistance - endDistance)));
  }
  return output;
};

/** Triangle parts outside a convex opening polygon, split exactly at its boundary. */
const subtractOpening = (polygon: readonly ClipVertex[], opening: RoofOpening) => {
  let remaining = [[...polygon]];
  const outside: ClipVertex[][] = [];
  const limit = opening.radius * Math.cos(Math.PI / OPENING_SIDES);
  for (let side = 0; side < OPENING_SIDES && remaining.length; side++) {
    const angle = (side + .5) * Math.PI * 2 / OPENING_SIDES;
    const normalX = Math.cos(angle), normalZ = Math.sin(angle), next: ClipVertex[][] = [];
    for (const piece of remaining) {
      const kept = clipHalfPlane(piece, normalX, normalZ, opening, limit, true);
      const inside = clipHalfPlane(piece, normalX, normalZ, opening, limit, false);
      if (kept.length >= 3) outside.push(kept);
      if (inside.length >= 3) next.push(inside);
    }
    remaining = next;
  }
  return outside;
};

const triangleBoundsMissOpening = (triangle: readonly ClipVertex[], opening: RoofOpening) => {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const vertex of triangle) {
    minX = Math.min(minX, vertex.position[0]!); maxX = Math.max(maxX, vertex.position[0]!);
    minZ = Math.min(minZ, vertex.position[2]!); maxZ = Math.max(maxZ, vertex.position[2]!);
  }
  return maxX < opening.x - opening.radius || minX > opening.x + opening.radius ||
    maxZ < opening.z - opening.radius || minZ > opening.z + opening.radius;
};

/**
 * Cuts the marked roof shell around a rising tower. Triangles are split at the opening, so a
 * coarse Roman slope and the fine Japanese tile grid both get the same clean hole. The opening
 * lies inside the tower body, which hides the raw roof-thickness edge and keeps every window.
 */
export const clipRoofTowerOpening = (source: BufferGeometry, opening: RoofOpening) => {
  const positions = source.getAttribute("position"), uv = source.getAttribute("uv"), color = source.getAttribute("color");
  const indices = source.index, count = indices?.count ?? positions.count;
  const vertexAt = (index: number): ClipVertex => ({
    color: color ? [color.getX(index), color.getY(index), color.getZ(index)] : [1, 1, 1],
    position: [positions.getX(index), positions.getY(index), positions.getZ(index)],
    uv: uv ? [uv.getX(index), uv.getY(index)] : [0, 0],
  });
  const output: ClipVertex[] = [];
  let touched = false;
  for (let at = 0; at < count; at += 3) {
    const triangle = Array.from({ length: 3 }, (_, corner) =>
      vertexAt(indices ? indices.getX(at + corner) : at + corner));
    if (triangleBoundsMissOpening(triangle, opening)) {
      output.push(...triangle);
      continue;
    }
    touched = true;
    const pieces = subtractOpening(triangle, opening);
    for (const piece of pieces) for (let corner = 1; corner < piece.length - 1; corner++)
      output.push(piece[0]!, piece[corner]!, piece[corner + 1]!);
  }
  if (!touched) return source;
  const geometry = new BufferGeometry(), outputPositions: number[] = [], outputUvs: number[] = [],
    outputColors: number[] = [];
  for (const vertex of output) {
    outputPositions.push(...vertex.position);
    outputUvs.push(...vertex.uv);
    outputColors.push(...vertex.color);
  }
  geometry.setAttribute("position", new Float32BufferAttribute(outputPositions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(outputUvs, 2));
  geometry.setAttribute("color", new Float32BufferAttribute(outputColors, 3));
  geometry.computeVertexNormals();
  source.dispose();
  return geometry;
};
