import { createRandom } from "../../shared/world/rng";
import { BROADLEAF, getFormArchetype, HARDWOOD, hardwoodBirchForm } from "../../shared/world/tree-forms";
import { PROP } from "../../shared/world/world-data";
import { BARK_FAMILY } from "../trees/bark-uv";
import { BIRCH_VARIANTS } from "../trees/birch-shape";
import { getConiferLook, getConiferShape } from "../trees/conifer-shapes";
import { CONIFER_VARIANTS, type TreeVariant } from "../trees/conifer-variants";
import { createHardwoodIslandMesh, getHardwoodStumpRadius } from "../trees/hardwood-island-mesh";
import { createIslandTreeMesh, DRAWN_TREE_MESH, type IslandTreeMeshOptions } from "../trees/island-tree-mesh";
import { getPalmStump, PALM_VARIANTS } from "../trees/palm-shapes";
import { styleTierTreeMesh, tierTreeProfile } from "../trees/tier-tree-mesh";
import { createTreeModel } from "../trees/tree-factory";
import type { GrowthStage, TreeSpecies } from "../trees/tree-model";
import type { PropMesh, Vec3 } from "./mesh-builder";

/** Tree models are in metres; on the island a mature tree stands about 2.5 to 3 cells tall. */
export const ISLAND_TREE_UNITS = 0.33;

/** Island tree kinds and the species that draws them. */
const SPECIES_BY_KIND: Partial<Record<number, TreeSpecies>> = {
  [PROP.broadleafTree]: "oak",
  [PROP.palmTree]: "palm",
  [PROP.coniferTree]: "pine",
  [PROP.birchTree]: "birch",
  [PROP.cedarTree]: "pine",
  [PROP.walnutTree]: "oak",
  [PROP.mahoganyTree]: "oak",
  [PROP.hardwoodTree]: "oak"
};

/** Growth stage of the young, established and mature placement age. */
const AGE_STAGES: GrowthStage[] = [3, 4, 5];
/** Prop scale each age stands for (the age based placement scale), per stage 3, 4, 5. */
const NOMINAL_SCALE: Partial<Record<GrowthStage, number>> = { 3: 0.8, 4: 0.97, 5: 1.22 };
/** Stump size of a young / established / mature tree relative to the mature stump mesh. */
const STUMP_SCALE: Partial<Record<GrowthStage, number>> = { 3: 0.55, 4: 0.78, 5: 1 };

/** Kinds without structural forms: one variant per age. */
const AGE_VARIANTS: TreeVariant[] = AGE_STAGES.map((stage) => ({ form: 0, stage }));

/** Variant tables of the tree kinds with structural forms (PropSet.form). */
/** Broadleaf trees: the oak, and the blossoming cherry form near Japanese towns. */
const BROADLEAF_VARIANTS: TreeVariant[] = [BROADLEAF.oak, BROADLEAF.cherry]
  .flatMap(form => AGE_STAGES.map((stage) => ({ form, stage })));

const FORM_VARIANTS: Partial<Record<number, TreeVariant[]>> = {
  [PROP.broadleafTree]: BROADLEAF_VARIANTS,
  [PROP.coniferTree]: CONIFER_VARIANTS,
  [PROP.birchTree]: BIRCH_VARIANTS,
  [PROP.palmTree]: PALM_VARIANTS,
  [PROP.cedarTree]: CONIFER_VARIANTS,
  [PROP.walnutTree]: [0, 1, 2, 3].flatMap(form => AGE_STAGES.map(stage => ({ form, stage }))),
  [PROP.mahoganyTree]: [0, 1, 2, 3].flatMap(form => AGE_STAGES.map(stage => ({ form, stage }))),
  [PROP.hardwoodTree]: Object.values(HARDWOOD).flatMap(form => AGE_STAGES.map(stage => ({ form, stage })))
};

export const getTreeSpecies = (kind: number) => SPECIES_BY_KIND[kind];

/** Every island mesh variant of a tree kind (index = prop variant). */
export const getTreeVariants = (kind: number) => FORM_VARIANTS[kind] ?? AGE_VARIANTS;

/** Age (placement scale) -> growth stage: young 3, established 4, mature 5. */
export const getTreeAgeStage = (scale: number): GrowthStage => {
  if (scale < 0.88) return 3;
  if (scale < 1.08) return 4;
  return 5;
};

const findVariant = (variants: TreeVariant[], form: number, stage: GrowthStage) =>
  variants.findIndex((variant) => variant.form === form && variant.stage === stage);

/**
 * Variant of a tree kind at a stage: the exact form, else its archetype grown open (young
 * trees do not react to the stand yet), else the kind's first form at that stage.
 */
export const findTreeVariant = (kind: number, form: number, stage: GrowthStage) => {
  const variants = getTreeVariants(kind);
  const candidates = [form, getFormArchetype(form), variants[0]!.form];
  for (const candidate of candidates) {
    const index = findVariant(variants, candidate, stage);
    if (index >= 0) return index;
  }
  return Math.max(
    0,
    variants.findIndex((variant) => variant.stage === stage)
  );
};

/** Variant of a world tree from its placement scale (age) and form byte. */
export const getTreeVariant = (kind: number, scale: number, form = 0) =>
  findTreeVariant(kind, form, getTreeAgeStage(scale));

export const getVariantStage = (kind: number, variant: number) =>
  getTreeVariants(kind)[variant]?.stage ?? 5;

/** The mature (stage 5) variant of the same form: where every grown tree ends. */
export const getMatureVariant = (kind: number, variant: number) =>
  findTreeVariant(kind, getTreeVariants(kind)[variant]?.form ?? 0, 5);

