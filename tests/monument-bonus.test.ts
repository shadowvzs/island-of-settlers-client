import { describe, expect, it, vi } from "vitest";

import { type ColonyArrival,settleArrivingColony } from "../src/app/settlement/colony-boot";
import {
  hasCompletedMonument, hasMonumentBonus, monumentExperience, withHomeMonument
} from "../src/shared/progression/monument-bonus";
import { completeQuest, createPlayerProgress } from "../src/shared/progression/player-progress";
import { BuildingType } from "../src/shared/settlement/building-type-ids";
import { colonyIslandOffers } from "../src/shared/settlement/colony-expedition-rules";
import { chooseColonyWorld } from "../src/shared/settlement/colony-world-choice";
import { militaryHealth } from "../src/shared/settlement/military-combat-rules";
import {
  campaignMonumentGarrison, isMonumentStartGarrison, monumentStartGarrison
} from "../src/shared/settlement/monument-start-garrison";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";

vi.mock("../src/shared/world/generation/generate-world", async (importOriginal) =>
  (await import("./helpers/world-cache-store")).cachedGenerateWorldModule(importOriginal));

const monument = (construction: number, militaryFaction?: number) =>
  ({ construction, militaryFaction, typeId: BuildingType.Monument, uid: 5 });

describe("Monument experience bonus", () => {
  it("adds 25 % rounded down per gain, only while active", () => {
    expect(monumentExperience(100, false)).toBe(100);
    expect(monumentExperience(100, true)).toBe(125);
    expect(monumentExperience(3, true)).toBe(3);
    expect(monumentExperience(4, true)).toBe(5);
    expect(monumentExperience(10.6, true)).toBe(13);
    expect(monumentExperience(-5, true)).toBe(0);
  });

  it("counts only a completed player Monument, optionally leaving one out", () => {
    expect(hasCompletedMonument([monument(1)])).toBe(true);
    expect(hasCompletedMonument([monument(0.99)])).toBe(false);
    expect(hasCompletedMonument([monument(1, 1)])).toBe(false);
    expect(hasCompletedMonument([monument(1)], 5)).toBe(false);
    expect(hasCompletedMonument([{ ...monument(1), typeId: 0 }])).toBe(false);
  });

  it("keeps the progress flag and applies it to quest experience", () => {
    const progress = createPlayerProgress(1);
    expect(hasMonumentBonus(progress)).toBe(false);
    const flagged = withHomeMonument(progress, true);
    expect(hasMonumentBonus(flagged)).toBe(true);
    expect(withHomeMonument(flagged, true)).toBe(flagged);
    expect("homeMonument" in withHomeMonument(flagged, false)).toBe(false);
    const quest = { amount: 1, done: false, experience: 40, id: "q", kind: "produce" as const, progress: 1,
      reward: {}, ware: "planks" };
    const ready = { ...progress, quests: [quest] };
    expect(completeQuest(ready, "q")!.progress.experience).toBe(40);
    expect(completeQuest(ready, "q", true)!.progress.experience).toBe(50);
  });
});

describe("Monument start garrison", () => {
  it("gives nothing without a Monument and three tier-3 melee soldiers with one", () => {
    expect(monumentStartGarrison({ active: false, key: 1, seed: 2 })).toEqual([]);
    const troops = monumentStartGarrison({ active: true, key: 1, seed: 2 });
    expect(troops).toHaveLength(3);
    for (const troop of troops) {
      expect(["shield", "heavy"]).toContain(troop.type);
      expect(troop).toEqual({ hp: militaryHealth(troop.type, 2), rank: 2, type: troop.type });
    }
    expect(isMonumentStartGarrison(troops)).toBe(true);
  });

  it("draws deterministically and varies between starts", () => {
    const draw = (key: number) => monumentStartGarrison({ active: true, key, seed: 99 }).map(troop => troop.type);
    expect(draw(3)).toEqual(draw(3));
    const draws = new Set(Array.from({ length: 20 }, (_, key) => draw(key).join()));
    expect(draws.size).toBeGreaterThan(1);
    const start = { attempt: 1, campaignId: "c", mapId: "m" };
    expect(campaignMonumentGarrison({ homeMonument: true }, start))
      .toEqual(campaignMonumentGarrison({ homeMonument: true }, start));
    expect(campaignMonumentGarrison(undefined, start)).toEqual([]);
  });

  it("refuses forged defenders", () => {
    const [troop] = monumentStartGarrison({ active: true, key: 1, seed: 2 });
    expect(isMonumentStartGarrison(undefined)).toBe(true);
    expect(isMonumentStartGarrison([troop!, troop!])).toBe(false);
    expect(isMonumentStartGarrison([troop!, troop!, { ...troop!, rank: 1 }])).toBe(false);
    expect(isMonumentStartGarrison([troop!, troop!, { hp: 100, rank: 2, type: "archer" }])).toBe(false);
  });
});

describe("colony founding with the Monument", () => {
  const island = colonyIslandOffers(1234).find(entry => entry.difficulty === "easy")!;
  const found = (monumentBonus: boolean) => {
    const world = chooseColonyWorld(island);
    let simulation: ReturnType<typeof createSettlementSimulation> | undefined;
    const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
    simulation = createSettlementSimulation({ canWorkerEnterPlot: () => true, homeBuilding: 39, initialSettlers: 2,
      initialStock: {}, now: () => 5000, roads, world });
    const troops = [{ hp: 150, rank: 1, type: "heavy" as const }];
    const arrival = { record: { expeditionId: 7, island, landing: { crew: 2, landed: {}, troops } } } as unknown as
      ColonyArrival;
    expect(settleArrivingColony(simulation, arrival, monumentBonus).ok).toBe(true);
    return simulation.militarySoldiers().filter(soldier => (soldier.combat?.faction ?? 0) === 0);
  };

  it("stations exactly three tier-3 melee defenders at the harbour only with a Monument", () => {
    expect(found(false)).toHaveLength(1);
    const soldiers = found(true);
    const defenders = soldiers.filter(soldier => soldier.rank === 2);
    expect(soldiers).toHaveLength(4);
    expect(defenders).toHaveLength(3);
    expect(defenders.every(soldier => ["shield", "heavy"].includes(soldier.combat!.type))).toBe(true);
    expect(defenders.every(soldier => soldier.building === -1)).toBe(true);
    expect(found(true).map(soldier => soldier.combat!.type)).toEqual(soldiers.map(soldier => soldier.combat!.type));
  });

  it("never gives defenders to an adventure island", () => {
    const startAdventure = vi.fn(() => ({ ok: true })), startColony = vi.fn(() => ({ ok: true }));
    const simulation = { startAdventure, startColony } as unknown as ReturnType<typeof createSettlementSimulation>;
    const arrival = { record: { expeditionId: 7, island: { ...island, kind: "adventure" },
      landing: { crew: 0, landed: {}, troops: [] } } } as unknown as ColonyArrival;
    settleArrivingColony(simulation, arrival, true);
    expect(startColony).not.toHaveBeenCalled();
    expect(startAdventure).toHaveBeenCalledWith({ island: arrival.record.island, troops: [] });
  });
});
