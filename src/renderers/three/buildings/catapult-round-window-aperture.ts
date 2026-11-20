import { CHINESE_CATAPULT_ROUND_WINDOW } from "../../../render-common/buildings/catapult-chinese-round-window";

export type WallPoint = readonly [number, number, number];
const contour = (detailed: boolean): WallPoint[] => {
  const { centreY, radius } = CHINESE_CATAPULT_ROUND_WINDOW, segments = detailed ? 24 : 12;
  return Array.from({ length: segments }, (_, index) => {
    const angle = index / segments * Math.PI * 2;
    return [Math.cos(angle) * radius, centreY + Math.sin(angle) * radius, 0];
  });
};
const clip = (polygon: WallPoint[], a: WallPoint, b: WallPoint, inside: boolean) => {
  const output: WallPoint[] = [];
  const distance = (p: WallPoint) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  for (let index = 0; index < polygon.length; index++) {
    const start = polygon[index]!, end = polygon[(index + 1) % polygon.length]!;
    const from = distance(start), to = distance(end);
    const kept = inside ? from >= -1e-10 : from <= 1e-10;
    const nextKept = inside ? to >= -1e-10 : to <= 1e-10;
    if (kept) output.push(start);
    if (kept !== nextKept) {
      const t = from / (from - to);
      output.push(start.map((value, axis) => value + (end[axis]! - value) * t) as unknown as WallPoint);
    }
  }
  return output;
};

/** Cut both actual rear wall faces, without filling the window with a painted disk. */
export const cutChineseCatapultRoundWindow = (points: WallPoint[], detailed: boolean): WallPoint[][] => {
  const { centreY, radius } = CHINESE_CATAPULT_ROUND_WINDOW;
  if (points.some(point => point[2] > -.50) ||
    points.every(point => point[0] < -radius) || points.every(point => point[0] > radius) ||
    points.every(point => point[1] < centreY - radius) || points.every(point => point[1] > centreY + radius))
    return [points];
  const output: WallPoint[][] = [], circle = contour(detailed);
  let remaining = points;
  for (let index = 0; index < circle.length; index++) {
    const a = circle[index]!, b = circle[(index + 1) % circle.length]!;
    const outside = clip(remaining, a, b, false);
    if (outside.length >= 3) output.push(outside);
    remaining = clip(remaining, a, b, true);
    if (remaining.length < 3) break;
  }
  return output;
};

export const chineseCatapultRoundReveal = (detailed: boolean): WallPoint[][] => {
  const { innerZ, outerZ } = CHINESE_CATAPULT_ROUND_WINDOW, circle = contour(detailed);
  return circle.map((a, index) => {
    const b = circle[(index + 1) % circle.length]!;
    return [[a[0], a[1], outerZ], [b[0], b[1], outerZ],
      [b[0], b[1], innerZ], [a[0], a[1], innerZ]];
  });
};
