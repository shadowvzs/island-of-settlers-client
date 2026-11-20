import { srgbToLinear } from "../color";
import { cross, MeshBuilder, normalize, type Vec3, type VertexStyle } from "./mesh-builder";

export type PersianAwningWall = readonly [number, number, number, number];
const PALETTE = [[.16, .33, .57], [.78, .57, .25], [.89, .83, .65]] as const;

/** Sewn opaque cloth with six distinct woven stripes, draped between its actual wall and timber frame. */
export const createPersianStripedAwning = (detailed: boolean, wall?: PersianAwningWall) => {
  const builder = new MeshBuilder(), columns = detailed ? 12 : 6, rows = detailed ? 6 : 3;
  const inner = (u: number) => {
    if (!wall) return -.5;
    const [rx, rz, offset, centre] = wall;
    return rx * Math.sqrt(Math.max(0, 1 - ((offset + u) / rz) ** 2)) - centre;
  };
  const at = (u: number, v: number, lower = false): Vec3 => [u,
    .5 - v * .25 - Math.sin(v * Math.PI) * (.28 + Math.cos(u * Math.PI * 2) * .025) * (1 - 4 * u * u) - (lower ? .012 : 0),
    inner(u) * (1 - v) + .5 * v];
  const triangle = (a: Vec3, b: Vec3, c: Vec3, style: VertexStyle) => {
    const normal = normalize(cross([b[0] - a[0], b[1] - a[1], b[2] - a[2]],
      [c[0] - a[0], c[1] - a[1], c[2] - a[2]]));
    const start = builder.vertexCount;
    for (const point of [a, b, c]) builder.addVertex(point, normal, style, [point[0] + .5, point[2] + .5]);
    builder.addTriangle(start, start + 1, start + 2);
  };
  const quad = (a: Vec3, b: Vec3, c: Vec3, d: Vec3, style: VertexStyle) => {
    triangle(a, b, c, style); triangle(a, c, d, style);
  };
  for (let column = 0; column < columns; column++) {
    const u0 = column / columns - .5, u1 = (column + 1) / columns - .5;
    const pigment = PALETTE[Math.floor((column + .5) / columns * 6) % 3]!;
    const colour = srgbToLinear(pigment[0], pigment[1], pigment[2]);
    const style: VertexStyle = { color: () => colour, flutter: 0 };
    for (let row = 0; row < rows; row++) {
      const v0 = row / rows, v1 = (row + 1) / rows;
      const a = at(u0, v0), b = at(u1, v0), c = at(u1, v1), d = at(u0, v1);
      const aa = at(u0, v0, true), bb = at(u1, v0, true), cc = at(u1, v1, true), dd = at(u0, v1, true);
      quad(a, d, c, b, style); quad(aa, bb, cc, dd, style);
      if (column === 0) quad(a, aa, dd, d, style);
      if (column === columns - 1) quad(b, c, cc, bb, style);
      if (row === 0) quad(a, b, bb, aa, style);
      if (row === rows - 1) quad(d, dd, cc, c, style);
    }
    const low = (u: number): Vec3 => [u, -.35 + Math.cos(u * Math.PI * 12) * .035, .5];
    const a = at(u0, 1), b = at(u1, 1), c = low(u1), d = low(u0);
    const back = (p: Vec3): Vec3 => [p[0], p[1], p[2] - .012];
    quad(a, d, c, b, style); quad(back(a), back(b), back(c), back(d), style);
    quad(a, b, back(b), back(a), style); quad(d, back(d), back(c), c, style);
    if (column === 0) quad(a, back(a), back(d), d, style);
    if (column === columns - 1) quad(b, c, back(c), back(b), style);
  }
  const mesh = builder.finish({ flex: 0 }); mesh.wind.fill(0);
  return mesh;
};
