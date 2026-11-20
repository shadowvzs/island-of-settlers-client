import { describe, expect, it } from "vitest";

import { COLONY_VOYAGE_SECONDS, COLONY_VOYAGE_SPREAD_SECONDS } from "../src/shared/balance/colonies";
import {
  colonyArrivalSeconds, colonyDeckItems, colonyIslandOffers, colonyTrips, colonyTroopReason, packColonyLoads
} from "../src/shared/settlement/colony-expedition-rules";
import { cargoBoxes } from "../src/shared/settlement/ship-cargo-boxes";

const stocked = { archer: 40, cavalry: 40, heavy: 40, shield: 40 };
const passengers = (count: number, slots = 1) =>
  Array.from({ length: count }, (_, index) => ({ slots, uid: index + 1 }));

describe("colony expedition rules", () => {
  it("caps troops by difficulty and by stored troops per type", () => {
    expect(colonyTroopReason({ shield: 20 }, "easy", stocked)).toBeNull();
    expect(colonyTroopReason({ heavy: 1, shield: 20 }, "easy", stocked)).toMatch(/limit/);
    expect(colonyTroopReason({ shield: 21 }, "medium", stocked)).toBeNull();
    expect(colonyTroopReason({ archer: 5 }, "hard", { archer: 4 })).toMatch(/archer/);
    expect(colonyTroopReason({}, "easy", stocked)).toMatch(/at least/);
    expect(colonyTroopReason({ shield: 1.5 }, "easy", stocked)).toMatch(/Invalid/);
  });

  it("packs boxes by ware weight, one ware type per box", () => {
    expect(cargoBoxes({ hammer: 1, planks: 100, shovel: 1, stone: 75 })).toBe(10);
    expect(cargoBoxes({ logs: 30 })).toBe(2);
    expect(cargoBoxes({ ironOre: 80 })).toBe(1);
    expect(cargoBoxes({ planks: 35, stone: 20 })).toBe(3);
  });

  it("fits 16 soldiers or 33 boxes on one deck and splits overflow onto another ship", () => {
    expect(packColonyLoads(colonyDeckItems(passengers(16), {}))).toHaveLength(1);
    expect(packColonyLoads(colonyDeckItems([], { planks: 33 * 30 }))).toHaveLength(1);
    expect(packColonyLoads(colonyDeckItems([], { logs: 33 * 15 + 1 }))).toHaveLength(2);
    const loads = packColonyLoads(colonyDeckItems(passengers(17), { planks: 50 }));
    expect(loads).toHaveLength(2);
    expect(loads[0]!.passengers).toHaveLength(16);
    expect(loads[1]).toEqual({ boxes: 2, cargo: { planks: 50 }, passengers: [17] });
  });

  it("gives cavalry two deck slots", () => {
    expect(packColonyLoads(colonyDeckItems(passengers(8, 2), {}))).toHaveLength(1);
    expect(packColonyLoads(colonyDeckItems(passengers(9, 2), {}))).toHaveLength(2);
  });

  it("offers six seeded islands with distinct names, all four ores and travel times around the base", () => {
    const islands = colonyIslandOffers(1234);
    expect(islands).toEqual(colonyIslandOffers(1234));
    expect(islands).toHaveLength(6);
    expect(new Set(islands.map(island => island.name)).size).toBe(6);
    expect(new Set(islands.map(island => island.ore))).toEqual(new Set(["coal", "goldOre", "ironOre", "stone"]));
    for (const island of islands) {
      expect(Math.abs(island.voyageSeconds - COLONY_VOYAGE_SECONDS))
        .toBeLessThanOrEqual(COLONY_VOYAGE_SPREAD_SECONDS);
    }
    expect(islands.map(island => island.difficulty).sort())
      .toEqual(["easy", "easy", "hard", "hard", "medium", "medium"]);
    expect(colonyIslandOffers(99).map(island => island.seed)).not.toEqual(islands.map(island => island.seed));
  });

  it("repeats trips when ships are fewer than loads, so more ships arrive sooner", () => {
    const loads = packColonyLoads(colonyDeckItems(passengers(40), { planks: 20 }));
    expect(loads).toHaveLength(3);
    expect(colonyTrips(loads.length, 1)).toBe(3);
    expect(colonyTrips(loads.length, 3)).toBe(1);
    expect(colonyArrivalSeconds(loads, 3)).toBeLessThan(colonyArrivalSeconds(loads, 1));
    expect(colonyArrivalSeconds(loads, 1)).toBeGreaterThanOrEqual(5 * COLONY_VOYAGE_SECONDS);
    expect(colonyArrivalSeconds(loads, 0)).toBe(Infinity);
  });
});
