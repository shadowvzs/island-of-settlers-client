import { toBarkUv } from "../../trees/bark-uv";
import { BIRCH_LEAF_RECT } from "../../trees/foliage-atlas";
import { MeshBuilder, normalize, type Vec3 } from "../mesh-builder";
import { addCurvedTube } from "../tree-parts";
import { solid } from "./crop-mesh-parts";
import type { NationalPlantStage } from "./national-drink-plants";
import { addPomegranateFruit } from "./pomegranate-fruit";

export type PomegranateTreePart = "bark" | "leaves" | "fruit";
const lerp = (a: Vec3, b: Vec3, t: number): Vec3 =>
  [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Narrow, opposite leaves on articulated twigs, with a folded midrib and smooth margin. */
export const addPomegranateLeaf = (builder: MeshBuilder, base: Vec3, yaw: number,
  length: number, detailed: boolean, fresh = false) => {
  const count = detailed ? 4 : 2, first = builder.vertexCount;
  for (let row = 0; row <= count; row++) {
    const t = row / count, span = Math.pow(Math.sin(t * Math.PI), .8) * length * .14;
    for (const side of [-1, 0, 1]) {
      const bend = length * (.15 * Math.sin(t * Math.PI) - .18 * t * t);
      const position: Vec3 = [base[0] + Math.sin(yaw) * t * length + Math.cos(yaw) * side * span,
        base[1] + bend - Math.abs(side) * span * .2,
        base[2] + Math.cos(yaw) * t * length - Math.sin(yaw) * side * span];
      const shade = side === 0 ? 1.15 : .9;
      const green: Vec3 = fresh ? [.7, .68, .42] : [.45, .62, .36];
      const rect = BIRCH_LEAF_RECT;
      builder.addVertex(position, normalize([Math.cos(yaw) * side * .2, 1, -Math.sin(yaw) * side * .2]),
        solid([green[0] * shade, green[1] * shade, green[2] * shade]),
        [rect.u0 + (rect.u1 - rect.u0) * (.25 + side * Math.sin(t * Math.PI) * .065),
          rect.v0 + (rect.v1 - rect.v0) * (.38 + t * .36)],
        { flutter: Math.sin(t * Math.PI) * .35, path: base[1] + t * length });
    }
  }
  for (let row = 0; row < count; row++) for (let side = 0; side < 2; side++) {
    const a = first + row * 3 + side, b = a + 3;
    builder.addTriangle(a, b, a + 1); builder.addTriangle(a + 1, b, b + 1);
    builder.addTriangle(a + 1, b, a); builder.addTriangle(b + 1, b, a + 1);
  }
};

/** The orchard and workshop share this rooted, branching tree and the same crowned fruit. */
export const createPomegranateTreeMesh = (stage: NationalPlantStage, detailed: boolean,
  part?: PomegranateTreePart) => {
  const builder = new MeshBuilder(), growth = stage === "young" ? .48 : 1;
  const wood = !part || part === "bark", leaves = !part || part === "leaves";
  const bark = solid([.19, .14, .09]);
  const tube = (points: Vec3[], radii: number[]) => {
    if (!wood) return;
    addCurvedTube(builder, points.map(point => point.map(value => value * growth) as unknown as Vec3),
      radii.map(radius => radius * growth), detailed ? 7 : 4, bark,
      points.map(point => point[1]), (ring, around) => toBarkUv(around, ring * 1.2));
  };
  tube([[0, -.018, 0], [-.018, .12, .012], [.013, .38, -.007], [.025, .66, .015]],
    [.061, .043, .029, .016]);
  for (let root = 0; root < (detailed ? 5 : 4); root++) {
    const yaw = root * 2.39996;
    tube([[Math.sin(yaw) * .13, -.018, Math.cos(yaw) * .13],
      [Math.sin(yaw) * .055, .014, Math.cos(yaw) * .055], [0, .12, 0]], [.004, .019, .031]);
  }
  const branches = detailed ? 5 : 4;
  for (let branch = 0; branch < branches; branch++) {
    const yaw = branch * 2.39996;
    const start: Vec3 = [.008, .27 + branch % 3 * .09, 0];
    const middle: Vec3 = [Math.sin(yaw) * .18, .6 + branch % 2 * .11, Math.cos(yaw) * .18];
    const tip: Vec3 = [Math.sin(yaw) * .34, .86 + branch % 3 * .07, Math.cos(yaw) * .34];
    tube([start, middle, tip], [.023, .012, .003]);
    for (let twig = 0; twig < (detailed ? 3 : 2); twig++) {
      const from = lerp(middle, tip, .18 + twig * .23);
      const turn = yaw + (twig % 2 ? 1 : -1) * .9;
      const end: Vec3 = [from[0] + Math.sin(turn) * .14, from[1] + .05,
        from[2] + Math.cos(turn) * .14];
      tube([from, end], [.005, .0018]);
      if (!leaves) continue;
      for (let node = 0; node < (detailed ? 3 : 1); node++) for (const side of [-1, 1]) {
        const base = lerp(from, end, .22 + node * .32);
        addPomegranateLeaf(builder, [base[0] * growth, base[1] * growth, base[2] * growth],
          turn + side * 1.03, (.105 + node * .009) * growth, detailed, twig === 3 && node === 2);
      }
    }
    if ((part && part !== "fruit") || (stage !== "fruiting" && stage !== "ripe")) continue;
    const at = lerp(middle, tip, .66);
    // The stem is at the top; the persistent blossom crown points down on hanging fruit.
    const fruitBuilder = new MeshBuilder();
    addPomegranateFruit(fruitBuilder, [0, 0, 0], .125, detailed, stage === "ripe", branch);
    const fruit = fruitBuilder.finish({ flex: 0 });
    const offset = builder.vertexCount;
    for (let vertex = 0; vertex < fruit.positions.length / 3; vertex++) {
      const i = vertex * 3;
      builder.addVertex([at[0] + fruit.positions[i]!, at[1] - .065 - fruit.positions[i + 1]!,
        at[2] - fruit.positions[i + 2]!],
      [fruit.normals[i]!, -fruit.normals[i + 1]!, -fruit.normals[i + 2]!],
      solid([fruit.colors[i]!, fruit.colors[i + 1]!, fruit.colors[i + 2]!]));
    }
    for (let i = 0; i < fruit.indices.length; i += 3)
      builder.addTriangle(offset + fruit.indices[i]!, offset + fruit.indices[i + 1]!, offset + fruit.indices[i + 2]!);
    tube([at, [at[0], at[1] - .022, at[2]]], [.004, .003]);
  }
  return builder.finish({ contactRadius: .18, flex: .09 });
};
