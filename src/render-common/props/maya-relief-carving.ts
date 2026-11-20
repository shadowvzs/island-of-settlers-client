import { MeshBuilder, normalize, type Vec3, type VertexStyle } from "./mesh-builder";

type Point = readonly [number, number];
const cross = (a: Vec3, b: Vec3, c: Vec3): Vec3 => normalize([
  (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]),
  (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]),
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]),
]);

/** Chiselled convex relief with sloping bevels, full side walls and a bonded back. */
export const addMayaCarving = (builder: MeshBuilder, outline: readonly Point[], front: number,
  back: number, bevel: number, style: VertexStyle, bondedBack=false) => {
  let signedArea = 0;
  for (let index = 0; index < outline.length; index++) {
    const a = outline[index]!, b = outline[(index + 1) % outline.length]!;
    signedArea += a[0] * b[1] - b[0] * a[1];
  }
  if (signedArea < 0) outline = [...outline].reverse();
  const centre: Point = [outline.reduce((sum, p) => sum + p[0], 0) / outline.length,
    outline.reduce((sum, p) => sum + p[1], 0) / outline.length];
  const inner = outline.map(([x, y]): Vec3 => {
    const distance = Math.hypot(x - centre[0], y - centre[1]), factor = 1 - bevel / distance;
    return [centre[0] + (x - centre[0]) * factor, centre[1] + (y - centre[1]) * factor, front];
  });
  const outer = outline.map(([x, y]): Vec3 => [x, y, front - bevel * .9]);
  const rear = outline.map(([x, y]): Vec3 => [x, y, back]);
  const triangle = (a: Vec3, b: Vec3, c: Vec3) => {
    const normal = cross(a, b, c), start = builder.vertexCount;
    for (const point of [a, b, c]) builder.addVertex(point, normal, style, [point[0] + .5, point[1] + .5]);
    builder.addTriangle(start, start + 1, start + 2);
  };
  for (let index = 0; index < outline.length; index++) {
    const next = (index + 1) % outline.length;
    triangle([centre[0], centre[1], front], inner[index]!, inner[next]!);
    if(bevel>0) {
      triangle(inner[index]!, outer[index]!, outer[next]!); triangle(inner[index]!, outer[next]!, inner[next]!);
    }
    triangle(outer[index]!, rear[index]!, rear[next]!); triangle(outer[index]!, rear[next]!, outer[next]!);
    if(!bondedBack)triangle([centre[0], centre[1], back], rear[next]!, rear[index]!);
  }
};

export const mayaCarvingRectangle = (x: number, y: number, width: number, height: number): Point[] => [
  [x - width / 2, y - height / 2], [x + width / 2, y - height / 2],
  [x + width / 2, y + height / 2], [x - width / 2, y + height / 2],
];
