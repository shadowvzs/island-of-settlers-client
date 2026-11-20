import { srgbToLinear } from "../../color";
import { toBarkUv } from "../../trees/bark-uv";
import { BIRCH_LEAF_RECT } from "../../trees/foliage-atlas";
import { MeshBuilder, normalize, type Vec3 } from "../mesh-builder";
import { addCurvedTube } from "../tree-parts";
import { addLathe, ovoidProfile, solid } from "./crop-mesh-parts";
import type { NationalPlantStage } from "./national-drink-plants";

export type LeafyCropPart = "bark" | "leaves" | "fruit";

/** Shallowly serrated tea blades and smaller berry leaves retain their midrib and cupped shape. */
export const addCropLeaf = (builder: MeshBuilder, base: Vec3, yaw: number, length: number,
  tea: boolean, detailed: boolean, fresh = false) => {
  let segments = detailed ? 8 : 3;
  if (detailed && tea) segments = 7;
  const first = builder.vertexCount;
  for (let row = 0; row <= segments; row++) {
    const t = row / segments;
    const tooth = detailed && row % 2 ? .95 : 1;
    const span = Math.pow(Math.sin(t * Math.PI), .8) * length * (tea ? .23 : .29) * tooth;
    for (const across of [-1, 0, 1]) {
      const normal = normalize([Math.cos(yaw) * across * .22, 1, -Math.sin(yaw) * across * .22]);
      const color: Vec3 = fresh ? [.76, .87, .46] : [.37, .55, .32];
      const shade = across === 0 ? 1.12 : .92, rect = BIRCH_LEAF_RECT;
      builder.addVertex([base[0] + Math.sin(yaw) * t * length + Math.cos(yaw) * span * across,
        base[1] + length * (.19 * Math.sin(t * Math.PI) - .22 * t * t) - Math.abs(across) * span * .2,
        base[2] + Math.cos(yaw) * t * length - Math.sin(yaw) * span * across], normal,
      solid([color[0] * shade, color[1] * shade, color[2] * shade]),
      [rect.u0 + (rect.u1 - rect.u0) * (.25 + across * Math.sin(t * Math.PI) * .065),
        rect.v0 + (rect.v1 - rect.v0) * (.38 + t * .36)],
      { flutter: Math.sin(t * Math.PI) * .4, path: base[1] + t * length });
    }
  }
  for (let row = 0; row < segments; row++) for (let side = 0; side < 2; side++) {
    const a = first + row * 3 + side, b = a + 3;
    // The blade collapses to one point at each end: omit only the zero-area end faces.
    if (row > 0) { builder.addTriangle(a, b, a + 1); builder.addTriangle(a + 1, b, a); }
    if (row < segments - 1) { builder.addTriangle(a + 1, b, b + 1); builder.addTriangle(b + 1, b, a + 1); }
  }
};

export const addDrinkBerry = (builder: MeshBuilder, centre: Vec3, radius: number,
  detailed: boolean, ripe = true, variant = 0) => {
  addLathe(builder, { centre: [centre[0], centre[1] - radius, centre[2]],
    profile: ovoidProfile(radius, radius * 1.9, detailed ? 6 : 3), segments: detailed ? 10 : 6 },
  solid(ripe ? srgbToLinear(.48 + variant % 3 * .06, .065, .12 + variant % 2 * .04)
    : srgbToLinear(.32, .43, .16)));
  const brown = solid(srgbToLinear(.17, .09, .07));
  for (let lobe = 0; lobe < 5; lobe++) {
    const yaw = lobe / 5 * Math.PI * 2;
    const first = builder.vertexCount;
    for (const [turn, reach] of [[-.35, .12], [0, .44], [.35, .12]])
      builder.addVertex([centre[0] + Math.sin(yaw + turn!) * radius * reach!,
        centre[1] + radius * .91, centre[2] + Math.cos(yaw + turn!) * radius * reach!], [0, 1, 0], brown);
    builder.addTriangle(first, first + 1, first + 2);
  }
};

/** Connected woody shrubs; field growth and the planted workshop specimen share every component. */
export const createTeaBerryPlantMesh = (kind: "tea" | "berries", stage: NationalPlantStage,
  detailed: boolean, part?: LeafyCropPart) => {
  const builder = new MeshBuilder(), growth = stage === "young" ? .48 : 1;
  const bark = solid([.17, .11, .06]), tea = kind === "tea";
  const wood = !part || part === "bark", leaves = !part || part === "leaves";
  const tube = (from: Vec3, mid: Vec3, to: Vec3, radius: number) => {
    if (!wood) return;
    addCurvedTube(builder, [from, mid, to].map(point =>
      [point[0] * growth, point[1] * growth, point[2] * growth] as Vec3),
    [radius * growth, radius * .62 * growth, radius * .2 * growth], detailed ? 6 : 3, bark,
    [from[1], mid[1], to[1]], (ring, around) => toBarkUv(around, ring * 1.1));
  };
  tube([0, -.015, 0], [.008, .1, -.005], [0, .24, 0], .035);
  for (let root = 0; root < 4; root++) {
    const yaw = root * 2.39996;
    tube([Math.sin(yaw) * .09, -.014, Math.cos(yaw) * .09],
      [Math.sin(yaw) * .04, .006, Math.cos(yaw) * .04], [0, .08, 0], .007);
  }
  const branches = detailed ? 7 : 4;
  for (let branch = 0; branch < branches; branch++) {
    const yaw = branch * 2.39996;
    const from: Vec3 = [0, .12 + branch % 3 * .025, 0];
    const middle: Vec3 = [Math.sin(yaw) * .14, .26, Math.cos(yaw) * .14];
    const end: Vec3 = [Math.sin(yaw) * .26, .4 + branch % 3 * .035, Math.cos(yaw) * .26];
    tube(from, middle, end, .014);
    const leafCount = (detailed ? 5 : 3) - (tea && stage === "picked" ? 1 : 0);
    if (leaves) for (let node = 0; node < leafCount; node++) {
      const t = .2 + node * .16;
      const at: Vec3 = [(middle[0] + (end[0] - middle[0]) * t) * growth,
        (middle[1] + (end[1] - middle[1]) * t) * growth,
        (middle[2] + (end[2] - middle[2]) * t) * growth];
      addCropLeaf(builder, at, yaw + (node % 2 ? 1 : -1) * 1.1,
        (tea ? .16 : .12) * growth, tea, detailed, node === leafCount - 1 && stage !== "picked");
      if (tea && detailed) addCropLeaf(builder, at, yaw - (node % 2 ? 1 : -1) * 1.05,
        .145 * growth, true, detailed);
      if (tea && node === leafCount - 1 && stage !== "picked") addCropLeaf(builder, at, yaw, .09 * growth, true, detailed, true);
    }
    if (tea || part && part !== "fruit" || stage !== "ripe" && stage !== "fruiting") continue;
    for (let berry = 0; berry < (detailed ? 3 : 2); berry++)
      addDrinkBerry(builder, [end[0] - .015 + berry * .02, end[1] - .045 - berry % 2 * .025,
        end[2]], .026, detailed, stage === "ripe", branch + berry);
  }
  return builder.finish({ contactRadius: .16, flex: .14 });
};
