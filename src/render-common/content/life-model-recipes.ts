import { entriesOfKind, type RecipeId } from "@shared/catalog";

import { createBirdGeometry } from "../birds/bird-mesh";
import { BIRD_SPECIES } from "../birds/bird-species";
import { createButterflyGeometry } from "../butterflies/butterfly-mesh";
import { getCritterModel } from "../critters/critter-models";
import { CRITTER } from "../critters/critter-species";
import { getFishModels } from "../fish-schools/fish-models";

/** Season and detail of a critter model (`getCritterModel`). */
export interface CritterModelOptions {
  minimal: boolean;
  winter: boolean;
}

/** The code-built model of an animated life species, by the builder it needs. */
export type LifeModelRecipe =
  | { build: () => ReturnType<typeof createBirdGeometry>; kind: "bird" }
  | { build: () => ReturnType<typeof createButterflyGeometry>; kind: "butterfly" }
  /** Undefined while the species' shipped file is not loaded (`loadCritterSpecies`). */
  | { build: (options: CritterModelOptions) => ReturnType<typeof getCritterModel>; kind: "critter" }
  | { build: () => ReturnType<typeof getFishModels>[number]; kind: "fish" };

const critterRecipes = (): [RecipeId, LifeModelRecipe][] => Object.entries(CRITTER).map(([key, code]) => [
  `recipe:critter.${key}`,
  { build: ({ minimal, winter }) => getCritterModel(code, winter, minimal), kind: "critter" }
]);

/** Fish, bird and butterfly model tables are the catalog's tuning sidecars in code order (`index` = code). */
const tunedRecipes = (): [RecipeId, LifeModelRecipe][] => [
  ...entriesOfKind("fish").map((entry, index): [RecipeId, LifeModelRecipe] =>
    [`recipe:fish.${entry.key}`, { build: () => getFishModels()[index]!, kind: "fish" }]),
  ...entriesOfKind("bird").map((entry, index): [RecipeId, LifeModelRecipe] =>
    [`recipe:bird.${entry.key}`, { build: () => createBirdGeometry(BIRD_SPECIES[index]!.shape), kind: "bird" }]),
  ...entriesOfKind("butterfly").map((entry, index): [RecipeId, LifeModelRecipe] =>
    [`recipe:butterfly.${entry.key}`, { build: () => createButterflyGeometry(index), kind: "butterfly" }])
];

let registry: ReadonlyMap<RecipeId, LifeModelRecipe> | undefined;

/** Every code-built critter, fish, bird and butterfly model by recipe id. */
export const lifeModelRecipes = (): ReadonlyMap<RecipeId, LifeModelRecipe> => {
  registry ??= new Map([...critterRecipes(), ...tunedRecipes()]);
  return registry;
};
