import { ExtrudeGeometry, Shape } from "three";

export type MillSailPoint = readonly [number, number];

/** Exact authored straight boundary, retained for the owner's Roman/Viking exception. */
export const createStraightMillSail = (outline: readonly MillSailPoint[], depth = .008) => {
  const shape = new Shape();
  outline.forEach(([x, y], index) => index ? shape.lineTo(x, y) : shape.moveTo(x, y)); shape.closePath();
  const geometry = new ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 1, curveSegments: 1 });
  const minX = Math.min(...outline.map(point => point[0])), maxX = Math.max(...outline.map(point => point[0]));
  const minY = Math.min(...outline.map(point => point[1])), maxY = Math.max(...outline.map(point => point[1]));
  const positions = geometry.getAttribute("position"), uv = geometry.getAttribute("uv");
  for (let index = 0; index < positions.count; index++) uv.setXY(index,
    (positions.getX(index) - minX) / (maxX - minX), (positions.getY(index) - minY) / (maxY - minY));
  return { geometry, outline };
};

/** The full outer edge forms a rounded cap; its profile stays inside the old blade envelope. */
export const createFinishedMillSail = (outline: readonly MillSailPoint[], detailed: boolean) => {
  const profile = outline.map(point => [...point] as [number, number]);
  let tip = 0;
  for (let index = 1; index < profile.length; index++) {
    const next = (index + 1) % profile.length, bestNext = (tip + 1) % profile.length;
    if (profile[index]![1] + profile[next]![1] > profile[tip]![1] + profile[bestNext]![1]) tip = index;
  }
  if (tip === profile.length - 1) { profile.push(profile.shift()!); tip--; }
  const end = tip + 1, first = profile[tip]!, last = profile[end]!;
  const depth = Math.min(.14, Math.hypot(last[0] - first[0], last[1] - first[1]) * .35,
    (Math.min(first[1], last[1]) - Math.min(...profile.map(point => point[1]))) * .8);
  const control: MillSailPoint = [(first[0] + last[0]) / 2, (first[1] + last[1]) / 2 + depth];
  first[1] -= depth; last[1] -= depth;
  const shape = new Shape();
  const toward = (point: MillSailPoint, neighbour: MillSailPoint): MillSailPoint => {
    const length = Math.hypot(neighbour[0] - point[0], neighbour[1] - point[1]);
    const fraction = Math.min(.22, .025 / Math.max(length, .00001));
    return [point[0] + (neighbour[0] - point[0]) * fraction,
      point[1] + (neighbour[1] - point[1]) * fraction];
  };
  profile.forEach((point, index) => {
    if (index === end) return;
    if (index === tip) {
      if (index) shape.lineTo(...first); else shape.moveTo(...first);
      const segments = detailed ? 8 : 5;
      for (let step = 1; step <= segments; step++) {
        const t = step / segments, v = 1 - t;
        shape.lineTo(v * v * first[0] + 2 * v * t * control[0] + t * t * last[0],
          v * v * first[1] + 2 * v * t * control[1] + t * t * last[1]);
      }
      return;
    }
    const start = toward(point, profile[(index + profile.length - 1) % profile.length]!);
    const finish = toward(point, profile[(index + 1) % profile.length]!);
    if (index) shape.lineTo(...start); else shape.moveTo(...start);
    shape.quadraticCurveTo(...point, ...finish);
  });
  shape.closePath();
  const points = shape.getPoints(detailed ? 4 : 2).map(point => [point.x, point.y] as MillSailPoint);
  const geometry = new ExtrudeGeometry(shape, { curveSegments: detailed ? 4 : 2,
    depth: .009, bevelEnabled: false, steps: 1 });
  const minX = Math.min(...points.map(point => point[0])), maxX = Math.max(...points.map(point => point[0]));
  const minY = Math.min(...points.map(point => point[1])), maxY = Math.max(...points.map(point => point[1]));
  const positions = geometry.getAttribute("position"), uv = geometry.getAttribute("uv");
  for (let index = 0; index < positions.count; index++) uv.setXY(index,
    (positions.getX(index) - minX) / (maxX - minX), (positions.getY(index) - minY) / (maxY - minY));
  return { geometry, outline: points };
};

/** Real polygon distance makes the subtle binding follow triangular, rounded and irregular tips. */
export const millSailEdgeContact = (outline: readonly MillSailPoint[], x: number, y: number) => {
  let distance = Infinity, along = 0, perimeter = 0;
  for (let index = 0; index < outline.length; index++) {
    const start = outline[index]!, end = outline[(index + 1) % outline.length]!;
    const dx = end[0] - start[0], dy = end[1] - start[1], length = Math.hypot(dx, dy);
    const t = Math.max(0, Math.min(1, ((x - start[0]) * dx + (y - start[1]) * dy) / Math.max(length ** 2, 1e-12)));
    const candidate = Math.hypot(x - start[0] - dx * t, y - start[1] - dy * t);
    if (candidate < distance) { distance = candidate; along = perimeter + length * t; }
    perimeter += length;
  }
  return { distance, along };
};
