import { expect, it } from "vitest";

import { catapultLocalStone } from "../src/shared/settlement/military-catapult-resupply";
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

const hostileWorld = (variant: "bandit" | "pirate", stones = 6) => {
  const world = worldFixture();
  world.scenario = { ...createMapScenario(), kind: "colony",
    headquarters: { x: 8, z: 8, rotation: 0 }, landing: { x: 14, z: 14 }, settlers: 0,
    buildings: [{ id: 1, x: 28.5, z: 12.5, type: 16, rotation: 0, faction: 2, defenders: 2,
      catapult: { variant, stones } }] };
  return world;
};

it.each(["bandit", "pirate"] as const)("seeds %s with finite real ammo, military crew and one separate porter", variant => {
  const world = hostileWorld(variant);
  expect(isMapScenario(world.scenario, 40, 40)).toBe(true);
  expect(validateMapScenario(world)).toEqual([]);
  const sim = createSettlementSimulation({ world, roads: createRoadNetwork(world) });
  const site = sim.buildings().find(building => building.typeId === 16)!;
  expect(site.enemyCatapultVariant).toBe(variant);
  expect(site.input.stone).toBe(2);
  expect(site.catapultSupply?.ground).toBe(4);
  expect(catapultLocalStone(site)).toBe(6);
  const state = sim.saveState();
  expect(state.settlers).toBe(0);
  const staff = state.actors.find(actor => actor.uid === site.worker)!;
  expect(staff).toMatchObject({ job: "Carrier", building: site.uid, home: site.uid, phase: "inside" });
  expect(sim.militarySoldiers().filter(soldier => soldier.building === site.uid)).toHaveLength(2);
  expect(sim.militarySoldiers().some(soldier => soldier.actor === staff.uid)).toBe(false);
  expect(sim.militarySoldiers().some(soldier => soldier.combat?.type === "heavy")).toBe(true);
  const ids = state.actors.map(actor => actor.uid);
  expect(sim.loadState(state)).toEqual({ ok: true });
  expect(sim.loadState(sim.saveState())).toEqual({ ok: true });
  expect(sim.saveState().actors.map(actor => actor.uid)).toEqual(ids);
  expect(sim.saveState().settlers).toBe(0);
  const forged = sim.saveState();
  delete forged.actors.find(actor => actor.uid === staff.uid)!.hostileCivilianFaction;
  expect(sim.loadState(forged)).toEqual({ ok: false, reason: "Invalid hostile civilian employer" });
});

it("rejects unbounded grants, wrong variants, wrong types and unusable Catapult garrisons", () => {
  for (const stones of [-1, .5, 7, Infinity, NaN]) {
    const world = hostileWorld("bandit", stones);
    expect(isMapScenario(world.scenario, 40, 40)).toBe(false);
  }
  const world = hostileWorld("pirate"), entry = world.scenario!.buildings[0]!;
  entry.garrison = [{ type: "shield", rank: 0, count: 2 }];
  expect(isMapScenario(world.scenario, 40, 40)).toBe(false);
  entry.garrison = [{ type: "archer", rank: 0, count: 1 }, { type: "heavy", rank: 0, count: 1 }];
  expect(isMapScenario(world.scenario, 40, 40)).toBe(false);
  entry.garrison = undefined; entry.type = 4;
  expect(isMapScenario(world.scenario, 40, 40)).toBe(false);
});

it.each(["bandit", "pirate"] as const)("%s fires, physically refills, restores while carrying and exhausts its finite six stones", variant => {
  const world = hostileWorld(variant);
  const sim = createSettlementSimulation({ world, roads: createRoadNetwork(world) });
  const site = () => sim.buildings().find(building => building.typeId === 16)!;
  const porterId = site().worker;
  const operatorIds = sim.militarySoldiers().map(soldier => soldier.actor);
  let spawned = 0, resumed = false, observedRoofRefill = false, priorRoof = site().input.stone!;
  const target = { x: 32, z: 12.5 };
  for (let tick = 0; tick < 14000; tick++) {
    if (spawned < 7 && !sim.militarySoldiers().some(soldier => soldier.combat?.faction === 1)) {
      expect(sim.spawnMilitaryOpponent(target, "archer", 0, 1)).not.toBeNull(); spawned++;
    }
    sim.update(.05);
    const building = site();
    expect(building.input.stone).toBeLessThanOrEqual(2);
    expect(catapultLocalStone(building)).toBeLessThanOrEqual(6);
    if (building.input.stone! > priorRoof) observedRoofRefill = true;
    priorRoof = building.input.stone!;
    if (!resumed && building.catapultSupply?.porter?.carrying &&
      building.catapultSupply.porter.phase === "stairs-up") {
      const saved = sim.saveState();
      const actor = saved.actors.find(actor => actor.uid === porterId)!;
      expect(actor.ware).toBe("stone");
      expect(operatorIds).not.toContain(actor.uid);
      expect(sim.loadState(saved)).toEqual({ ok: true });
      expect(sim.saveState().actors.find(body => body.uid === porterId)).toEqual(actor);
      resumed = true;
    }
    if (spawned === 7 && catapultLocalStone(building) === 0 && !sim.militaryArrows().length) break;
  }
  expect(resumed).toBe(true);
  expect(observedRoofRefill).toBe(true);
  expect(spawned).toBe(7);
  expect(catapultLocalStone(site())).toBe(0);
  expect(site().worker).toBe(porterId);
  expect(sim.militarySoldiers().filter(soldier => soldier.combat?.faction === 1)).toHaveLength(1);
  for (let tick = 0; tick < 400; tick++) sim.update(.05);
  expect(catapultLocalStone(site())).toBe(0);
  expect(sim.militaryArrows()).toHaveLength(0);
  expect(sim.loadState(sim.saveState())).toEqual({ ok: true });
});

