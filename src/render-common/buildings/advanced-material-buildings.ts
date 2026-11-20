import { type BuildingEntry, buildingByKey, buildingEntries } from "@shared/catalog";
import { RESOURCE_TIERS } from "@shared/catalog/balance";

import { stoneWareAppearance, woodWareAppearance } from "../wares/advanced-material-variants";
import { withAdvancedMaterialFacade } from "./advanced-material-facades";
import type { BuildingDefinition } from "./building-catalog";
import type { BuildingPart, BuildingRecipe } from "./building-recipe";
import { buildingFamilyId } from "./building-triangle-budgets";
import { withIndigenousGraniteBearing } from "./indigenous-quarry-bearing";

const PRODUCTION_FAMILY = "building.production.";

/**
 * The base building an advanced-material specialist (41–55) shares its occupation model with: its catalog family
 * `building.production.<base key>` names another building. Undefined for every other type.
 */
const specialistBase = (entry: BuildingEntry) => {
  if (!entry.family.startsWith(PRODUCTION_FAMILY)) return undefined;
  const baseKey = entry.family.slice(PRODUCTION_FAMILY.length);
  return baseKey === entry.key ? undefined : buildingByKey(baseKey)?.code;
};
const SPECIALIST_BASES: ReadonlyMap<number, number> = new Map(buildingEntries().flatMap(entry => {
  const base = specialistBase(entry);
  return base === undefined ? [] : [[entry.code, base] as const];
}));

export const advancedMaterialBase = (id: number): number | undefined => SPECIALIST_BASES.get(id);

const baseDefinitions = new WeakMap<BuildingDefinition, BuildingDefinition>();

export const advancedMaterialBaseDefinition = (definition: BuildingDefinition): BuildingDefinition => {
  const base = advancedMaterialBase(definition.id);
  if (base === undefined) return definition;
  let result = baseDefinitions.get(definition);
  if (!result) {
    // Preserve lazy gridFootprint without evaluating its getter during sizing.
    result = Object.create(Object.getPrototypeOf(definition), Object.getOwnPropertyDescriptors(definition));
    result!.id = base;
    baseDefinitions.set(definition, result!);
  }
  return result!;
};

/** The colony material tier (1..4) of a specialist building id: four ids per tier from 41 on. */
const specialistMaterials = (id: number) => RESOURCE_TIERS[Math.floor((id - 41) / 4) + 1]!;
const stockWare = (ware: string, id: number) => {
  const materials = specialistMaterials(id);
  if (ware === "logs") return materials.logs;
  if (ware === "planks" || ware === "plank") return materials.planks;
  if (ware === "stone") return materials.stone;
  return ware;
};

/** Keep nation architecture and access, with specialist silhouettes, facades and stock bays. */
export const withAdvancedMaterialStocks = (recipe: BuildingRecipe, id: number, detailed = true,
  includeSpecialistArchitecture = true): BuildingRecipe => {
  const familyId = buildingFamilyId(id);
  const materials = specialistMaterials(id);
  const parts: BuildingPart[] = [];
  for (const original of recipe.parts) {
    const part = { ...original };
    if (!part.stock) {
      parts.push(part);
      continue;
    }
    const ware = stockWare(part.stock.ware, id);
    part.stock = { ...part.stock, ware };
    if (ware === materials.stone) {
      part.surface = "paint";
      part.tint = [.96, .95, .9];
      // Mineral seams follow the upper face of each stored dressed block.
      if (part.shape === "stone-block" || part.shape === "box" || part.shape === "bevel-box")
        parts.push({ ...part, shape: "box", position: [part.position[0],
          part.position[1] + part.size[1] / 2 + .0005, part.position[2]],
          size: [part.size[0] * .015, .001, part.size[2] * .8], tint: [.45, .5, .48] });
    } else if (ware === materials.logs || ware === materials.planks) {
      part.tint = part.surface === "endgrain" ? [.78, .55, .34] : [.55, .35, .23];
      // Squared hardwood beams are cut for structural work, unlike the ordinary thin boards.
      if (ware === materials.planks && part.surface === "wood") part.shape = "box";
    } else if (familyId === 41 && part.surface === "leaf") {
      part.tint = [.62, .79, .48];
      // Broad oval hardwood leaves retain the nursery rack's existing horizontal envelope.
      part.size = [part.size[0], part.size[1] * 1.7, part.size[2]];
    }
    parts.push(part);
  }
  const specialist = includeSpecialistArchitecture ? withAdvancedMaterialFacade(
    { ...recipe, parts }, familyId, detailed) : { ...recipe, parts };
  const designed = id === 55 ? withIndigenousGraniteBearing(specialist) : specialist;
  if (id < 45) return designed;
  const timber = woodWareAppearance(materials.logs)!;
  const mineral = stoneWareAppearance(materials.stone)!;
  return { ...designed, parts: designed.parts.map(part => {
    // Resource tiers colour the stored goods, never the nation's permanent building materials.
    if (!part.stock) return part;
    if (familyId === 43 && part.stage === 2 && part.surface === "paint" &&
      part.tint?.every(channel => channel > .8))
      return { ...part, tint: [...mineral.body] as [number, number, number] };
    const wood = ["wood", "planks", "endgrain"].includes(part.surface);
    // The stock models retain their own timber/mineral identity beside the common architecture.
    const stone = ["stone", "plaster", "cut-stone"].includes(part.surface);
    if (!wood && !stone) return part;
    const colour = wood ? timber.tint : mineral.tint;
    // Palette changes preserve the family shell, worker clearance and every stock contact.
    return { ...part, tint: colour.map((channel, axis) =>
      Math.min(1.15, channel * (part.tint?.[axis] ?? 1))) as [number, number, number] };
  }) };
};