/** The stage meshes already differ in size; the instance only varies a little around them. */
export const getTreeInstanceScale = (kind: number, scale: number, variant: number) => {
  const nominal = NOMINAL_SCALE[getVariantStage(kind, variant)] ?? 1;
  return Math.min(1.12, Math.max(0.88, scale / nominal));
};

/** Stump size of a variant relative to the mature stump mesh of its form. */
export const getStumpScale = (kind: number, variant: number) =>
  STUMP_SCALE[getVariantStage(kind, variant)] ?? 1;

/** Bark colour and trunk radius at the cut of a mature tree's stump. */
export interface StumpLook {
  bark: Vec3;
  /** Procedural bark family of the Three shader (bark-uv.ts), null for plain (ringed) bark. */
  barkFamily: number | null;
  radius: number;
  /** Root flares around the foot (palms have none). */
  roots: number;
}

const STUMP_LOOKS: Partial<Record<number, StumpLook>> = {
  [PROP.broadleafTree]: {
    bark: [0.36, 0.3, 0.24],
    barkFamily: BARK_FAMILY.oak,
    radius: 0.11,
    roots: 5
  },
  [PROP.birchTree]: {
    bark: [0.7, 0.68, 0.63],
    barkFamily: BARK_FAMILY.birch,
    radius: 0.065,
    roots: 4
  }
};

/** The base kind a tier tree (cedar, mahogany, walnut) is styled from. */
const getTierTreeSourceKind = (kind: number) => {
  if (kind === PROP.cedarTree) return PROP.coniferTree;
  return kind === PROP.mahoganyTree ? PROP.hardwoodTree : PROP.broadleafTree;
};

/** Stump of a tree kind and form (mature tree). */
export const getIslandStumpLook = (kind: number, form: number): StumpLook => {
  if (kind === PROP.hardwoodTree && hardwoodBirchForm(form) !== undefined)
    return getIslandStumpLook(PROP.birchTree, hardwoodBirchForm(form)!);
  if ((kind === PROP.cedarTree || kind === PROP.walnutTree || kind === PROP.mahoganyTree)) {
    const sourceKind = getTierTreeSourceKind(kind);
    const base = getIslandStumpLook(sourceKind, kind === PROP.walnutTree ? 0 : form), profile = tierTreeProfile(kind, form);
    return { ...base, radius: base.radius * profile.x, bark: base.bark.map((value, axis) => value * profile.bark[axis]!) as unknown as Vec3 };
  }
  if (kind === PROP.hardwoodTree) return {
    bark: [.42, .28, .16], barkFamily: BARK_FAMILY.oak, radius: getHardwoodStumpRadius(form), roots: 7
  };
  if (kind === PROP.coniferTree) return getConiferStumpLook(form);
  if (kind === PROP.palmTree) return getPalmStumpLook(form);
  return STUMP_LOOKS[kind] ?? STUMP_LOOKS[PROP.broadleafTree]!;
};

/** Conifer stump: the archetype's foot bark and its mature trunk (with a little flare). */
const getConiferStumpLook = (form: number): StumpLook => {
  const look = getConiferLook(form, 5);
  return {
    bark: look.bark,
    barkFamily: look.barkFamily,
    radius: getConiferShape(form, 5).trunkRadius * ISLAND_TREE_UNITS * 1.1,
    roots: 4
  };
};

/** Palm stump: the variant's trunk foot (slim coconut, thick date and fan palms). */
const getPalmStumpLook = (form: number): StumpLook => {
  const { bark, radius } = getPalmStump(form);
  return { bark, barkFamily: null, radius: radius * ISLAND_TREE_UNITS, roots: 0 };
};

/** The island mesh of a tree kind and form at a growth stage, deterministic per seed. */
export const createIslandTreeStageMesh = (
  kind: number,
  stage: GrowthStage,
  form: number,
  seed: number,
  options: IslandTreeMeshOptions = DRAWN_TREE_MESH
): PropMesh => {
  if ((kind === PROP.cedarTree || kind === PROP.walnutTree || kind === PROP.mahoganyTree)) {
    const sourceKind = getTierTreeSourceKind(kind);
    const sourceForm = kind === PROP.walnutTree ? 0 : form;
    const sourceSeed = seed + (kind === PROP.walnutTree ? (form & 3) * 1019 : 0);
    const source = createIslandTreeStageMesh(sourceKind, stage, sourceForm, sourceSeed, options);
    return styleTierTreeMesh(source, kind, form);
  }
  if (kind === PROP.hardwoodTree) {
    const birch = hardwoodBirchForm(form);
    if (birch !== undefined) return createIslandTreeStageMesh(PROP.birchTree, stage, birch, seed, options);
    return createHardwoodIslandMesh(form, stage);
  }
  const species = SPECIES_BY_KIND[kind]!;
  const model = createTreeModel(species, stage, seed + (stage - 3) * 101, 5, form);
  return createIslandTreeMesh(model, ISLAND_TREE_UNITS, createRandom(seed + 7), options);
};

/** The island mesh of a tree kind at a variant (its form and stage), deterministic per seed. */
export const createIslandTreePropMesh = (
  kind: number,
  variant: number,
  seed: number,
  options: IslandTreeMeshOptions = DRAWN_TREE_MESH
) => {
  const { form, stage } = getTreeVariants(kind)[variant]!;
  return createIslandTreeStageMesh(kind, stage, form, seed, options);
};

/** World prop kinds drawn as trees. */
export const TREE_KINDS = Object.keys(SPECIES_BY_KIND).map(Number);
