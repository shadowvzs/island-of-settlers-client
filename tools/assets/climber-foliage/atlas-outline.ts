export type OutlinePoint = [number, number];
type PointLike = readonly [number, number];

const cross = (o: PointLike, a: PointLike, b: PointLike) =>
  (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/** Counter-clockwise convex hull (Andrew's monotone chain), collinear points dropped. */
export const convexHull = (points: readonly PointLike[]): OutlinePoint[] => {
  const sorted = points.map((point): OutlinePoint => [point[0], point[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (sorted.length < 3) return sorted;
  const half = (input: OutlinePoint[]) => {
    const chain: OutlinePoint[] = [];
    for (const point of input) {
      while (chain.length >= 2 && cross(chain[chain.length - 2]!, chain[chain.length - 1]!, point) <= 0) chain.pop();
      chain.push(point);
    }
    chain.pop();
    return chain;
  };
  return [...half(sorted), ...half([...sorted].reverse())];
};

const lineIntersection = (a: OutlinePoint, b: OutlinePoint, c: OutlinePoint, d: OutlinePoint): OutlinePoint | null => {
  const rx = b[0] - a[0], ry = b[1] - a[1], sx = d[0] - c[0], sy = d[1] - c[1];
  const denominator = rx * sy - ry * sx;
  if (Math.abs(denominator) < 1e-12) return null;
  const t = ((c[0] - a[0]) * sy - (c[1] - a[1]) * sx) / denominator;
  const u = ((c[0] - a[0]) * ry - (c[1] - a[1]) * rx) / denominator;
  return t < 1 || u < 1 ? null : [a[0] + rx * t, a[1] + ry * t];
};

/**
 * Cost of replacing edge (i, i+1) by the intersection of its neighbouring edges: the added
 * triangle area, or Infinity when those edges diverge (the polygon would no longer enclose).
 */
const removalCost = (polygon: readonly OutlinePoint[], index: number) => {
  const count = polygon.length;
  const before = polygon[(index - 1 + count) % count]!, a = polygon[index]!;
  const b = polygon[(index + 1) % count]!, after = polygon[(index + 2) % count]!;
  const meet = lineIntersection(before, a, after, b);
  const outside = !meet || meet.some(value => value < 0 || value > 1);
  if (outside) return { cost: Infinity, meet: a };
  return { cost: Math.abs(cross(a, meet, b)) / 2, meet };
};

const splitLongestEdge = (polygon: OutlinePoint[]) => {
  let longest = 0, at = 0;
  polygon.forEach((point, index) => {
    const next = polygon[(index + 1) % polygon.length]!, length = Math.hypot(next[0] - point[0], next[1] - point[1]);
    if (length > longest) { longest = length; at = index; }
  });
  const a = polygon[at]!, b = polygon[(at + 1) % polygon.length]!;
  polygon.splice(at + 1, 0, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
};

/**
 * Smallest-growth reduction of a convex hull (inside the unit square) to exactly `count` vertices
 * that still enclose it and stay inside the unit square, so card UVs never reach a neighbouring tile.
 */
export const reduceConvexPolygon = (hull: readonly OutlinePoint[], count: number): OutlinePoint[] => {
  const polygon = hull.map(point => [...point] as OutlinePoint);
  while (polygon.length > count) {
    let best = { cost: Infinity, index: -1, meet: [0, 0] as OutlinePoint };
    for (let index = 0; index < polygon.length; index += 1) {
      const candidate = removalCost(polygon, index);
      if (candidate.cost < best.cost) best = { ...candidate, index };
    }
    if (best.index < 0) throw new Error("Outline cannot be reduced while enclosing the hull");
    polygon[best.index] = best.meet;
    polygon.splice((best.index + 1) % polygon.length, 1);
  }
  while (polygon.length < count) splitLongestEdge(polygon);
  return polygon;
};

/** True when every point lies inside or on the counter-clockwise convex polygon (tolerance in units). */
export const polygonEncloses = (polygon: readonly PointLike[], points: readonly PointLike[], tolerance = 1e-6) =>
  points.every(point => polygon.every((a, index) => {
    const b = polygon[(index + 1) % polygon.length]!, length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return cross(a, b, point) / length >= -tolerance;
  }));
