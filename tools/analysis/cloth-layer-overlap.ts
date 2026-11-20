import { Vector3 } from "three";

import { TriangleGrid } from "../../../island-of-settlers-worker-generation/src/armour/triangle-grid";

interface Surface { indices: number[]; points: Vector3[] }
const edgeKey = (a: Vector3, b: Vector3) => [a, b].map(point =>
  point.toArray().map(value => value.toFixed(5)).join(",")).sort().join("/");
const edgeIncidence = ({ indices, points }: Surface) => {
  const edges = new Map<string, { count: number; triangles: Set<number> }>();
  for (let at = 0; at < indices.length; at += 3) for (let side = 0; side < 3; side++) {
    const key = edgeKey(points[indices[at + side]!]!, points[indices[at + (side + 1) % 3]!]!);
    const edge = edges.get(key) ?? { count: 0, triangles: new Set<number>() };
    edge.count++; edge.triangles.add(at / 3); edges.set(key, edge);
  }
  return edges;
};

/** Actual posed edge/surface crossings, in both directions; no silhouette or AABB substitution. */
export const clothLayerOverlap = (linen: Surface, outer: Surface, minimumY: number) => {
  const witnesses: { edgeOwner: string; vertices: number[]; point: number[]; triangle: number }[] = [];
  let crossings = 0, sharedBoundaryEdges = 0;
  for (const [label, source, target] of [["linen", linen, outer], ["outer", outer, linen]] as const) {
    const surface = new TriangleGrid(target.points, target.indices), seen = new Set<string>();
    const sourceEdges = edgeIncidence(source), targetEdges = edgeIncidence(target);
    sharedBoundaryEdges += [...sourceEdges].filter(([key, edge]) => edge.count === 1
      && targetEdges.get(key)?.count === 1).length;
    for (let at = 0; at < source.indices.length; at += 3) for (let edge = 0; edge < 3; edge++) {
      const a = source.indices[at + edge]!, b = source.indices[at + (edge + 1) % 3]!;
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const start = source.points[a]!, end = source.points[b]!;
      if (Math.min(start.y, end.y) < minimumY) continue;
      const direction = end.clone().sub(start), length = direction.length();
      if (length < .0002) continue;
      const physicalKey = edgeKey(start, end), shared = targetEdges.get(physicalKey);
      const sharedBoundary = sourceEdges.get(physicalKey)?.count === 1 && shared?.count === 1;
      // Two materials intentionally meet on an identical sewn edge. Float GLB roundtrip noise
      // must not classify its incident triangle as a penetration; nonlocal hits still count.
      const hit = surface.raycast(start, direction.normalize(), .0001, length - .0001,
        candidate => !sharedBoundary || !shared.triangles.has(candidate.triangle));
      if (!hit) continue;
      crossings++;
      if (witnesses.length < 4) witnesses.push({ edgeOwner: label, vertices: [a, b], triangle: hit.triangle,
        point: start.clone().addScaledVector(direction, hit.distance).toArray() });
    }
  }
  return { crossings, sharedBoundaryEdges, witnesses };
};
