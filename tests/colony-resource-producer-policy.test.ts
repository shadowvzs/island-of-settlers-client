import { describe, expect, it } from "vitest";

import { getSettlementBuildingRegister } from "../src/app/settlement-ui/building-register";
import { getBuildingCardGroups, selectBuildingPicker } from "../src/app/settlement-ui/main-panel/build-helpers";
import { BUILDING_CATALOG } from "../src/render-common/buildings/building-catalog";
import { MARBLE_DEPOSIT_QUANTITY } from "../src/shared/balance/resources";
import { MATERIAL_BUILDING_GROUPS } from "../src/shared/settlement/advanced-material-production";
import { FORESTER_TYPE_ID, QUARRY_TYPE_ID, WOODCUTTER_TYPE_ID } from "../src/shared/settlement/building-type-ids";
import { colonyIslandOffers } from "../src/shared/settlement/colony-expedition-rules";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { COLONY_RESOURCE_TIERS } from "../src/shared/world/colony-resource-tiers";
import { createMapScenario } from "../src/shared/world/map-scenario";
import { BLOCKING } from "../src/shared/world/world-data";
import { fakeColonyConquest } from "./helpers/fake-colony-conquest";
import { huntingWorld } from "./helpers/hunting-world";

const homeProducers = [FORESTER_TYPE_ID, QUARRY_TYPE_ID, WOODCUTTER_TYPE_ID];

describe("colony resource-pair producer policy", () => {
  for (const pair of COLONY_RESOURCE_TIERS) for (const occupied of [false, true])
    it(`tier ${pair.tier}, occupied=${occupied}: only matching producers despite every deposit being present`, () => {
    const world = huntingWorld();
    world.colonyResourceTier = pair.tier;
    if (occupied) {
      world.seaLevel = .5; world.start = { x: 10, z: 31 };
      for (let z = 40; z <= 64; z++) for (let x = 0; x <= 64; x++) world.heights[z * 65 + x] = -1;
      for (let z = 40; z < 64; z++) for (let x = 0; x < 64; x++) {
        const cell = z * 64 + x;
        world.walkCost[cell] = 0; world.blocking[cell] = BLOCKING.water; world.buildClass[cell] = 0;
      }
    } else world.scenario = { ...createMapScenario(), kind: "colony" };
    const deposits = () => COLONY_RESOURCE_TIERS.map((entry, index) => ({
      id: index, material: entry.stone, x: 35 + index * 3, z: 40, remaining: MARBLE_DEPOSIT_QUANTITY
    }));
    world.colonyStoneDeposits = deposits().filter(deposit => deposit.material === pair.stone);
    const simulation = createSettlementSimulation({ world, roads: createRoadNetwork(world), initialSettlers: 0,
      homeBuilding: occupied ? 39 : 0 });
    if (occupied) {
      const island = { ...colonyIslandOffers(1234)[0]!, resourceTier: pair.tier };
      expect(simulation.startColony({ island, landed: {}, troops: [] }).ok).toBe(true);
      fakeColonyConquest(simulation);
    }
    // The foreign pairs' deposits appear after the (faked) conquest: its save round trip rejects a
    // colony whose deposits do not match its pair; the simulation re-reads changed authored deposits.
    world.colonyStoneDeposits = deposits();
    const allowed = BUILDING_CATALOG.filter(entry => simulation.offersBuilding(entry.id)).map(entry => entry.id);
    const cards = getBuildingCardGroups(selectBuildingPicker({ resources: {}, buildableTypes: allowed }))
      .flatMap(group => group.cards);
    const overview = getSettlementBuildingRegister([], "roman", allowed).map(entry => entry.id);
    for (const group of MATERIAL_BUILDING_GROUPS) for (const type of [group.forester, group.woodcutter, group.quarry]) {
      const matching = group.tier === pair.tier;
      expect(simulation.allowsBuilding(type)).toBe(matching);
      expect(simulation.offersBuilding(type)).toBe(matching);
      expect(cards.find(card => card.id === type)?.hidden).toBe(!matching);
      expect(overview.includes(type)).toBe(matching);
      if (matching) continue;
      const before = simulation.saveState();
      expect(simulation.placeBuilding(type, 22, 17).ok).toBe(false);
      expect(simulation.saveState()).toEqual(before);
    }
    for (const type of homeProducers) {
      expect(simulation.offersBuilding(type)).toBe(false);
      expect(simulation.placeBuilding(type, 22, 17).ok).toBe(false);
    }
    for (const type of [33, 1, 22, 57, 58, 59]) expect(simulation.offersBuilding(type)).toBe(true);
  });

  it("preserves home producers and authored specialist quarry deposits on the home island", () => {
    const world = huntingWorld();
    world.colonyStoneDeposits = COLONY_RESOURCE_TIERS.map((pair, index) => ({
      id: index, material: pair.stone, x: 35 + index * 3, z: 40, remaining: 100
    }));
    const simulation = createSettlementSimulation({ world, roads: createRoadNetwork(world), initialSettlers: 0 });
    for (const type of homeProducers) expect(simulation.offersBuilding(type)).toBe(true);
    for (const group of MATERIAL_BUILDING_GROUPS) {
      expect(simulation.offersBuilding(group.quarry)).toBe(true);
      expect(simulation.offersBuilding(group.forester)).toBe(false);
      expect(simulation.offersBuilding(group.woodcutter)).toBe(false);
      expect(simulation.offersBuilding(44 + (group.tier - 1) * 4)).toBe(false);
    }
    expect(simulation.offersBuilding(33)).toBe(true);
  });
});
