import { BufferGeometry, Float32BufferAttribute } from "three";

/** Open stave tube: outer wall, inner cavity and rim; the bottom sits on a disc or ground. */
export const createRomanStockBucket = (detailed: boolean) => {
  const count = detailed ? 16 : 8;
  const positions: number[] = [],
    uv: number[] = [],
    indices: number[] = [];
  const point = (radius: number, y: number, angle: number) => [
    Math.sin(angle) * radius,
    y,
    Math.cos(angle) * radius
  ];
  const quad = (points: number[][], start: number, end: number) => {
    const offset = positions.length / 3;
    for (const p of points) positions.push(...p);
    uv.push(start, 0, end, 0, end, 1, start, 1);
    indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
  };
  for (let side = 0; side < count; side++) {
    const a = (side * Math.PI * 2) / count,
      b = ((side + 1) * Math.PI * 2) / count;
    quad(
      [point(0.5, -0.5, a), point(0.5, -0.5, b), point(0.5, 0.5, b), point(0.5, 0.5, a)],
      side / count,
      (side + 1) / count
    );
    quad(
      [point(0.4, -0.5, b), point(0.4, -0.5, a), point(0.4, 0.5, a), point(0.4, 0.5, b)],
      (side + 1) / count,
      side / count
    );
    quad(
      [point(0.5, 0.5, a), point(0.5, 0.5, b), point(0.4, 0.5, b), point(0.4, 0.5, a)],
      side / count,
      (side + 1) / count
    );
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
};

/** A horizontal liquid surface instead of a solid cylinder filling the bucket mouth. */
export const createRomanBucketWater = (detailed: boolean) => {
  const count = detailed ? 16 : 8;
  const positions = [0, 0.5, 0],
    uv = [0.5, 0.5],
    indices: number[] = [];
  for (let side = 0; side < count; side++) {
    const angle = (side * Math.PI * 2) / count;
    const x = Math.sin(angle) * 0.5,
      z = Math.cos(angle) * 0.5;
    positions.push(x, 0.5, z);
    uv.push(x + 0.5, z + 0.5);
    indices.push(0, side + 1, ((side + 1) % count) + 1);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
};
