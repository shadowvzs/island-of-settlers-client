import { BufferGeometry, Float32BufferAttribute } from "three";

import { ROMAN_ROOF_TILE_SCALE } from "../../../render-common/buildings/roman-roof-tiles";

type Point = [number, number, number];
/** A low hipped clay roof around a true circular drum opening; individual tiles remain solid. */
export const createRomanCivicRoof = (detailed: boolean, width: number, depth: number) => {
  const positions: number[] = [],
    uv: number[] = [];
  const triangle = (a: Point, b: Point, c: Point) => {
    positions.push(...a, ...b, ...c);
    for (const p of [a, b, c]) uv.push(p[0] * 2 + 0.5, p[2] * 2 + 0.5);
  };
  const quad = (a: Point, b: Point, c: Point, d: Point) => {
    triangle(a, b, c);
    triangle(a, c, d);
  };
  const boundary = (angle: number, inner: boolean, lower = false): Point => {
    const x = Math.sin(angle),
      z = Math.cos(angle);
    const radius = inner
      ? 0.8
      : Math.min(
          width / 2 / Math.max(0.00001, Math.abs(x)),
          depth / 2 / Math.max(0.00001, Math.abs(z))
        );
    return [(x * radius) / width, (inner ? 0.5 : -0.5) - (lower ? 0.13 : 0), (z * radius) / depth];
  };
  const segments = detailed ? Math.ceil(24 / ROMAN_ROOF_TILE_SCALE) : 8;
  const courses = detailed ? Math.round(2 / ROMAN_ROOF_TILE_SCALE) : 1;
  for (let index = 0; index < segments; index++)
    for (let course = 0; course < courses; course++) {
      const left = (index * Math.PI * 2) / segments,
        right = ((index + 1) * Math.PI * 2) / segments;
      const inset = detailed ? 0.001 : 0;
      const interpolate = (angle: number, amount: number): Point => {
        const outer = boundary(angle, false),
          inner = boundary(angle, true);
        return outer.map((value, axis) => value + (inner[axis]! - value) * amount) as Point;
      };
      const low = detailed ? course / courses : 0,
        high = detailed ? (course + 1) / courses : 1;
      const a = interpolate(left + inset, low),
        b = interpolate(right - inset, low),
        c = interpolate(right - inset, high),
        d = interpolate(left + inset, high);
      const below = [a, b, c, d].map((p) => [p[0], p[1] - 0.13, p[2]] as Point);
      if (detailed) {
        // Solid shell below supplies the ceiling and buried edges between small clay courses.
        const crown: Point = [
          (a[0] + b[0] + c[0] + d[0]) / 4,
          (a[1] + b[1] + c[1] + d[1]) / 4 + 0.045 * ROMAN_ROOF_TILE_SCALE,
          (a[2] + b[2] + c[2] + d[2]) / 4
        ];
        for (const [start, end] of [
          [a, b],
          [b, c],
          [c, d],
          [d, a]
        ])
          triangle(start!, end!, crown);
        const lap = [a, b].map((p) => [p[0], p[1] - 0.13 * ROMAN_ROOF_TILE_SCALE, p[2]] as Point);
        quad(a, lap[0]!, lap[1]!, b);
      } else {
        quad(a, b, c, d);
        quad(a, below[0]!, below[1]!, b);
        quad(c, below[2]!, below[3]!, d);
      }
      if (!detailed) quad(below[3]!, below[2]!, below[1]!, below[0]!);
    }
  if (detailed) {
    // Continuous roof support retains the original hipped silhouette and open drum aperture.
    for (let index = 0; index < 24; index++) {
      const left = (index * Math.PI * 2) / 24,
        right = ((index + 1) * Math.PI * 2) / 24;
      const a = boundary(left, false),
        b = boundary(right, false);
      const c = boundary(right, true),
        d = boundary(left, true);
      const below = [a, b, c, d].map((p) => [p[0], p[1] - 0.13, p[2]] as Point);
      const support = [a, b, c, d].map((p) => [p[0], p[1] - 0.004, p[2]] as Point);
      quad(support[0]!, support[1]!, support[2]!, support[3]!);
      quad(a, below[0]!, below[1]!, b);
      quad(c, below[2]!, below[3]!, d);
      quad(below[3]!, below[2]!, below[1]!, below[0]!);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  geometry.computeVertexNormals();
  return geometry;
};
