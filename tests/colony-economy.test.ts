import { describe, expect, it, vi } from "vitest";

import {
  abstractOreShipment, addToHome, colonySupplyDemand, completedMines, FOOD, takeFromStorages
} from "../src/shared/settlement/colony-economy";
import { colonyIslandOffers } from "../src/shared/settlement/colony-expedition-rules";
import { chooseColonyWorld } from "../src/shared/settlement/colony-world-choice";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import type { Goods } from "../src/shared/settlement/settlement-types";
import { wareBoxUnits } from "../src/shared/settlement/ship-cargo-boxes";

// Production code generates these islands itself: serve them from the shared world cache.
vi.mock("../src/shared/world/generation/generate-world", async (importOriginal) =>
  (await import("./helpers/world-cache-store")).cachedGenerateWorldModule(importOriginal));

const building = (typeId: number, construction: number, extra: object = {}) =>
  ({ construction, inventory: {}, typeId, ...extra }) as Parameters<typeof completedMines>[0][number];

describe("colony economy rules", () => {
  it("asks for missing building wares and a food buffer for every mine", () => {
    const buildings = [
      building(39, 1, { colonyHome: true, inventory: { planks: 1, bread: 1 } }),
      building(4, .5, { constructionConsumed: {}, incoming: {}, input: { planks: 2 }, required: { planks: 6, stone: 2 } }),
      building(11, 1, { input: { fish: 1 } }), building(11, 1, { input: {} })
    ];
    expect(completedMines(buildings)).toBe(2);
    // Sites need 4 planks and 2 stone, but storage is also topped up to a reserve of 10.
    expect(colonySupplyDemand(buildings)).toEqual({ [FOOD]: 6, pickaxe: 2, planks: 9, stone: 10 });
  });

  it("requests missing production tools, including bows and pickaxes, without replacing equipped tools", () => {
    const harbour = building(39, 1, { colonyHome: true, inventory: { planks: 10, stone: 10, bow: 1 } });
    const buildings = [harbour, building(22, 1), building(12, 1), building(18, 1, { worker: 42 })];
    expect(colonySupplyDemand(buildings)).toEqual({ pickaxe: 1, [FOOD]: 4 });
    harbour.inventory.bow = 0;
    expect(colonySupplyDemand(buildings)).toMatchObject({ bow: 1, pickaxe: 1 });
  });

  it("takes any food for a food request and files deliveries at the home building", () => {
    const home = building(0, 1, { inventory: { bread: 2, fish: 3, planks: 9 } });
    const store = building(29, 1, { inventory: { meat: 4 } });
    expect(takeFromStorages([home, store], { [FOOD]: 6, planks: 20 })).toEqual({ fish: 3, meat: 3, planks: 9 });
    expect(home.inventory).toEqual({ bread: 2, fish: 0, planks: 0 });
    expect(addToHome([store, home], { coal: 5 })).toBe(true);
    expect(home.inventory.coal).toBe(5);
  });

  it("limits off-screen ore by the food the home island can pay", () => {
    expect(abstractOreShipment(2, 1, 500)).toEqual({ food: 120, ore: 120 });
    expect(abstractOreShipment(2, 3, 50)).toEqual({ food: 50, ore: 50 });
  });
});

describe("visiting ships", () => {
  /** Coal for 50 boxes (box sizes of 2026-10-21): more than one 33-box hold. */
  const COAL = 50 * wareBoxUnits("coal");
  it("sail in, unload, pick up the requested ore up to 33 boxes and leave the map", () => {
    const island = colonyIslandOffers(1234)[0]!;
    const world = chooseColonyWorld(island);
    const loaded: Goods[] = [];
    let simulation: ReturnType<typeof createSettlementSimulation>;
    const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
    simulation = createSettlementSimulation({ homeBuilding: 39, initialSettlers: 2, initialStock: { coal: COAL },
      onVisitorLoaded: goods => loaded.push(goods), roads, world });
    expect(simulation.sendVisitorShip({ planks: 10 }, ["coal"])).not.toBeNull();
    expect(simulation.ships()[0]).toMatchObject({ name: "Supply ship", visitor: true });
    for (let second = 0; second < 600 && simulation.ships().length; second++) simulation.update(1);
    expect(simulation.ships()).toHaveLength(0);
    // 33 full boxes of coal; the rest stays for the next ship.
    const hold = 33 * wareBoxUnits("coal");
    expect(simulation.headquarters.inventory).toMatchObject({ coal: COAL - hold, planks: 10 });
    expect(loaded).toEqual([{ coal: hold }]);
  });
  it("a colony resource (ore) ship takes all of the requested ore in one ship (owner 2026-10-19)", () => {
    const island = colonyIslandOffers(1234)[0]!;
    const world = chooseColonyWorld(island);
    const loaded: Goods[] = [];
    let simulation: ReturnType<typeof createSettlementSimulation>;
    const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
    simulation = createSettlementSimulation({ homeBuilding: 39, initialSettlers: 2, initialStock: { coal: COAL },
      onVisitorLoaded: goods => loaded.push(goods), roads, world });
    expect(simulation.sendVisitorShip({}, ["coal"], "ore")).not.toBeNull();
    let deck = 0;
    for (let second = 0; second < 900 && simulation.ships().length; second++) {
      simulation.update(1);
      deck = Math.max(deck, simulation.shipFrames()[0]?.deckBoxes ?? 0);
    }
    expect(simulation.ships()).toHaveLength(0);
    expect(loaded).toEqual([{ coal: COAL }]);
    expect(simulation.headquarters.inventory.coal ?? 0).toBe(0);
    // More than a hold of boxes: the deck shows (and the porters carry) one full hold of 33.
    expect(deck).toBe(33);
  });
});
