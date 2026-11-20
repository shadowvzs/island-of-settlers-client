import { STARTER_STOCK } from "@shared/catalog/balance";
import { expect, it } from "vitest";

import { RETIRED_BANDIT_SITE_FORMAT } from "../src/shared/settlement/constants";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { validateMapScenario } from "../src/shared/settlement/settlement-map-scenario";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { createMapScenario, isMapScenario } from "../src/shared/world/map-scenario";
import { BUILD, type WorldData } from "../src/shared/world/world-data";
const worldFixture = () => {
  const size = 40;
  return { seed: 9, cellsX: size, cellsZ: size, seaLevel: -1, start: { x: 5.5, z: 5.5 },
    heights: new Float32Array((size + 1) ** 2), blocking: new Uint8Array(size ** 2),
    walkCost: new Uint8Array(size ** 2).fill(10), buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    oreAmount: new Uint8Array(size ** 2), mineZone: new Uint16Array(size ** 2), mineZones: [],
    props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array(), scale: new Float32Array() }
  } as unknown as WorldData;
};
it("uses exactly the authored HQ/nation/population/stock and keeps old maps automatic", () => {
  const world = worldFixture();
  world.scenario = { ...createMapScenario(), headquarters: { x: 10, z: 10, rotation: 1 },
    nation: "japanese", settlers: 23, stock: { planks: 17 } };
  const simulation = createSettlementSimulation({ world, roads: createRoadNetwork(world) });
  expect(simulation.headquarters).toMatchObject({ x: 10, z: 10, rotation: 1, inventory: { planks: 17 } });
  expect(simulation.playerNation()).toBe("japanese");
  expect(simulation.buildings().filter(building => building.typeId === 0)).toHaveLength(1);
  expect(simulation.saveState().settlers).toBe(23);
  const legacy = worldFixture();
  expect(createSettlementSimulation({ world: legacy, roads: createRoadNetwork(legacy) }).home()).toBeDefined();
});
it("instantiates authored enemies once and preserves identities across save/load", () => {
  const world = worldFixture();
  world.scenario = { ...createMapScenario(), kind: "colony", headquarters: { x: 8, z: 8, rotation: 0 },
    landing: { x: 14, z: 14 }, stock: { ...STARTER_STOCK }, units: [
      { id: 1, x: 25, z: 25, type: "archer", rank: 1, heading: 1, faction: 2, group: 3 }
    ], buildings: [{ id: 2, x: 29, z: 12, rotation: 0, type: 1, faction: 2, defenders: 0 }] };
  expect(validateMapScenario(world)).toEqual([]);
  const simulation = createSettlementSimulation({ world, roads: createRoadNetwork(world) });
  expect(simulation.militarySoldiers()).toHaveLength(1);
  expect(simulation.buildings()).toHaveLength(2);
  const saved = simulation.saveState();
  expect(simulation.loadState(saved)).toEqual({ ok: true });
  expect(simulation.loadState(saved)).toEqual({ ok: true });
  expect(simulation.militarySoldiers()).toHaveLength(1);
  expect(simulation.buildings()).toHaveLength(2);
  // Removing a dead troop may leave optional guard memory in an imported older snapshot.
  const removed = simulation.saveState();
  removed.military!.soldiers = []; removed.actors = [];
  expect(simulation.loadState(removed)).toEqual({ ok: true });
});
it("allows editable HQ-free drafts but rejects enemies on peaceful home maps and invalid play foundations", () => {
  const world = worldFixture(); world.scenario = createMapScenario();
  expect(isMapScenario(world.scenario, 40, 40)).toBe(true);
  expect(validateMapScenario(world)).toContain("Place one headquarters before Play");
  world.scenario.units.push({ id: 1, x: 12, z: 12, faction: 1, group: 0, heading: 0, rank: 0, type: "shield" });
  expect(isMapScenario(world.scenario, 40, 40)).toBe(false);
  world.scenario.kind = "adventure";
  expect(isMapScenario(world.scenario, 40, 40)).toBe(true);
  world.scenario.units[0]!.x = NaN;
  expect(isMapScenario(world.scenario, 40, 40)).toBe(false);
});
it("honours expiry and saves victory claim timing without duplicating rewards", () => {
  const world = worldFixture();
  world.scenario = { ...createMapScenario(), kind: "colony", headquarters: { x: 8, z: 8, rotation: 0 },
    landing: { x: 14, z: 14 }, stock: { coins: 3 }, rewardCoins: 7, claimSeconds: .15,
    buildings: [{ id: 1, x: 29, z: 12, rotation: 0, type: 1, faction: 2, defenders: 0 }] };
  const simulation = createSettlementSimulation({ world, roads: createRoadNetwork(world) });
  const state = simulation.saveState();
  const site = state.buildings.find(building => building.typeId === 1)!;
  site.militaryFaction = 0;
  state.military!.combat!.doors.find(door => door.building === site.uid)!.faction = 0;
  expect(simulation.loadState(state)).toEqual({ ok: true });
  simulation.update(.1);
  expect(simulation.authoredScenarioStatus()?.status).toBe("active");
  expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
  simulation.update(.1);
  expect(simulation.authoredScenarioStatus()?.status).toBe("won");
  expect(simulation.headquarters.inventory.coins).toBe(10);
  expect(simulation.loadState(simulation.saveState())).toEqual({ ok: true });
  simulation.update(1); expect(simulation.headquarters.inventory.coins).toBe(10);
  const expiring = worldFixture();
  expiring.scenario = { ...createMapScenario(), kind: "adventure", expirySeconds: .1,
    units: [{ id: 1, x: 25, z: 25, type: "shield", rank: 0, heading: 0, faction: 1, group: 0 }] };
  const adventure = createSettlementSimulation({ world: expiring, roads: createRoadNetwork(expiring) });
  adventure.update(.2); expect(adventure.authoredScenarioStatus()?.status).toBe("expired");
});
it("validates rotated authored camp footprints and keeps captured camp saves loadable", () => {
  const world = worldFixture();
  world.scenario = { ...createMapScenario(), kind: "colony", headquarters: { x: 8, z: 8, rotation: 0 },
    landing: { x: 14, z: 14 }, buildings: [
      { id: 1, x: 28, z: 12.5, type: 2, bandit: { code: 0, layout: 2 }, enclosure: "building", rotation: 1, faction: 1, defenders: 0 }
    ] };
  expect(validateMapScenario(world)).toEqual([]);
  const simulation = createSettlementSimulation({ world, roads: createRoadNetwork(world) });
  const saved = simulation.saveState(), camp = saved.buildings.find(building => building.bandit !== undefined)!;
  expect(camp.width).toBe(2); expect(camp.depth).toBe(3);
  camp.militaryFaction = 0;
  saved.military!.combat!.doors.find(door => door.building === camp.uid)!.faction = 0;
  expect(simulation.loadState(saved)).toEqual({ ok: true });
});

