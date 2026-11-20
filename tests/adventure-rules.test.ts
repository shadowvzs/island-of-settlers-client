import { ADVENTURE_OFFERS, adventurePoints } from "@shared/catalog/balance";
import { describe, expect, it } from "vitest";

import {
  ADVENTURE_WORLD_SIZE, adventureEnemyCount, adventureEnemyPlan, adventureForce, adventureIslandError,
  adventureOffers, adventureRewardGoods, isAdventureIsland
} from "../src/shared/settlement/adventure-rules";

describe("adventure offers", () => {
  it("offers 4 seeded islands covering every difficulty", () => {
    const offers = adventureOffers(77);
    expect(offers).toHaveLength(ADVENTURE_OFFERS);
    expect(adventureOffers(77)).toEqual(offers);
    expect(new Set(offers.map(island => island.difficulty))).toEqual(new Set(["easy", "medium", "hard"]));
    expect(new Set(offers.map(island => island.name)).size).toBe(ADVENTURE_OFFERS);
    for (const island of offers) {
      expect(isAdventureIsland(island)).toBe(true);
      expect(adventureIslandError(island)).toBeNull();
      expect(island.size).toBe(ADVENTURE_WORLD_SIZE);
      expect(island.voyageSeconds).toBeGreaterThanOrEqual(60);
      expect(island.voyageSeconds).toBeLessThanOrEqual(180);
    }
  });

  it("brings a fresh set with new ids after each finished adventure", () => {
    const first = adventureOffers(77, 0), second = adventureOffers(77, 1);
    expect(second.map(island => island.id)).toEqual([100, 101, 102, 103]);
    expect(second.map(island => island.seed)).not.toEqual(first.map(island => island.seed));
  });

  it("plans only mixed field camps (no enemy buildings) that grow with difficulty", () => {
    const counts = (["easy", "medium", "hard"] as const).map(adventureEnemyCount);
    expect(counts).toEqual([15, 30, 51]);
    expect((["easy", "medium", "hard"] as const).map(level => adventureEnemyPlan(level).camps.length))
      .toEqual([3, 5, 6]);
    const hard = adventureEnemyPlan("hard");
    expect(hard).not.toHaveProperty("forts");
    expect(hard.camps.map(camp => camp.troops.length)).toEqual([6, 10, 9, 9, 9, 8]);
    expect(new Set(hard.camps.flatMap(camp => camp.troops))).toEqual(new Set(["shield", "heavy", "archer"]));
    expect(new Set(hard.camps.flatMap(camp => camp.ranks))).toEqual(new Set([1, 2]));
    expect(adventureEnemyPlan("easy").camps.flatMap(camp => camp.ranks).every(rank => rank === 0)).toBe(true);
  });

  it("keeps the reward points of the former fort and camp mix", () => {
    const points = (difficulty: "easy" | "medium" | "hard") => adventurePoints(adventureForce({ difficulty }));
    expect([points("easy"), points("medium"), points("hard")]).toEqual([15, 33.5, 69.75]);
  });

  it("pays a bigger reward ship for harder adventures", () => {
    const easy = adventureRewardGoods({ difficulty: "easy" });
    const hard = adventureRewardGoods({ difficulty: "hard" });
    expect(easy.coins).toBe(30);
    expect(hard).toEqual({ coal: 21, coins: 140, goldOre: 7, ironOre: 21, planks: 56, stone: 42 });
  });

  it("rejects malformed adventure islands", () => {
    const island = adventureOffers(5)[0]!;
    expect(adventureIslandError({ ...island, kind: undefined })).toMatch(/Invalid/);
    expect(adventureIslandError({ ...island, size: 100 })).toMatch(/size/);
    // Saves from before 2026-10-13 keep their 64 or 128 cell islands.
    expect(adventureIslandError({ ...island, size: 64 })).toBeNull();
    expect(adventureIslandError({ ...island, size: 128 })).toBeNull();
    expect(adventureIslandError({ ...island, difficulty: "legendary" })).toMatch(/Invalid/);
  });
});
