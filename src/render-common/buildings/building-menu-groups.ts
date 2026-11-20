import { buildingEntries, categoriesOfKind } from "@shared/catalog";

/** Building panel tab ids (content catalog categories `building.<camelCase>` in kebab case). */
export type BuildingCategoryId = "food-drink" | "industry" | "materials" | "military" | "mines" | "settlement";

const CATEGORY_PREFIX = "building.";
const tabId = (categoryId: string) => categoryId.slice(CATEGORY_PREFIX.length)
  .replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`) as BuildingCategoryId;

/**
 * Stable functional groups (the building panel tabs) in display order, each listing its buildings in catalog
 * order. HQ is represented in Settlement but never offered for construction.
 */
export const BUILDING_CATEGORY_GROUPS: readonly { id: BuildingCategoryId; ids: readonly number[]; name: string }[] =
  Object.freeze(categoriesOfKind("building").map(category => Object.freeze({
    id: tabId(category.id),
    ids: Object.freeze(buildingEntries().filter(entry => entry.category === category.id).map(entry => entry.code)),
    name: category.text.name.en
  })));

/** The catalog category id of a building panel tab. */
export const buildingCategoryKey = (id: BuildingCategoryId) =>
  `${CATEGORY_PREFIX}${id.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())}`;

export const getBuildingCategory = (typeId: number) =>
  BUILDING_CATEGORY_GROUPS.find(group => group.ids.includes(typeId))?.id;
