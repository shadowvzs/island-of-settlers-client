type Point = readonly [number, number];

const distanceSquared = (point: Point, a: Point, b: Point) => {
  const dx = b[0] - a[0], dy = b[1] - a[1], length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length)) : 0;
  return (point[0] - a[0] - dx * t) ** 2 + (point[1] - a[1] - dy * t) ** 2;
};

const simplifyOpen = (points: readonly Point[], tolerance: number): Point[] => {
  if (points.length <= 2) return [...points];
  const first = points[0]!, last = points.at(-1)!;
  let farthest = -1, maximum = tolerance * tolerance;
  for (let index = 1; index < points.length - 1; index++) {
    const distance = distanceSquared(points[index]!, first, last);
    if (distance > maximum) { maximum = distance; farthest = index; }
  }
  if (farthest < 0) return [first, last];
  return [...simplifyOpen(points.slice(0, farthest + 1), tolerance).slice(0, -1),
    ...simplifyOpen(points.slice(farthest), tolerance)];
};

/** Subpixel contour simplification removes raster stair steps while preserving separate strokes/holes. */
export const simplifyGlyphContour = (points: readonly Point[], tolerance = .65): Point[] => {
  if (points.length < 5) return [...points];
  let opposite = 1, maximum = 0;
  for (let index = 1; index < points.length; index++) {
    const distance = distanceSquared(points[index]!, points[0]!, points[0]!);
    if (distance > maximum) { maximum = distance; opposite = index; }
  }
  return [...simplifyOpen(points.slice(0, opposite + 1), tolerance).slice(0, -1),
    ...simplifyOpen([...points.slice(opposite), points[0]!], tolerance).slice(0, -1)];
};
