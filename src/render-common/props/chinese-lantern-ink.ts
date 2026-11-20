import type { Vec3 } from "./mesh-builder";

export const CHINESE_LANTERN_PROFILE: [number, number][] = [
  [.10, .27], [.18, .31], [.27, .41], [.32, .55], [.31, .67], [.25, .77], [.13, .84],
];
type Point = readonly [number, number];

const clip = (polygon: Point[], distance: (point: Point) => number): Point[] => {
  const output: Point[] = [];
  for (let index = 0; index < polygon.length; index++) {
    const a = polygon[index]!, b = polygon[(index + 1) % polygon.length]!;
    const da = distance(a), db = distance(b);
    if (da >= -1e-10) output.push(a);
    if ((da < 0) === (db < 0)) continue;
    const t = da / (da - db);
    output.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return output;
};

/** Split ink at every silk facet and profile seam, so entire painted triangles remain on the cloth. */
export const lanternInkTriangles = (glyph: readonly number[], detailed: boolean): Vec3[][] => {
  const output: Vec3[][] = [], segments = detailed ? 48 : 12;
  for (let band = 1; band < CHINESE_LANTERN_PROFILE.length; band++) {
    const [r0, y0] = CHINESE_LANTERN_PROFILE[band - 1]!;
    const [r1, y1] = CHINESE_LANTERN_PROFILE[band]!;
    if (y1 < .39 || y0 > .72) continue;
    const radius = (y: number) => r0 + (r1 - r0) * (y - y0) / (y1 - y0);
    for (let facet = 0; facet < segments / 2; facet++) {
      const a = facet * Math.PI * 2 / segments, b = (facet + 1) * Math.PI * 2 / segments;
      const ax = Math.cos(a) * (1 + .02 * Math.cos(a * 12));
      const az = Math.sin(a) * (1 + .02 * Math.cos(a * 12));
      const bx = Math.cos(b) * (1 + .02 * Math.cos(b * 12));
      const bz = Math.sin(b) * (1 + .02 * Math.cos(b * 12));
      if (Math.min(ax * r0, ax * r1, bx * r0, bx * r1) > .151 ||
        Math.max(ax * r0, ax * r1, bx * r0, bx * r1) < -.151) continue;
      const project = ([x, y]: Point): Vec3 => {
        const r = radius(y), t = (x / r - ax) / (bx - ax);
        return [x, y, r * (az + (bz - az) * t) + .003];
      };
      for (let index = 0; index < glyph.length; index += 6) {
        const polygon: Point[] = [0, 1, 2].map(corner => [
          glyph[index + corner * 2]! * .30, .39 + glyph[index + corner * 2 + 1]! * .33,
        ]);
        output.push(...clipInkFacet(polygon, y0, y1, ax, bx, radius, project));
      }
    }
  }
  return output;
};

const clipInkFacet = (polygon: Point[], y0: number, y1: number, ax: number, bx: number,
  radius: (y: number) => number, project: (point: Point) => Vec3): Vec3[][] => {
  polygon = clip(polygon, point => point[1] - y0);
  polygon = clip(polygon, point => y1 - point[1]);
  polygon = clip(polygon, point => point[0] - bx * radius(point[1]));
  polygon = clip(polygon, point => ax * radius(point[1]) - point[0]);
  const output: Vec3[][] = [];
  for (let corner = 1; corner < polygon.length - 1; corner++) {
    const points = [polygon[0]!, polygon[corner]!, polygon[corner + 1]!];
    const [p, q, r] = points;
    if (Math.abs((q![0] - p![0]) * (r![1] - p![1]) -
      (q![1] - p![1]) * (r![0] - p![0])) < 1e-12) continue;
    output.push(points.map(project));
  }
  return output;
};
