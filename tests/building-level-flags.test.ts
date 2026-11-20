import { describe, expect, it } from "vitest";

import { BUILDING_CATALOG } from "../src/render-common/buildings/building-catalog";
import type { BuildingPart } from "../src/render-common/buildings/building-recipe";
import { getRomanPartBounds } from "../src/render-common/buildings/building-recipe-fit";
import { mayCarryFlag } from "../src/render-common/buildings/levels/level-flag-policy";
import { levelProgressionOf } from "../src/render-common/buildings/levels/level-progression";
import { buildingLevelAdditions } from "../src/render-common/buildings/levels/leveled-building-recipe";
import { COMMANDER_LODGE_TYPE_ID, TAVERN_TYPE_ID } from "../src/shared/settlement/building-type-ids";

/**
 * Owner rule 2026-11-08: flags, banners, war standards and flag-like poles or vanes belong only on
 * military buildings and the HQ; civilian level steps add real building improvements instead.
 */
const NATIONS = ["roman", "viking", "nubian", "japanese", "maya", "persian", "chinese", "indigenous"] as const;
const LEVELS = [2, 3, 4, 5] as const;
/** The Monument (7) has no level progression. */
const CIVILIAN = BUILDING_CATALOG.filter(definition => definition.id !== 7 && !mayCarryFlag(definition.id));

/** What flag-like piece a part is (by shape, surface and proportions), or null. */
const flagRole = (part: BuildingPart) => {
  const { max, min } = getRomanPartBounds(part), thinnest = Math.min(...part.size);
  const width = Math.max(max[0] - min[0], max[2] - min[2]), height = max[1] - min[1];
  if (part.shape === "paint-triangle") return "pennant";
  if (part.shape === "maya-headquarters-textile") return "standard textile";
  if (part.surface === "cloth" && part.shape === "box" && thinnest <= .015) return "banner cloth";
  if (part.surface === "gold" && part.shape === "box" && thinnest <= .01) return "vane plate";
  if (part.shape !== "cylinder" || !["iron", "wood"].includes(part.surface)) return null;
  if (part.surface === "iron" && width <= .02 && height >= .08) return "vane spindle";
  return width <= .035 && height >= .3 ? "flag pole" : null;
};

/** A painted triangle lying on a painted band (a wall frieze) is wall painting, not a pennant. */
const isOnPaintedBand = (part: BuildingPart, parts: readonly BuildingPart[]) => parts.some(band => {
  if (band.shape !== "box" || band.surface !== "paint") return false;
  const { max, min } = getRomanPartBounds(band);
  return [0, 1, 2].every(axis => part.position[axis]! >= min[axis]! - .01 && part.position[axis]! <= max[axis]! + .01);
});

const flagParts = (parts: readonly BuildingPart[]) => parts.flatMap(part => {
  const role = flagRole(part);
  if (role === "pennant" && isOnPaintedBand(part, parts)) return [];
  return role ? [role] : [];
});

describe("building level flags", () => {
  it.each(NATIONS)("%s civilian level additions carry no flag, banner, standard or vane", nation => {
    const found: string[] = [];
    for (const definition of CIVILIAN) for (const detailed of [true, false]) for (const level of LEVELS) {
      const roles = flagParts(buildingLevelAdditions(definition, nation, detailed, level));
      if (roles.length) found.push(`${definition.id} ${detailed ? "high" : "minimal"} L${level}: ${roles.join(", ")}`);
    }
    expect(found).toEqual([]);
  }, 120000);

  /**
   * Owner 2026-11-09 (reverses the earlier civilian ruling): the Military Academy and the
   * Commander's Lodge are military buildings. They level up with the military steps, not the
   * civilian progression, and their level art may carry the military banners and vanes.
   */
  it.each(NATIONS)("%s Military Academy and Commander's Lodge level up as military buildings", nation => {
    for (const id of [TAVERN_TYPE_ID, COMMANDER_LODGE_TYPE_ID]) {
      expect(mayCarryFlag(id)).toBe(true);
      expect(CIVILIAN.some(definition => definition.id === id)).toBe(false);
      expect(levelProgressionOf(nation, id)).toBeNull();
    }
  });

  it("still recognises the war standards kept on Viking military buildings and the HQ", () => {
    for (const id of [0, 4, 9]) {
      const definition = BUILDING_CATALOG.find(entry => entry.id === id)!;
      expect(flagParts(buildingLevelAdditions(definition, "viking", true, 5)), definition.name)
        .toContain("banner cloth");
    }
  });
});
