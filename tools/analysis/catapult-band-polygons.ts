import type { SectionGeometry } from "./catapult-hatch-sections";

type Point = [number, number];
const cross = (a: Point, b: Point, c: Point) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
export const convexBandHull = (points: Point[]): Point[] => {
  if (points.length < 3) return points;
  points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const lower: Point[] = [], upper: Point[] = [];
  for (const p of points) {
    while (lower.length > 1 && cross(lower.at(-2)!, lower.at(-1)!, p) <= 0) lower.pop();
    lower.push(p);
  }
  for (const p of points.toReversed()) {
    while (upper.length > 1 && cross(upper.at(-2)!, upper.at(-1)!, p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
};
/** Convex section envelope preserves X/Z correlation, including clipped triangle-edge events. */
export const hatchBandPolygons = (geometry: SectionGeometry[], yaw: number, step: number) => {
  const bands: Point[][] = Array.from({ length: Math.ceil(1.6 / step) }, () => []);
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const add = (i: number, x: number, z: number) => bands[i]?.push([x * c + z * s, z * c - x * s]);
  for (const { indices, vertices: v } of geometry) {
    for (const vertex of new Set(indices)) {
      const at = vertex * 3; add(Math.floor(v[at + 1]! / step), v[at]!, v[at + 2]!);
    }
    for (let at = 0; at < indices.length; at += 3) for (let edge = 0; edge < 3; edge++) {
      const a = indices[at + edge]! * 3, b = indices[at + (edge + 1) % 3]! * 3;
      const y0 = v[a + 1]!, y1 = v[b + 1]!;
      if (Math.abs(y1 - y0) < 1e-10) continue;
      const low = Math.max(0, Math.ceil(Math.min(y0, y1) / step));
      const high = Math.min(bands.length, Math.floor(Math.max(y0, y1) / step));
      for (let boundary = low; boundary <= high; boundary++) {
        const t = (boundary * step - y0) / (y1 - y0);
        const x = v[a]! + (v[b]! - v[a]!) * t, z = v[a + 2]! + (v[b + 2]! - v[a + 2]!) * t;
        add(boundary - 1, x, z); add(boundary, x, z);
      }
    }
  }
  return bands.map(convexBandHull);
};
