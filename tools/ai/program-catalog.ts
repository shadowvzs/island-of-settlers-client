import {
  type BuildingRules, buildingRulesOf, type BuildProgram, type BuildProgramCatalog, isBuildingPlaceableFor,
  productionWares
} from "@shared/catalog";

/**
 * Catalog views shared by the AI build program tools (`npm run ai:check`, `npm run ai:suggest`): which buildings a
 * program could play and which of them it does not list. Pure: the caller supplies the catalog.
 */

/** A building a build program can hold a goal for. */
export interface ProgramBuilding {
  /** Catalog category (`building.foodDrink`). */
  category: string;
  /** Content id (`building:sawmill`). */
  id: string;
  key: string;
  /** English name. */
  name: string;
  /** The nations that can place it, in catalog order. */
  nations: readonly string[];
  rules: BuildingRules;
}

const englishName = (entry: Record<string, unknown>) => {
  const text = entry.text as { name?: { en?: unknown } } | undefined;
  return typeof text?.name?.en === "string" ? text.name.en : String(entry.key);
};

/** The building with its rules and the nations that place it; undefined when it is unknown or has no rules. */
export const programBuildingOf = (catalog: BuildProgramCatalog, id: string): ProgramBuilding | undefined => {
  const entry = catalog.buildings.get(id);
  if (!entry) return undefined;
  const nations = catalog.nations.filter(nation => isBuildingPlaceableFor(catalog, id, nation));
  if (!nations.length) return undefined;
  const rules = buildingRulesOf(catalog, id);
  if (!rules) return undefined;
  return { category: String(entry.category), id, key: String(entry.key), name: englishName(entry), nations, rules };
};

/** A residence, or a workplace with a ware or outdoor work cycle; never military or a service post. */
const isEconomyBuilding = ({ military, production, residence }: BuildingRules) => {
  if (residence) return true;
  return production !== undefined && !production.service && !military;
};

/** Every placeable production or residence building of the catalog, by key a-z. */
export const economyBuildings = (catalog: BuildProgramCatalog): ProgramBuilding[] => [...catalog.buildings.keys()]
  .map(id => programBuildingOf(catalog, id))
  .filter(building => building !== undefined)
  .filter(building => isEconomyBuilding(building.rules))
  .sort((first, second) => first.key.localeCompare(second.key, "en"));

/** The production and residence buildings no goal of the program names, by key a-z. */
export const unlistedBuildings = (catalog: BuildProgramCatalog, program: BuildProgram): ProgramBuilding[] => {
  const listed = new Set<string>(program.goals.map(goal => goal.building));
  return economyBuildings(catalog).filter(building => !listed.has(building.id));
};

/** Whether the nation can place the building and one work cycle of it yields the ware there. */
export const producesFor = (building: ProgramBuilding, nation: string, ware: string) =>
  building.nations.includes(nation) && productionWares(building.rules, nation, "outputs").includes(ware);

/** `indigenous` → `Indigenous` (report headings). */
export const titleOf = (key: string) => `${key.charAt(0).toUpperCase()}${key.slice(1)}`;