it("refuses a save in the retired enemyCampModel format and a site whose type is not the catalog's", () => {
  const world = worldFixture();
  world.scenario = { ...createMapScenario(), kind: "colony", headquarters: { x: 8, z: 8, rotation: 0 },
    landing: { x: 14, z: 14 }, buildings: [
      { id: 1, x: 28, z: 12.5, type: 2, bandit: { code: 0, layout: 2 }, enclosure: "building", rotation: 1,
        faction: 1, defenders: 0 }
    ] };
  const simulation = createSettlementSimulation({ world, roads: createRoadNetwork(world) });
  const saved = simulation.saveState(), camp = saved.buildings.find(building => building.bandit !== undefined)!;
  expect(camp).toMatchObject({ bandit: { code: 0, layout: 2 }, typeId: 2 });
  const retired = structuredClone(saved);
  const retiredCamp = retired.buildings.find(building => building.uid === camp.uid)! as unknown as
    Record<string, unknown>;
  delete retiredCamp.bandit;
  retiredCamp.enemyCampModel = 2;
  expect(simulation.loadState(retired)).toEqual({ ok: false, reason: RETIRED_BANDIT_SITE_FORMAT });
  const mismatched = structuredClone(saved);
  mismatched.buildings.find(building => building.uid === camp.uid)!.bandit = { code: 2, layout: 2 };
  expect(simulation.loadState(mismatched)).toEqual({ ok: false, reason: "Invalid neutral camp layout" });
  expect(simulation.loadState(saved)).toEqual({ ok: true });
});

