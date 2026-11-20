import { BufferGeometry, Float32BufferAttribute } from "three";

/** Closed stone annulus with an empty center and inward-facing shaft walls. */
export const createHollowRingGeometry = (segments: number, arc = Math.PI * 2, innerRadius = 0.38) => {
  const geometry = new BufferGeometry(),
    positions: number[] = [],
    uv: number[] = [],
    indices: number[] = [];
  const quad = (points: number[][], start?: number, end?: number) => {
    const offset = positions.length / 3;
    points.forEach((point, i) => {
      positions.push(...point);
      if (start === undefined) uv.push(point[0]! + 0.5, point[2]! + 0.5);
      else uv.push(i === 1 || i === 2 ? end! : start, i >= 2 ? 1 : 0);
    });
    indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
  };
  for (let i = 0; i < segments; i++) {
    const a = (i * arc) / segments,
      b = ((i + 1) * arc) / segments;
    const p = (r: number, y: number, angle: number) => [
      Math.sin(angle) * r,
      y,
      Math.cos(angle) * r
    ];
    quad(
      [p(0.5, -0.5, a), p(0.5, -0.5, b), p(0.5, 0.5, b), p(0.5, 0.5, a)],
      i / segments,
      (i + 1) / segments
    );
    quad(
      [p(innerRadius, -0.5, b), p(innerRadius, -0.5, a), p(innerRadius, 0.5, a), p(innerRadius, 0.5, b)],
      (i + 1) / segments,
      i / segments
    );
    quad([p(0.5, 0.5, a), p(0.5, 0.5, b), p(innerRadius, 0.5, b), p(innerRadius, 0.5, a)]);
    quad([p(0.5, -0.5, b), p(0.5, -0.5, a), p(innerRadius, -0.5, a), p(innerRadius, -0.5, b)]);
  }
  if (arc < Math.PI * 2) {
    const p = (r: number, y: number, angle: number) => [
      Math.sin(angle) * r,
      y,
      Math.cos(angle) * r
    ];
    quad([p(innerRadius, -0.5, 0), p(0.5, -0.5, 0), p(0.5, 0.5, 0), p(innerRadius, 0.5, 0)]);
    quad([p(0.5, -0.5, arc), p(innerRadius, -0.5, arc), p(innerRadius, 0.5, arc), p(0.5, 0.5, arc)]);
  }
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
};
