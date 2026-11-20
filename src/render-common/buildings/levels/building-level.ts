/** A building's level as its panel shows it: 1 as built, up to 5 (the crowned building). */
export type BuildingLevel = 1 | 2 | 3 | 4 | 5;

const MAX_BUILDING_LEVEL: BuildingLevel = 5;
export const BUILDING_LEVELS: readonly BuildingLevel[] = [1, 2, 3, 4, 5];

/** Panel level of a saved upgrade level (0 … 4); anything beyond the art's range is clamped. */
export const buildingLevelOf = (upgradeLevel = 0): BuildingLevel =>
  Math.max(1, Math.min(MAX_BUILDING_LEVEL, 1 + Math.round(upgradeLevel))) as BuildingLevel;

/** Render frame level of a saved upgrade level: absent for an unupgraded (level 1) building. */
export const upgradedBuildingLevel = (upgradeLevel = 0) => {
  const level = buildingLevelOf(upgradeLevel);
  return level > 1 ? level : undefined;
};
