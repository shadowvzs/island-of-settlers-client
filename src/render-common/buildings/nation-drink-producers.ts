import { DMath } from "../../shared/math/deterministic-math";
import { srgbToLinear } from "../color";
import type { Point3 } from "./building-recipe";
import type { AddPart } from "./roman-resource-workshops";

/**
 * Work yards of building slot 5 (the raw drink producer) per nation, in the yard east of the
 * house where the Roman vine rows stood (x 0.55..1.3, z -0.85..0.85 of the finished recipe).
 * The house, door lane, worker exit, work point and the raw ware stock on the bench stay as authored.
 */
/** Rice straw is paler and greyer than the wheat thatch the straw surface is painted for. */
const RICE_STRAW: Point3 = [0.86, 0.92, 0.95];
const ENTRANCE = srgbToLinear(0.12, 0.09, 0.06);
const HUSK = srgbToLinear(0.5, 0.33, 0.18);
const TERRACOTTA = srgbToLinear(0.74, 0.4, 0.24);
const FROND = srgbToLinear(0.42, 0.56, 0.22);

/** Coiled straw skep with its hackle, sitting on a surface at height `base`. */
const addSkep = (part: AddPart, x: number, base: number, z: number, detailed: boolean) => {
  part("straw", [x, base + 0.12, z], [0.24, 0.24, 0.24], 3, "skep");
  part("paint", [x + 0.115, base + 0.018, z], [0.02, 0.025, 0.06], 3, "box", undefined, ENTRANCE);
  if (detailed) part("straw", [x, base + 0.27, z], [0.17, 0.12, 0.17], 3, "cone", undefined, srgbToLinear(0.86, 0.8, 0.7));
};

/**
 * Viking apiary: a roofed bee bench (bistade) with straw skeps on its shelf and a standing log
 * hive (stokkekube) with a board cap; more hives are set out round the house by the beekeeper.
 */
export const addVikingApiaryYard = (part: AddPart, detailed: boolean) => {
  const posts: Point3[] = [[0.64, 0, -0.62], [1.2, 0, -0.62], [0.64, 0, 0.42], [1.2, 0, 0.42]];
  for (const [x, , z] of posts) part("bark", [x, 0.47, z], [0.06, 0.94, 0.06], 2, "cylinder");
  part("wood", [0.92, 0.4, -0.1], [0.62, 0.05, 1.12], 2, "bevel-box");
  for (const z of [-0.62, 0.42]) part("wood", [0.92, 0.36, z], [0.62, 0.04, 0.05], 2);
  // Shingled lean-to roof falling towards the yard, carried by a ridge beam over the posts.
  for (const x of [0.64, 1.2]) part("wood", [x, 0.94, -0.1], [0.07, 0.06, 1.18], 2);
  part("roof", [0.92, 1.0, -0.1], [0.76, 0.045, 1.3], 4, "box", [0, 0, -0.16]);
  const skeps = detailed ? [-0.44, -0.1, 0.24] : [-0.33, 0.13];
  for (const z of skeps) addSkep(part, 0.92, 0.425, z, detailed);
  // The log hive: a hollowed trunk standing on a flat stone, capped by a sloping board.
  part("stone", [1.02, 0.03, 0.66], [0.3, 0.06, 0.26], 3, "rock");
  part("bark", [1.02, 0.31, 0.66], [0.2, 0.5, 0.2], 3, "cylinder");
  part("wood", [1.02, 0.585, 0.66], [0.27, 0.035, 0.25], 3, "box", [0.18, 0, 0]);
  part("paint", [1.02, 0.25, 0.763], [0.05, 0.05, 0.012], 3, "cylinder", [Math.PI / 2, 0, 0], ENTRANCE);
};

/**
 * One hanging sheaf: a bundle of rice straw folded over the drying bar, tied at the bar and
 * fanning out below it on each side (heads hang down on one side, stalks on the other).
 */
const addSheaf = (part: AddPart, x: number, y: number, z: number) => {
  for (const side of [-1, 1])
    part("straw", [x + side * 0.045, y - 0.1, z], [0.09, 0.21, 0.08], 3, "cone", [0, 0, side * 0.22], RICE_STRAW);
  part("rope", [x, y, z], [0.05, 0.012, 0.05], 3, "cylinder", [0, 0, Math.PI / 2]);
};

/**
 * Japanese rice farm: a hasa-gake bamboo drying rack hung with rice sheaves, and the usu mortar
 * with its kine pestle for hulling; the paddies themselves lie round the house.
 */
