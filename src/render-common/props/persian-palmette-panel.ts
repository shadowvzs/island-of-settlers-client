import { srgbToLinear } from "../color";
import { solid } from "./drink-crops/crop-mesh-parts";
import { cross, MeshBuilder, normalize, type Vec3 } from "./mesh-builder";

const STYLE = solid(srgbToLinear(.93, .83, .65));
const triangle = (builder: MeshBuilder, a: Vec3, b: Vec3, c: Vec3) => {
  const normal = normalize(cross([b[0] - a[0], b[1] - a[1], b[2] - a[2]],
    [c[0] - a[0], c[1] - a[1], c[2] - a[2]]));
  const start = builder.vertexCount;
  for (const point of [a, b, c]) builder.addVertex(point, normal, STYLE, [point[0] + .5, point[1] + .5]);
  builder.addTriangle(start, start + 1, start + 2);
};

/** Original fan-palmette and pearl-border stucco, an architectural panel rather than a late tile mural. */
export const createPersianPalmettePanel = (detailed: boolean) => {
  const builder = new MeshBuilder();
  const corners: Vec3[] = [[-.5, -.5, -.5], [.5, -.5, -.5], [.5, .5, -.5], [-.5, .5, -.5],
    [-.5, -.5, 0], [.5, -.5, 0], [.5, .5, 0], [-.5, .5, 0]];
  for (const [a, b, c, d] of [[4, 5, 6, 7], [3, 2, 1, 0], [0, 1, 5, 4],
    [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]) {
    triangle(builder, corners[a!]!, corners[b!]!, corners[c!]!);
    triangle(builder, corners[a!]!, corners[c!]!, corners[d!]!);
  }
  const leaves = detailed ? 9 : 7;
  for (let index = 0; index < leaves; index++) {
    const angle = -.98 + index / (leaves - 1) * 1.96;
    const length = .50 - Math.abs(angle) * .06, halfWidth = detailed ? .046 : .056;
    const centre: Vec3 = [Math.sin(angle) * .19, -.16 + Math.cos(angle) * .22, .055];
    const point = (along: number, across: number, z: number): Vec3 => [
      centre[0] + Math.sin(angle) * along + Math.cos(angle) * across,
      centre[1] + Math.cos(angle) * along - Math.sin(angle) * across, z,
    ];
    const outline = [point(-length / 2, 0, 0), point(-length * .12, -halfWidth, 0),
      point(length * .25, -halfWidth * .72, 0), point(length / 2, 0, 0),
      point(length * .25, halfWidth * .72, 0), point(-length * .12, halfWidth, 0)];
    const ridge = point(0, 0, .20);
    for (let edge = 0; edge < outline.length; edge++)
      triangle(builder, outline[edge]!, ridge, outline[(edge + 1) % outline.length]!);
  }
  triangle(builder, [-.035, -.33, .02], [.035, -.33, .02], [.02, -.16, .09]);
  triangle(builder, [-.035, -.33, .02], [.02, -.16, .09], [-.02, -.16, .09]);
  const pearls = detailed ? 24 : 8, sides = detailed ? 8 : 4;
  for (let index = 0; index < pearls; index++) {
    const angle = index / pearls * Math.PI * 2;
    const x = Math.cos(angle) * .447, y = Math.sin(angle) * .447, radius = detailed ? .027 : .037;
    for (let side = 0; side < sides; side++) {
      const a = side / sides * Math.PI * 2, b = (side + 1) / sides * Math.PI * 2;
      triangle(builder, [x + Math.cos(a) * radius, y + Math.sin(a) * radius, 0],
        [x + Math.cos(b) * radius, y + Math.sin(b) * radius, 0], [x, y, .12]);
    }
  }
  const mesh = builder.finish({ flex: 0 }); mesh.wind.fill(0);
  return mesh;
};
