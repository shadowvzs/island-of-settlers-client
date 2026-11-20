import type { Vector3 } from "three";

/** Conservative convex-hull ray clipping. Every plane bound includes EVERY input point plus
 *1nm, so numeric noise can only retain an uncertain intersection, never invent an obstruction.
 * Used only for3D clouds (mutable-vertex boxes); fixed triangles use the native ray predicate. */
export const clothHullRayInterval = (points: readonly Vector3[], origin: Vector3,
  direction: Vector3, near: number, far: number) => {
  let low = near, high = far;
  const planes = new Set<string>();
  for (let a = 0; a < points.length; a++) for (let b = a + 1; b < points.length; b++)
    for (let c = b + 1; c < points.length; c++) {
      const normal = points[b]!.clone().sub(points[a]!).cross(points[c]!.clone().sub(points[a]!));
      if (normal.lengthSq() < 1e-24) continue;
      normal.normalize();
      for (const sign of [-1, 1]) {
        const plane = normal.clone().multiplyScalar(sign);
        const key = plane.toArray().map(value => Math.round(value * 1e9)).join(",");
        if (planes.has(key)) continue;
        planes.add(key);
        const bound = Math.max(...points.map(point => point.dot(plane))) + 1e-9;
        const slope = direction.dot(plane), gap = bound - origin.dot(plane);
        if (Math.abs(slope) < 1e-14) {
          if (gap < 0) return null;
          continue;
        }
        const distance = gap / slope;
        if (slope > 0) high = Math.min(high, distance);
        else low = Math.max(low, distance);
        if (low > high) return null;
      }
    }
  return { low, high, planes: planes.size };
};
