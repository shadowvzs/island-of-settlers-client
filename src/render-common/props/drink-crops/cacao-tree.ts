import { toBarkUv } from "../../trees/bark-uv";
import { BIRCH_LEAF_RECT } from "../../trees/foliage-atlas";
import { MeshBuilder, normalize, type Vec3 } from "../mesh-builder";
import { addCurvedTube } from "../tree-parts";
import { addLathe, ovoidProfile, solid } from "./crop-mesh-parts";
import type { NationalPlantStage } from "./national-drink-plants";

export type CacaoTreePart = "bark" | "leaves" | "pods";
const BARK: Vec3 = [.14, .085, .043];

const interpolate = (a: Vec3, b: Vec3, t: number): Vec3 =>
  [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Broad cacao leaf: tapered drip tip, folded midrib and drooping blade with shaded lateral veins. */
export const addCacaoLeaf = (builder: MeshBuilder, base: Vec3, yaw: number, length: number,
  fresh: boolean, detailed: boolean) => {
  const along: Vec3 = [Math.sin(yaw), 0, Math.cos(yaw)];
  const side: Vec3 = [along[2], 0, -along[0]];
  const segments = detailed ? 8 : 4;
  const rows: number[][] = [];
  for (let row = 0; row <= segments; row++) {
    const t = row / segments;
    const span = Math.pow(Math.sin(Math.PI * t), .8) * length * .22;
    const ids: number[] = [];
    for (const across of [-1, 0, 1]) {
      const ridge = across === 0 ? .014 * Math.sin(t * Math.PI) : 0;
      const position: Vec3 = [base[0] + along[0] * length * t + side[0] * span * across,
        base[1] + length * (.22 * Math.sin(t * Math.PI) - .32 * t * t) + ridge,
        base[2] + along[2] * length * t + side[2] * span * across];
      const normal = normalize([side[0] * across * .18 + along[0] * .2, 1,
        side[2] * across * .18 + along[2] * .2]);
      const vein = across === 0 || detailed && row % 2 === 0;
      const green: Vec3 = fresh ? [.8, .91, .67] : [.47, .68, .5];
      const shade = vein ? 1.17 : .94;
      const u = .25 + across * Math.sin(t * Math.PI) * .065, v = .38 + t * .36;
      const rect = BIRCH_LEAF_RECT;
      ids.push(builder.addVertex(position, normal,
        solid([green[0] * shade, green[1] * shade, green[2] * shade]),
        [rect.u0 + (rect.u1 - rect.u0) * u, rect.v0 + (rect.v1 - rect.v0) * v],
        { flutter: Math.sin(t * Math.PI) * .45, path: base[1] + t * length }));
    }
    rows.push(ids);
  }
  for (let row = 0; row < segments; row++) for (let side = 0; side < 2; side++) {
    const a = rows[row]![side]!, b = rows[row + 1]![side]!;
    const c = rows[row]![side + 1]!, d = rows[row + 1]![side + 1]!;
    builder.addTriangle(a, b, c);
    builder.addTriangle(c, b, d);
    // Building materials are single-sided; both surfaces also retain leaf shading in the field.
    builder.addTriangle(c, b, a);
    builder.addTriangle(d, b, c);
  }
};

/** Shared authored tree for standalone crop stages and the Maya nursery, without new materials. */
export const createCacaoTreeMesh = (stage: NationalPlantStage, detailed: boolean,
  part?: CacaoTreePart) => {
  const builder = new MeshBuilder();
  const growth = stage === "young" ? .48 : 1;
  const drawBark = !part || part === "bark", drawLeaves = !part || part === "leaves";
  const root: Vec3 = [0, 0, 0], fork: Vec3 = [.018 * growth, .63 * growth, -.015 * growth];
  const bark = solid(BARK);
  if (drawBark) {
    addCurvedTube(builder, [[0, -.018, 0], [-.012 * growth, .075 * growth, .008 * growth],
      [-.014 * growth, .29 * growth, .012 * growth], fork],
    [.071 * growth, .046 * growth, .035 * growth, .027 * growth], detailed ? 12 : 6, bark,
    [0, .075, .3, .63], (ring, around) => toBarkUv(around, [0, .5, 2.1, 4.5][ring]!));
    for (let index = 0; index < (detailed ? 4 : 3); index++) {
      const yaw = index * 2.39996;
      addCurvedTube(builder, [[Math.sin(yaw) * .14 * growth, -.022, Math.cos(yaw) * .14 * growth],
        [Math.sin(yaw) * .065 * growth, .014, Math.cos(yaw) * .065 * growth],
        [0, .14 * growth, 0]], [.006 * growth, .024 * growth, .032 * growth],
      detailed ? 6 : 3, bark, [0, .07, .18], (ring, around) => toBarkUv(around, ring * .8));
    }
  }
  for (let branch = 0; branch < 5; branch++) {
    const yaw = branch * 2.39996;
    const start = interpolate(root, fork, .8 + (branch % 2) * .13);
    const middle: Vec3 = [Math.sin(yaw) * .14 * growth, (.78 + branch % 2 * .08) * growth,
      Math.cos(yaw) * .14 * growth];
    const tip: Vec3 = [Math.sin(yaw) * .3 * growth, (.97 + branch % 3 * .055) * growth,
      Math.cos(yaw) * .3 * growth];
    if (drawBark) addCurvedTube(builder, [start, middle, tip],
      [.025 * growth, .015 * growth, .005 * growth], detailed ? 7 : 4, bark, [.5, .8, 1.1],
      (ring, around) => toBarkUv(around, 4 + ring * 1.5));
    if (!drawLeaves) continue;
    const count = detailed ? 7 : 4;
    for (let index = 0; index < count; index++) {
      const t = .22 + index / count * .75;
      const base = interpolate(middle, tip, t);
      const turn = yaw + (index % 2 ? 1 : -1) * (1.05 + index % 3 * .1);
      addCacaoLeaf(builder, base, turn, (.26 + index % 3 * .035) * growth,
        index === count - 1 && branch % 2 === 0, detailed);
    }
  }
  if ((!part || part === "pods") && (stage === "ripe" || stage === "fruiting")) {
    for (let index = 0; index < (detailed ? 5 : 3); index++) {
      const yaw = index * 2.39996;
      const at: Vec3 = [Math.sin(yaw) * .066, .25 + index * .105, Math.cos(yaw) * .066];
      addLathe(builder, { centre: at, axis: [Math.sin(yaw) * .22, 1, Math.cos(yaw) * .22],
        profile: ovoidProfile(.047, .215, detailed ? 9 : 5, .15), segments: detailed ? 20 : 10,
        ridges: { count: 10, depth: .085 } }, solid(stage === "ripe"
        ? [.74 - index % 2 * .14, .37 - index % 2 * .1, .065] : [.26, .39, .08]));
      if (drawBark) addCurvedTube(builder, [[0, at[1] + .2, 0],
        [at[0], at[1] + .2, at[2]]], [.009, .005], 4, bark, [at[1], at[1] + .05]);
    }
  }
  return builder.finish({ contactRadius: .22, flex: .1 });
};
