import { createRandom } from "../../shared/world/rng";
import { BROADLEAF, getFormArchetype } from "../../shared/world/tree-forms";
import type { Vec3 } from "../props/mesh-builder";
import { createBirchModel } from "./birch-model";
import { createCherryModel } from "./cherry-model";
import { createConiferModel } from "./conifer-model";
import { finishModel } from "./model-bounds";
import { createOakModel } from "./oak-model";
import { createPalmModel } from "./palm-model";
import {
  createEmptyModel,
  type GrowthStage,
  type TreeModel,
  type TreeSpecies,
  type TreeStage
} from "./tree-model";

/** Species growers; `form` is the structural form byte (archetype, competition), if any. */
const GROWERS: Record<TreeSpecies, (seed: number, stage: GrowthStage, form: number) => TreeModel> =
  {
    oak: (seed, stage, form) =>
      getFormArchetype(form) === BROADLEAF.cherry ? createCherryModel(seed, stage) : createOakModel(seed, stage),
    palm: createPalmModel,
    pine: createConiferModel,
    birch: createBirchModel
  };

/** Bark tone, root flare and cut height of each species' stump. */
const STUMP_LOOK: Record<
  TreeSpecies,
  { barkTone: Vec3; flare: number; height: number; ringed: boolean }
> = {
  oak: { barkTone: [0.24, 0.19, 0.15], flare: 1.4, height: 0.42, ringed: false },
  palm: { barkTone: [0.42, 0.37, 0.3], flare: 1.15, height: 0.34, ringed: true },
  pine: { barkTone: [0.3, 0.19, 0.13], flare: 1.25, height: 0.36, ringed: false },
  birch: { barkTone: [0.72, 0.7, 0.65], flare: 1.25, height: 0.38, ringed: false }
};

/** Stump of the tree that stood at `stage`: the trunk radius at the foot, an uneven cut. */
const createStumpModel = (
  species: TreeSpecies,
  seed: number,
  stage: GrowthStage,
  form: number
): TreeModel => {
  const random = createRandom(seed + 77);
  const grown = GROWERS[species](seed, stage, form);
  const trunk = grown.wood[0];
  const radius = trunk ? trunk.radii[Math.min(1, trunk.radii.length - 1)]! : 0.05;
  const look = STUMP_LOOK[species];
  const model = createEmptyModel(species, "chopped");
  model.stump = {
    ...look,
    height: look.height * (0.55 + (stage / 5) * 0.45),
    radius,
    slant: 0.06 + random() * 0.1,
    slantYaw: random() * Math.PI * 2
  };
  return finishModel(model);
};

/**
 * The model of a species at a lifecycle stage; the same seed always gives the same tree.
 * `stumpOf` picks which grown stage a "chopped" stump belongs to (default mature); `form` is the
 * structural form byte (tree-forms.ts) of species with archetypes.
 */
export const createTreeModel = (
  species: TreeSpecies,
  stage: TreeStage,
  seed: number,
  stumpOf: GrowthStage = 5,
  form = 0
): TreeModel => {
  if (stage === 0) return finishModel(createEmptyModel(species, 0));
  if (stage === "chopped") return createStumpModel(species, seed, stumpOf, form);
  return GROWERS[species](seed, stage, form);
};