it("preserves the exterior hostile survivor and its real stone across structural fall, waiting and reload", () => {
  const world = hostileWorld("bandit");
  // An empty map stock is the nation default (GS-MAP); this island must start with no player stone at all.
  const sim = createSettlementSimulation({ initialStock: {}, roads: createRoadNetwork(world), world });
  const initial = sim.saveState(), site = initial.buildings.find(building => building.typeId === 16)!;
  site.input.stone = 0; site.catapultSupply!.ground = 6;
  expect(sim.loadState(initial)).toEqual({ ok: true });
  const live = () => sim.buildings().find(building => building.typeId === 16)!;
  for (let tick = 0; tick < 1000 && live().catapultSupply?.porter?.phase !== "inbound"; tick++) sim.update(.05);
  expect(live().catapultSupply?.porter?.phase).toBe("inbound");
  const saved = sim.saveState(), staff = saved.actors.find(actor => actor.uid === live().worker)!;
  const location = { x: staff.x, y: staff.y, z: staff.z };
  expect(staff.ware).toBe("stone");
  const door = saved.military!.combat!.doors.find(door => door.building === site.uid)!;
  door.structure!.hp = 0; door.structure!.fallen = 0;
  expect(sim.loadState(saved)).toEqual({ ok: true }); sim.update(.05);
  const survivor = () => sim.saveState().actors.find(actor => actor.uid === staff.uid)!;
  expect(survivor()).toMatchObject({ ...location, hostileCivilianFaction: 2, ware: "stone",
    demolitionReturning: true, phase: "demolitionBlocked" });
  expect(live().worker).toBeUndefined();
  expect(sim.population().people).toBe(0);
  for (let tick = 0; tick < 400; tick++) sim.update(.05);
  expect(survivor()).toMatchObject({ ...location, hostileCivilianFaction: 2, ware: "stone" });
  expect(sim.population().people).toBe(0);
  expect(sim.resourceTotal("stone")).toBe(0);
  const checkpoint = sim.saveState();
  expect(sim.loadState(checkpoint)).toEqual({ ok: true });
  expect(sim.saveState().actors.find(actor => actor.uid === staff.uid)).toEqual(survivor());
  expect(sim.population().people).toBe(0);
});

it("initializes an explicitly edited roof/ground split once and validates its physical limits", () => {
  const world = hostileWorld("pirate", 4);
  world.scenario!.buildings[0]!.catapult!.roofStones = 1;
  const sim = createSettlementSimulation({ world, roads: createRoadNetwork(world) });
  const site = sim.buildings().find(building => building.typeId === 16)!;
  expect(site.input.stone).toBe(1); expect(site.catapultSupply!.ground).toBe(3);
  const saved = sim.saveState(), actors = saved.actors.map(actor => actor.uid);
  expect(sim.loadState(saved)).toEqual({ ok: true });
  expect(sim.saveState().actors.map(actor => actor.uid)).toEqual(actors);
  expect(sim.buildings().find(building => building.typeId === 16)!.input.stone).toBe(1);
  for (const roof of [-1, .5, 3, NaN]) {
    world.scenario!.buildings[0]!.catapult!.roofStones = roof;
    expect(isMapScenario(world.scenario, 40, 40)).toBe(false);
  }
  world.scenario!.buildings[0]!.catapult = { variant: "pirate", stones: 0, roofStones: 1 };
  expect(isMapScenario(world.scenario, 40, 40)).toBe(false);
});