export const addJapaneseRiceYard = (part: AddPart, detailed: boolean) => {
  const x = 0.95, poles = [-0.66, -0.12, 0.42];
  for (const z of poles) part("paint", [x, 0.52, z], [0.05, 1.04, 0.05], 2, "bamboo-culm");
  for (const y of [0.5, 0.82]) {
    part("paint", [x, y, -0.12], [0.035, 1.26, 0.035], 2, "bamboo-culm", [Math.PI / 2, 0, 0]);
    if (!detailed) {
      part("straw", [x, y - 0.1, -0.12], [0.09, 0.2, 1.0], 3, "box");
      continue;
    }
    for (let sheaf = 0; sheaf < 9; sheaf += 1) addSheaf(part, x, y, -0.6 + sheaf * 0.12 + (y > 0.6 ? 0.06 : 0));
  }
  part("wood", [0.66, 0.1, 0.62], [0.24, 0.2, 0.24], 3, "cylinder");
  part("dark", [0.66, 0.201, 0.62], [0.16, 0.006, 0.16], 3, "cylinder");
  part("wood", [0.8, 0.22, 0.62], [0.032, 0.42, 0.032], 3, "cylinder", [0, 0, 0.35]);
  part("wood", [0.86, 0.43, 0.62], [0.09, 0.12, 0.09], 3, "cylinder", [0, 0, Math.PI / 2 + 0.35]);
  if (detailed) part("straw", [1.18, 0.03, 0.66], [0.26, 0.06, 0.26], 3, "bowl", undefined, srgbToLinear(0.8, 0.66, 0.4));
};

/** A potted coconut seedling: clay pot, a sprouting nut and arching fronds. */
const addPalmSeedling = (part: AddPart, x: number, z: number, detailed: boolean) => {
  part("paint", [x, 0.13, z], [0.24, 0.26, 0.24], 3, "clay-jar", undefined, TERRACOTTA);
  part("paint", [x, 0.27, z], [0.09, 0.08, 0.09], 3, "coconut", undefined, HUSK);
  const fronds = detailed ? 6 : 4;
  for (let frond = 0; frond < fronds; frond += 1) {
    const yaw = (frond / fronds) * Math.PI * 2;
    // Each frond runs out from the nut along its yaw and droops towards its tip.
    part("leaf", [x + DMath.sin(yaw) * 0.15, 0.37, z + DMath.cos(yaw) * 0.15], [0.08, 0.014, 0.34], 3, "box",
      [0.4, yaw, 0], FROND);
  }
};

/**
 * Nubian palm grove: a palm-frond shade over the husking spike with nuts and husks, the climber's
 * rope belt on its post, a basket and a potted seedling ready to plant out.
 */
export const addNubianPalmYard = (part: AddPart, detailed: boolean) => {
  const shade = { maxX: 1.24, maxZ: -0.05, minX: 0.62, minZ: -0.66 };
  for (const x of [shade.minX, shade.maxX]) for (const z of [shade.minZ, shade.maxZ])
    part("bark", [x, 0.46, z], [0.06, 0.92, 0.06], 2, "cylinder");
  for (const x of [shade.minX, shade.maxX])
    part("wood", [x, 0.94, (shade.minZ + shade.maxZ) / 2], [0.05, 0.05, shade.maxZ - shade.minZ + 0.1], 2);
  part("straw", [(shade.minX + shade.maxX) / 2, 0.985, (shade.minZ + shade.maxZ) / 2],
    [shade.maxX - shade.minX + 0.16, 0.04, shade.maxZ - shade.minZ + 0.16], 4, "box", undefined, srgbToLinear(0.7, 0.64, 0.36));
  // Husking spike: an iron point on a stake; husked nuts and torn husks at its foot.
  part("wood", [0.93, 0.2, -0.36], [0.06, 0.4, 0.06], 3, "cylinder");
  part("iron", [0.93, 0.46, -0.36], [0.05, 0.12, 0.05], 3, "cone");
  const nuts = detailed ? [[0.78, -0.22], [0.84, -0.12], [0.72, -0.13], [1.06, -0.2]] as const : [[0.78, -0.2]] as const;
  for (const [x, z] of nuts)
    part("paint", [x, 0.055, z], [0.11, 0.12, 0.1], 3, "coconut", [0, x * 9, Math.PI / 2], HUSK);
  if (detailed) for (const [x, z] of [[1.08, -0.5], [1.14, -0.42]] as const)
    part("paint", [x, 0.025, z], [0.12, 0.05, 0.12], 3, "bowl", [Math.PI, 0, 0], srgbToLinear(0.56, 0.4, 0.24));
  if (detailed) part("rope", [shade.maxX, 0.6, shade.maxZ], [0.17, 0.02, 0.17], 3, "ring", [Math.PI / 2, 0, 0.3]);
  part("straw", [0.72, 0.07, 0.42], [0.22, 0.14, 0.22], 3, "bowl", undefined, srgbToLinear(0.74, 0.58, 0.32));
  addPalmSeedling(part, 1.08, 0.5, detailed);
};
