import { Vector3 } from "three";

import { TriangleGrid } from "../../../island-of-settlers-worker-generation/src/armour/triangle-grid";

export interface SurfaceCrossingWitness { edge: [number, number]; point: number[]; triangle: number }
export const SOURCE_CLOTH_RAY_OFFSET = .0001;
export const SOURCE_CLOTH_RAY_MINIMUM = .00002;
export const uniqueMeshEdges = (indices: readonly number[]) => {
  const edges = new Map<string, [number, number]>();
  for (let at = 0; at < indices.length; at += 3) for (let side = 0; side < 3; side++) {
    const a = indices[at + side]!, b = indices[at + (side + 1) % 3]!;
    edges.set([a, b].sort((a, b) => a - b).join(","), [a, b]);
  }
  return [...edges.values()];
};
export const surfaceBoundaryEdges = (indices: readonly number[]) => {
  const edges = new Map<string, { count: number; vertices: [number, number] }>();
  for (let at = 0; at < indices.length; at += 3) for (let side = 0; side < 3; side++) {
    const a = indices[at + side]!, b = indices[at + (side + 1) % 3]!;
    const key = [a, b].sort((a, b) => a - b).join(","), previous = edges.get(key);
    if (previous) previous.count++;
    else edges.set(key, { count: 1, vertices: [a, b] });
  }
  return [...edges.values()].filter(edge => edge.count === 1).map(edge => edge.vertices);
};
export const distanceToSurfaceBoundary = (point: Vector3, points: readonly Vector3[], edges: readonly [number, number][]) => {
  let distance = Infinity;
  const direction = new Vector3(), nearest = new Vector3();
  for (const [a, b] of edges) {
    direction.copy(points[b]!).sub(points[a]!);
    const lengthSquared = direction.lengthSq();
    const share = lengthSquared > 1e-18
      ? Math.max(0, Math.min(1, nearest.copy(point).sub(points[a]!).dot(direction) / lengthSquared)) : 0;
    nearest.copy(points[a]!).addScaledVector(direction, share);
    distance = Math.min(distance, nearest.distanceTo(point));
  }
  return distance;
};
export const countSurfaceCrossings = (points: Vector3[], edges: [number, number][], grid: TriangleGrid,
  witnesses?: SurfaceCrossingWitness[], limit = 8) => {
  let count = 0;
  for (const [a, b] of edges) {
    const direction = points[b]!.clone().sub(points[a]!), length = direction.length();
    if (length <= .0004) continue;
    const hit = grid.raycast(points[a]!, direction.divideScalar(length), .0002, length - .0002);
    if (!hit) continue;
    count++;
    if (witnesses && witnesses.length < limit) witnesses.push({ edge: [a, b], triangle: hit.triangle,
      point: points[a]!.clone().addScaledVector(direction, hit.distance).toArray() });
  }
  return count;
};

export const combinedClothGrid = (surfaces: { points: Vector3[]; indices: readonly number[] }[]) => {
  const points: Vector3[] = [], indices: number[] = [];
  for (const surface of surfaces) {
    const offset = points.length;
    points.push(...surface.points); indices.push(...surface.indices.map(vertex => vertex + offset));
  }
  return new TriangleGrid(points, indices);
};

/** Diagnose a potential skin exposure at an exact body/cloth intersection. Raw crossings also
 * include covered seam/internal-fold contacts. This normal-ray comparison is a focused source
 * regression witness; it does not replace a silhouette or same-camera native visual review. */
export const sourceClothContactCoverage = (point: Vector3, bodyTriangle: number,
  body: TriangleGrid, original: TriangleGrid, candidate: TriangleGrid) => {
  const direction = body.corner(bodyTriangle, 1).clone().sub(body.corner(bodyTriangle, 0))
    .cross(body.corner(bodyTriangle, 2).clone().sub(body.corner(bodyTriangle, 0)));
  if (direction.lengthSq() < 1e-18) throw new Error("A source coverage witness has a degenerate body facet");
  direction.normalize();
  const origin = point.clone().addScaledVector(direction, SOURCE_CLOTH_RAY_OFFSET);
  const sourceHit = original.raycast(origin, direction, SOURCE_CLOTH_RAY_MINIMUM, .25);
  const candidateHit = candidate.raycast(origin, direction, SOURCE_CLOTH_RAY_MINIMUM, .25);
  return { sourceCovered: Boolean(sourceHit), candidateCovered: Boolean(candidateHit),
    newExposure: Boolean(sourceHit && !candidateHit),
    sourceCoverDistance: sourceHit?.distance, candidateCoverDistance: candidateHit?.distance };
};
