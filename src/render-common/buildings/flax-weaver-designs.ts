import type { SettlerNation as WorkerNation } from "../workers/worker-unit";
import type { BuildingDefinition } from "./building-catalog";
import type { BuildingPart, BuildingRecipe } from "./building-recipe";
import { getRomanRecipeBounds } from "./building-recipe-fit";
import { NATION_FARM_DESIGNS } from "./flax-farm-designs";
import { createRomanFlaxFarm } from "./flax-farm-designs";
import {
  FLAX_FARM_TYPE, type FlaxWeaverSite, WEAVER_TYPE
} from "./flax-weaver-shared";
import { classifyNationBody } from "./nation-kit-classify";
import { doorGapOf } from "./nation-kit-parts";
import { addRomanGableRoof } from "./roman-gable-roof";
import type { AddPart } from "./roman-resource-workshops";
import { createRomanWeaver, NATION_WEAVER_DESIGNS } from "./weaver-designs";

export const isFlaxWeaverBuilding = (typeId: number) =>
  typeId === FLAX_FARM_TYPE || typeId === WEAVER_TYPE;

const wallTopOf = (recipe: BuildingRecipe, fallback: number) => {
  const tops = classifyNationBody(recipe).walls.filter(wall => wall.base < .35).map(wall => wall.base + wall.height);
  return tops.length ? Math.max(...tops) : fallback;
};

const siteOf = (recipe: BuildingRecipe, definition: BuildingDefinition, nation: WorkerNation,
  detailed: boolean, base: number, parts: BuildingPart[]): FlaxWeaverSite => ({
  add: part => parts.push({ stage: 1, ...part }), base, definition, detailed,
  door: doorGapOf(recipe), front: recipe.door[2] - .016,
  limit: getRomanRecipeBounds(definition, recipe), nation, parts, typeId: definition.id,
  wallTop: wallTopOf(recipe, base + (definition.id === FLAX_FARM_TYPE ? .95 : 1))
});

/**
 * Roman authoring pass: the yard/loom design replaces the shared cottage/hall parts while the
 * canonical door, exits, work point, mechanism and plot envelope stay those of the recipe.
 */
export const createRomanFlaxWeaverRecipe = (recipe: BuildingRecipe, definition: BuildingDefinition,
  detailed: boolean) => {
  if (!isFlaxWeaverBuilding(definition.id)) return recipe;
  const parts: BuildingPart[] = [];
  const site = siteOf(recipe, definition, "roman", detailed, .18, parts);
  const addPart: AddPart = (surface, position, size, stage = 2, shape = "box", rotation, tint) =>
    site.add({ stage, shape, surface, position, size, rotation, tint });
  const roof = (x: number, y: number, z: number, width: number, depth: number) =>
    addRomanGableRoof(addPart, detailed, x, y, z, width, depth);
  if (definition.id === FLAX_FARM_TYPE) createRomanFlaxFarm(site, roof);
  else createRomanWeaver(site, roof);
  return { ...recipe, parts };
};

/** National rebuild from its own Roman plan: the nation re-authors the stock markers and shell. */
export const createNationalFlaxWeaverRecipe = (original: BuildingRecipe, definition: BuildingDefinition,
  nation: Exclude<WorkerNation, "roman">, detailed: boolean) => {
  if (!isFlaxWeaverBuilding(definition.id)) return null;
  // The nation design re-authors its own canonical stock markers with its materials.
  const parts: BuildingPart[] = [];
  const site = siteOf(original, definition, nation, detailed, 0, parts);
  if (definition.id === FLAX_FARM_TYPE) NATION_FARM_DESIGNS[nation](site);
  else NATION_WEAVER_DESIGNS[nation](site);
  return { ...original, parts };
};
