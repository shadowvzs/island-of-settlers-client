import type { GrowthStage } from "../../trees/tree-model";
import type { PropMesh } from "../mesh-builder";
import { createHiveEkeMesh, createHiveStandMesh, createHoneyDripMesh, createSkepMesh } from "./beehive-mesh";
import {
  createCoconutClusterMesh, createCoconutPalmStageMesh, createFallenCoconutMesh, getCoconutCrownHeight
} from "./coconut-palm-mesh";
import { createGrapeBunchMesh, createGrapevineMesh, createVineTrellisMesh, type VineStage } from "./grapevine-mesh";
import { createRiceMesh, type RiceStage } from "./rice-mesh";
import { createNationalDrinkPlantMesh, type NationalDrinkPlant, type NationalPlantStage } from "./national-drink-plants";

/** One grove look for every planted palm (the instance yaw and wind phase vary them). */
const PALM_SEED = 4113;
const BUNCH_SIZE: Record<string, number> = { full: 1, small: 0.6 };
const FRUIT_SIZE: Record<string, number> = { full: 1, small: 0.55 };

const createVinePartMesh = (part: string, variant: string, index: string, detailed: boolean) => {
  if (part === "trellis") return createVineTrellisMesh(detailed);
  if (part === "plant") return createGrapevineMesh(variant as VineStage, detailed, Number(index));
  return createGrapeBunchMesh(BUNCH_SIZE[variant]!, detailed, Number(index));
};

const HIVE_PARTS: Record<string, (detailed: boolean) => PropMesh> = {
  drip: createHoneyDripMesh, eke: createHiveEkeMesh, skep: createSkepMesh, stand: createHiveStandMesh
};

const palmStages = new Map<GrowthStage, PropMesh>();
/** Palm growth meshes are the island's own coconut palm (both detail levels draw it). */
const getPalmStage = (stage: GrowthStage) => {
  const known = palmStages.get(stage);
  if (known) return known;
  const mesh = createCoconutPalmStageMesh(stage, PALM_SEED);
  palmStages.set(stage, mesh);
  return mesh;
};

const createPalmPartMesh = (part: string, variant: string, detailed: boolean) => {
  if (part === "tree") return getPalmStage(Number(variant) as GrowthStage);
  if (part === "fruit") return createCoconutClusterMesh(getPalmStage(5), FRUIT_SIZE[variant]!, detailed, PALM_SEED);
  return createFallenCoconutMesh(Number(variant), detailed, PALM_SEED);
};

/**
 * Mesh of a drink crop draw key (see three-drink-crops): "vine-trellis", "vine-plant-<stage>-<variant>",
 * "vine-bunch-<small|full>-<vine>", "rice-<stage>", "hive-<stand|eke|skep|drip>",
 * "palm-tree-<1..5>", "palm-fruit-<small|full>", "palm-fallen-<group>".
 */
export const createDrinkCropMesh = (key: string, detailed: boolean): PropMesh => {
  const [kind, part = "", variant = "", index = ""] = key.split("-");
  if (kind === "vine") return createVinePartMesh(part, variant, index, detailed);
  if (kind === "rice") return createRiceMesh(part as RiceStage, detailed);
  if (kind === "hive") return HIVE_PARTS[part]!(detailed);
  if (kind === "palm") return createPalmPartMesh(part, variant, detailed);
  if (["tea", "pomegranate", "cacao", "berries"].includes(kind!))
    return createNationalDrinkPlantMesh(kind as NationalDrinkPlant, part as NationalPlantStage, detailed);
  throw new Error(`Unknown drink crop mesh ${key}`);
};

let crownHeight: number | undefined;
/** Height where the grove's coconuts hang (they drop from there at harvest). */
export const getPalmCrownHeight = () => (crownHeight ??= getCoconutCrownHeight(PALM_SEED));

const easeInOut = (t: number) => t * t * (3 - 2 * t);

/**
 * Palm stage and instance scale for a growth of 0..1: each stage swells to the next stage's
 * height before the switch, so the palm grows without popping (as the forester's trees do).
 */
export const getPalmGrowthDraw = (growth: number) => {
  if (growth >= 1) return { scale: 1, stage: 5 as GrowthStage };
  const position = Math.min(4.999, Math.max(0, growth) * 5);
  const stage = (Math.floor(position) + 1) as GrowthStage;
  const current = getPalmStage(stage).height, next = getPalmStage(Math.min(5, stage + 1) as GrowthStage).height;
  const start = stage === 1 ? 0.25 : 1;
  return { scale: start + (next / current - start) * easeInOut(position % 1), stage };
};
