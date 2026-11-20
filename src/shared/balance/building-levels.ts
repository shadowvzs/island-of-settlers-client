/**
 * Building levels 1–5 (owner decision 2026-10-21; plan: docs/plans/building-levels-plan-2026-10-21.md).
 * Panel level = 1 + saved `workshopUpgrade.level`, so saved levels run 0–4. Every upgradeable type uses
 * these steps: its rules sidecar names the effects, each effect's step scales linearly with the saved level
 * (factor = 1 + step × savedLevel), and every upgrade costs wood and stone of the level's resource tier.
 */
export const MAX_BUILDING_LEVEL = 5;
/** Highest saved `workshopUpgrade.level` (building level 5). */
export const MAX_SAVED_BUILDING_LEVEL = MAX_BUILDING_LEVEL - 1;

/**
 * What one level adds, as a share of the building's base value. Level 2 keeps the former single-upgrade
 * values; each further level adds the same step again (e.g. work speed +10/20/30/40%).
 * `populationLimit` is the residence rule: +10% of the base limit, rounded up, per level.
 */
export const BUILDING_LEVEL_STEPS = Object.freeze({
  door: .15,
  populationLimit: .1,
  porterSpeed: .1,
  sight: .15,
  storage: .25,
  territory: .1,
  training: .1,
  workSpeed: .1
});
export type BuildingLevelStep = keyof typeof BUILDING_LEVEL_STEPS;
/** Effects of a family: the linear steps above, plus the sawmill's plank recipe unlock per level. */
export type BuildingLevelEffect = BuildingLevelStep | "sawmillRecipe";

/**
 * Upgrade families (rules sidecar `levels.family`): each building's sidecar lists the family's effects and the
 * expanded upgrade costs (wood and stone of the level's colony resource tier; sawmills pay logs).
 */
export type BuildingLevelFamily =
  "harbour" | "legacySawmill" | "lookout" | "military" | "producer" | "residence" | "sawmill" | "storage" | "tavern";
