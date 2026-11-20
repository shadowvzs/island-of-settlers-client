import {
  adventureExperience, adventureLoot, adventurePoints, adventurePointsPerLevel, adventureReward,
  adventuresPerLevel, MAX_PLAYER_LEVEL
} from "@shared/catalog/balance";
import { describe, expect, it } from "vitest";

import { adventureForce, type AdventureIsland,adventureOffers } from "../src/shared/settlement/adventure-rules";

const offers = adventureOffers(1234);
const offer = (difficulty: AdventureIsland["difficulty"]) => offers.find(island => island.difficulty === difficulty)!;
const forceOf = (difficulty: AdventureIsland["difficulty"]) => adventureForce(offer(difficulty));
const perLevel = (difficulty: AdventureIsland["difficulty"], level: number) =>
  adventuresPerLevel(forceOf(difficulty), level);

describe("adventure rewards", () => {
  it("scores enemy units by count and a small rank weight", () => {
    expect(adventurePoints({ units: [{ rank: 0 }, { rank: 1 }] })).toBe(2.25);
    expect(adventurePoints({ units: [{ rank: 2 }] })).toBe(1.5);
    expect(adventurePoints(forceOf("easy"))).toBe(15);
    expect(adventurePoints(forceOf("medium"))).toBe(33.5);
    expect(adventurePoints(forceOf("hard"))).toBe(69.75);
  });

  it("needs about 7-8 medium adventures per level at level 20", () => {
    expect(perLevel("medium", 20)).toBeGreaterThanOrEqual(7);
    expect(perLevel("medium", 20)).toBeLessThanOrEqual(8);
  });

  it("needs 20-25 of the hardest adventures per level at level 50", () => {
    expect(perLevel("hard", 50)).toBeGreaterThanOrEqual(20);
    expect(perLevel("hard", 50)).toBeLessThanOrEqual(25);
  });

  it("needs about 100 of the hardest adventures per level from level 70", () => {
    for (let level = 70; level < MAX_PLAYER_LEVEL; level++) {
      expect(perLevel("hard", level)).toBeGreaterThanOrEqual(95);
      expect(perLevel("hard", level)).toBeLessThanOrEqual(105);
    }
  });

  it("makes levels above 50 noticeably harder", () => {
    const below = (perLevel("hard", 50) - perLevel("hard", 40)) / 10;
    const above = (perLevel("hard", 60) - perLevel("hard", 50)) / 10;
    expect(above).toBeGreaterThan(3 * below);
    expect(perLevel("hard", 55)).toBeGreaterThan(1.5 * perLevel("hard", 50));
    for (let level = 21; level < MAX_PLAYER_LEVEL; level++)
      expect(adventurePointsPerLevel(level)).toBeGreaterThanOrEqual(adventurePointsPerLevel(level - 1));
  });

  it("rewards harder adventures more at every level", () => {
    for (const level of [1, 20, 50, 70, MAX_PLAYER_LEVEL]) {
      const [easy, medium, hard] = (["easy", "medium", "hard"] as const)
        .map(difficulty => adventureReward(forceOf(difficulty), level));
      expect(easy!.experience).toBeLessThan(medium!.experience);
      expect(medium!.experience).toBeLessThan(hard!.experience);
      expect(easy!.coins).toBeLessThan(hard!.coins);
    }
    expect(adventureExperience(0.1, 1)).toBe(1);
  });

  it("pays coins and a ware bundle from the difficulty only", () => {
    expect(adventureLoot(73.875)).toEqual({ coins: 148,
      wares: { coal: 22, goldOre: 7, ironOre: 22, planks: 59, stone: 44 } });
    expect(adventureReward(forceOf("hard"), 10).wares).toEqual(adventureReward(forceOf("hard"), 60).wares);
  });
});
