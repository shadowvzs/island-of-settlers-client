import { srgbToLinear } from "../color";
import { solid } from "./drink-crops/crop-mesh-parts";
import { cross, MeshBuilder, normalize, type Vec3 } from "./mesh-builder";
import { addCurvedTube } from "./tree-parts";

const subtract = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const STYLE = solid(srgbToLinear(.96, .90, .76));

/** Raised lanceolate plaster leaf: a central ridge and sculpted shoulders, not a painted ellipse. */
const leaf = (builder: MeshBuilder, x: number, y: number, length: number, width: number, angle: number) => {
  const c = Math.cos(angle), s = Math.sin(angle);
  const point = (px: number, py: number, pz: number): Vec3 => [x + px * c - py * s, y + px * s + py * c, pz];
  const outline: Vec3[] = [point(0, -.5 * length, .02), point(-width * .44, -.1 * length, .025),
    point(-width * .34, .22 * length, .03), point(0, .5 * length, .025),
    point(width * .34, .22 * length, .03), point(width * .44, -.1 * length, .025)];
  const ridge = point(0, 0, .13);
  for (let index = 0; index < outline.length; index++) {
    const a = outline[index]!, b = outline[(index + 1) % outline.length]!;
    const normal = normalize(cross(subtract(ridge, a), subtract(b, a)));
    const start = builder.vertexCount;
    for (const vertex of [a, ridge, b]) builder.addVertex(vertex, normal, STYLE);
    builder.addTriangle(start, start + 1, start + 2);
  }
};

/** Original mirrored arabesque scrolls, with a raised eight-petal rosette; all plaster stays static. */
export const createPersianStuccoRelief = (detailed: boolean) => {
  const builder = new MeshBuilder(), steps = detailed ? 18 : 9;
  for (const side of [-1, 1]) {
    const path: Vec3[] = [];
    for (let index = 0; index <= steps; index++) {
      const share = index / steps, angle = -Math.PI * .55 + share * Math.PI * 2.05;
      const radius = .24 * (1 - share * .72);
      path.push([side * (.16 + Math.cos(angle) * radius), -.09 + share * .3 + Math.sin(angle) * radius, .035]);
    }
    addCurvedTube(builder, [[0, -.46, .035], [side * .12, -.29, .035], ...path],
      path.map(() => .016).concat([.016, .016]), detailed ? 6 : 4, STYLE);
    const leaves = detailed ? 6 : 4;
    for (let index = 0; index < leaves; index++) {
      const source = path[Math.round((index + .3) / leaves * steps)]!;
      leaf(builder, source[0] + side * .035, source[1], .12, .065, side * (-.35 + index * .44));
    }
  }
  for (let petal = 0; petal < 8; petal++) {
    const angle = petal / 8 * Math.PI * 2;
    leaf(builder, Math.sin(angle) * .068, .34 + Math.cos(angle) * .068, .105, .048, -angle);
  }
  const mesh = builder.finish({ flex: 0 });
  mesh.wind.fill(0);
  return mesh;
};
