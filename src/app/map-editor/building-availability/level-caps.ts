import {
  availabilityTier, type BuildingAvailability, type BuildingLevelCap
} from "../../../../../island-of-settlers-shared/src/game-settings/building-availability";
import { hasBuildingLevels } from "../../../shared/settlement/building-levels";

/**
 * Per-building level caps in the editor (MAP BUILDING AVAILABILITY). A cap only means something below the map's
 * highest tier, on an allowed type that has building levels; the editor never stores any other cap.
 */

export const levelCapOf = (rules: BuildingAvailability, typeId: number) =>
  rules.levelCaps?.find(cap => cap.type === typeId)?.level;

/** The highest cap worth storing under the tier (tier − 1); 0 when no cap is possible (tier 1). */
export const highestLevelCap = (rules: BuildingAvailability) => availabilityTier(rules) - 1;

/** Whether this type can take a level cap under the current rules. */
export const canCapLevel = (rules: BuildingAvailability, typeId: number) =>
  hasBuildingLevels(typeId) && highestLevelCap(rules) >= 1 && !rules.banned?.includes(typeId);

const sortedCaps = (caps: readonly BuildingLevelCap[]) => [...caps].sort((first, second) => first.type - second.type);

const withCap = (rules: BuildingAvailability, typeId: number, level: number | undefined): BuildingAvailability => {
  const others = (rules.levelCaps ?? []).filter(cap => cap.type !== typeId);
  const levelCaps = level === undefined ? others : sortedCaps([...others, { level, type: typeId }]);
  return { ...rules, levelCaps };
};

/** The next cap a click sets: none → tier − 1 → … → 1 → none (each click lowers the building one level). */
export const nextLevelCap = (rules: BuildingAvailability, typeId: number) => {
  const current = levelCapOf(rules, typeId);
  if (current === undefined) return highestLevelCap(rules);
  return current > 1 ? current - 1 : undefined;
};

/** One click of the Max level mode; callers check `canCapLevel` first. */
export const withLevelCapCycled = (rules: BuildingAvailability, typeId: number): BuildingAvailability =>
  withCap(rules, typeId, nextLevelCap(rules, typeId));

/** Removes the caps the tier makes pointless (at or above it), so a lower tier keeps the caps consistent. */
export const withoutCapsAtTier = (rules: BuildingAvailability): BuildingAvailability => {
  if (!rules.levelCaps) return rules;
  const tier = availabilityTier(rules);
  return { ...rules, levelCaps: rules.levelCaps.filter(cap => cap.level < tier) };
};

/** A banned type keeps no cap (unbanning starts uncapped). */
export const withoutCap = (rules: BuildingAvailability, typeId: number) => withCap(rules, typeId, undefined);

/** Stored caps that change nothing (loaded files): at or above the tier, on a banned type or one without levels. */
export const ineffectiveLevelCaps = (rules: BuildingAvailability) => {
  const tier = availabilityTier(rules);
  return (rules.levelCaps ?? []).filter(cap => cap.level >= tier || !hasBuildingLevels(cap.type) ||
    !!rules.banned?.includes(cap.type)).map(cap => cap.type);
};