it("validates authored garrisons and preserves their troops through save/load", () => {
  const world = worldFixture();
  world.scenario = { ...createMapScenario(), kind: "colony", headquarters: { x: 8, z: 8, rotation: 0 },
    landing: { x: 14, z: 14 }, buildings: [
      { id: 1, x: 29, z: 12, rotation: 0, type: 1, faction: 2, defenders: 2 }
    ] };
  expect(validateMapScenario(world)).toEqual([]);
  const simulation = createSettlementSimulation({ world, roads: createRoadNetwork(world) });
  expect(simulation.militarySoldiers()).toHaveLength(2);
  const saved = simulation.saveState();
  expect(simulation.loadState(saved)).toEqual({ ok: true });
  expect(simulation.militarySoldiers()).toHaveLength(2);
});

it("caps restored captured-scaffold targets at their physical capacity", () => {
  const world = worldFixture();
  world.scenario = { ...createMapScenario(), kind: "colony", headquarters: { x: 8, z: 8, rotation: 0 },
    landing: { x: 14, z: 14 }, buildings: [
      { id: 1, x: 28, z: 12, rotation: 0, type: 4, bandit: { code: 1, layout: 0 }, faction: 1, defenders: 0 }
    ] };
  expect(validateMapScenario(world)).toEqual([]);
  const simulation = createSettlementSimulation({ world, roads: createRoadNetwork(world) });
  const saved = simulation.saveState(), camp = saved.buildings.find(building => building.typeId === 4)!;
  camp.militaryFaction = 0; saved.military!.targets = [[camp.uid, 6]];
  saved.military!.combat!.doors.find(door => door.building === camp.uid)!.faction = 0;
  expect(simulation.loadState(saved)).toEqual({ ok: true });
  expect(simulation.militaryBuildings().find(site => site.uid === camp.uid)).toMatchObject({ target: 3, capacity: 3 });
});
it("records the map-file id → runtime uid spawn table deterministically and keeps it through save/load", () => {
  const create = () => {
    const world = worldFixture();
    world.scenario = { ...createMapScenario(), kind: "colony", headquarters: { x: 8, z: 8, rotation: 0 },
      landing: { x: 14, z: 14 }, stock: { ...STARTER_STOCK }, nextObjectId: 8, units: [
        { id: 7, x: 25, z: 25, type: "archer", rank: 1, heading: 1, faction: 2, group: 3 },
        { id: 3, x: 26, z: 27, type: "shield", rank: 0, heading: 0, faction: 2, group: 3 }
      ], buildings: [{ id: 5, x: 29, z: 12, rotation: 0, type: 1, faction: 2, defenders: 0 }] };
    return createSettlementSimulation({ world, roads: createRoadNetwork(world) });
  };
  const simulation = create();
  const soldiers = simulation.militarySoldiers().map(soldier => soldier.actor);
  const barracks = simulation.buildings().find(building => building.typeId === 1)!;
  expect(simulation.authoredObjectHandle(7)).toEqual({ space: "actor", uid: soldiers[0] });
  expect(simulation.authoredObjectHandle(3)).toEqual({ space: "actor", uid: soldiers[1] });
  expect(simulation.authoredObjectHandle(5)).toEqual({ space: "building", uid: barracks.uid });
  expect(simulation.authoredObjectHandle(4)).toBeUndefined();
  expect(simulation.authoredScenarioStatus()?.objects).toEqual(create().authoredScenarioStatus()?.objects);
  const saved = JSON.parse(JSON.stringify(simulation.saveState()));
  const restored = create();
  expect(restored.loadState(saved)).toEqual({ ok: true });
  expect(restored.authoredObjectHandle(5)).toEqual({ space: "building", uid: barracks.uid });
  saved.authoredScenario.objects.actor.push(7, 99);
  expect(restored.loadState(saved)).toMatchObject({ ok: false });
});
