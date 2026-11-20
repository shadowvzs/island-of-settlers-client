import { describe, expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { createRomanBuildingRecipe } from "../src/render-common/buildings/building-recipe";
import { GARRISON_ARCHER_POSTS, GARRISON_CAPACITIES } from "../src/shared/balance/military";
import {
type GarrisonComposition, type GarrisonTroop,
  isValidComposition, nextGarrisonTroop, surplusGarrisonTroop} from "../src/shared/settlement/military-garrison-rules";

const troops = (shield = 0, heavy = 0, archer = 0): GarrisonComposition => ({ archer, heavy, shield });
const stored = (...types: GarrisonTroop[]) => (type: GarrisonTroop) => types.includes(type);

describe("garrison rules", () => {
  it("match the garrison capacities and the posts drawn on every military recipe", () => {
    expect(GARRISON_CAPACITIES).toEqual({ 1: 2, 2: 3, 4: 6, 9: 10, 16: 3 });
    for (const [id, posts] of Object.entries(GARRISON_ARCHER_POSTS))
      for (const detailed of [true, false])
        expect(createRomanBuildingRecipe(getBuildingDefinition(Number(id)), detailed).archerPositions ?? [])
          .toHaveLength(posts);
  });

  it("fills tower posts with archers first, then melee, and lets melee fill when no archer is stored", () => {
    expect(nextGarrisonTroop(4, troops(), undefined, stored("archer", "shield"))).toBe("archer");
    expect(nextGarrisonTroop(4, troops(0, 0, 3), undefined, stored("archer", "heavy"))).toBe("heavy");
    expect(nextGarrisonTroop(4, troops(), undefined, stored("shield"))).toBe("shield");
    expect(nextGarrisonTroop(1, troops(), undefined, stored("archer", "shield"))).toBe("shield");
    expect(nextGarrisonTroop(1, troops(), undefined, stored("archer"))).toBe("archer");
    expect(nextGarrisonTroop(2, troops(), undefined, stored())).toBe("recruit");
    expect(nextGarrisonTroop(2, troops(1, 0, 2), undefined, stored("shield"))).toBeNull();
  });

  it("swaps melee out of a full building for a stored archer, and spare window archers for melee", () => {
    expect(surplusGarrisonTroop(2, troops(2, 0, 1), undefined, stored("archer"))).toBe("shield");
    expect(surplusGarrisonTroop(2, troops(2, 0, 1), undefined, stored("shield"))).toBeNull();
    expect(surplusGarrisonTroop(1, troops(0, 0, 2), undefined, stored("heavy"))).toBe("archer");
    expect(surplusGarrisonTroop(2, troops(1, 0, 2), undefined, stored("archer", "shield"))).toBeNull();
  });

  it("follows manual counts and the player's total cap", () => {
    const manual = troops(1, 0, 2);
    expect(nextGarrisonTroop(4, troops(), manual, stored("shield"))).toBe("shield");
    expect(nextGarrisonTroop(4, troops(1), manual, stored("shield"))).toBeNull();
    expect(nextGarrisonTroop(4, troops(), troops(0, 1), stored())).toBeNull();
    expect(nextGarrisonTroop(4, troops(), troops(2), stored())).toBe("recruit");
    expect(surplusGarrisonTroop(4, troops(2, 0, 2), manual, stored())).toBe("shield");
    expect(surplusGarrisonTroop(4, troops(1, 0, 2), manual, stored("archer"))).toBeNull();
    expect(nextGarrisonTroop(4, troops(2), undefined, stored("shield"), 2)).toBeNull();
    expect(surplusGarrisonTroop(4, troops(3), undefined, stored(), 2)).toBe("shield");
  });

  it("validates manual compositions against the building", () => {
    expect(isValidComposition(2, troops(1, 0, 2))).toBe(true);
    expect(isValidComposition(2, troops(2, 0, 2))).toBe(false);
    expect(isValidComposition(2, { archer: -1, heavy: 0, shield: 0 })).toBe(false);
    expect(isValidComposition(2, { archer: 1.5, heavy: 0, shield: 0 })).toBe(false);
  });
});
