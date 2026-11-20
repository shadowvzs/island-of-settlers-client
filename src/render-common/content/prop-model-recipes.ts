import { propEntryByCode, type RecipeId } from "@shared/catalog";

import { PROP } from "../../shared/world/world-data";
import type { PropMesh } from "../props/mesh-builder";
import { createPropMesh } from "../props/prop-meshes";
import { PROP_KIND_COUNT } from "../props/prop-mesh-layout";

/** One mesh variant of a ground prop kind from a world's prop seed (`createPropMesh`). */
export type PropModelBuilder = (seed: number, variant: number) => PropMesh;

/** Meadow rocks are drawn by the rock layer (`rocks/meadow-stones.ts`), not by a prop mesh recipe. */
const ROCK_LAYER_KINDS: ReadonlySet<number> = new Set([PROP.smallRock, PROP.largeRock, PROP.pebbles]);

let registry: ReadonlyMap<RecipeId, PropModelBuilder> | undefined;

/** Every ground prop mesh recipe (trees, plants, field cover, shells) by recipe id. */
export const propModelRecipes = (): ReadonlyMap<RecipeId, PropModelBuilder> => {
  if (registry) return registry;
  const recipes = new Map<RecipeId, PropModelBuilder>();
  for (let code = 0; code < PROP_KIND_COUNT; code += 1) {
    if (ROCK_LAYER_KINDS.has(code)) continue;
    const entry = propEntryByCode(code);
    if (!entry) throw new Error(`Prop mesh kind ${code} has no content entry`);
    recipes.set(`recipe:${entry.kind}.${entry.key}`, (seed, variant) => createPropMesh(seed, code, variant));
  }
  registry = recipes;
  return registry;
};
