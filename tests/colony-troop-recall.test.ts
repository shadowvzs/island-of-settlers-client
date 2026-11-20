import { expect, it } from "vitest";

import { createRoadNetwork } from "../src/shared/settlement/road-network";
import type { EmigratedTroop } from "../src/shared/settlement/settlement-military";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { edgeBayWorld } from "./helpers/edge-bay-settlement";

/*
 * No `canWorkerEnterPlot: () => true` here: since harbour rooms block walkers through their authored
 * navigation volumes (041bde88c), that blanket permission lets the porter route plan straight through
 * the harbour hall, which the mover then refuses. The default courtyard rule matches the game.
 */

it("collects real troops, survives boarding reload, and removes them only when the ship leaves", () => {
  const world = edgeBayWorld();
  world.start = { x: 32, z: 42 };
  const returned: EmigratedTroop[] = [];
  let simulation: ReturnType<typeof createSettlementSimulation>;
  const roads = createRoadNetwork(world, { isBlocked: (x,z) => simulation?.isOccupied(x,z) ?? false });
  simulation = createSettlementSimulation({ world, roads, homeBuilding: 39, initialSettlers: 30,
    onTroopsReturned: troops => returned.push(...troops) });
  const party: EmigratedTroop[] = ["heavy", "shield", "archer", "cavalry"].map(type =>
    ({ type: type as EmigratedTroop["type"], rank: 0, hp: 75 }));
  simulation.receiveTroops(party);
  const ids = simulation.militarySoldiers().map(s => s.actor);
  const accepted = simulation.requestTroopPickup(ids, 1);
  expect(accepted).toHaveLength(4);
  expect(simulation.requestTroopPickup(ids, 1)).toEqual([]);
  simulation.returnMilitaryHome(accepted);
  let reloaded = false, visibleDeck = false;
  for (let step = 0; step < 10000 && returned.length < party.length; step++) {
    simulation.update(.05);
    const actors = simulation.frames();
    visibleDeck ||= actors.some(actor => ids.includes(actor.uid) && actor.phase === "navalAboard" && actor.visible);
    if (!reloaded && actors.some(actor => actor.phase === "navalBoarding")) {
      expect(returned).toHaveLength(0);
      expect(simulation.loadState(structuredClone(simulation.saveState()))).toEqual({ ok: true });
      reloaded = true;
    }
  }
  expect(reloaded, JSON.stringify({ ships: simulation.ships(),
    actors: simulation.frames().filter(actor => ids.includes(actor.uid))
      .map(actor => ({ phase: actor.phase, x: actor.x, z: actor.z })), returned })).toBe(true);
  expect(visibleDeck).toBe(true);
  expect(returned).toHaveLength(4);
  expect(returned.map(t => t.type).sort()).toEqual(party.map(t => t.type).sort());
  expect(simulation.militarySoldiers()).toHaveLength(0);
  expect(simulation.ships().some(ship => ship.troopRecall)).toBe(false);
}, 30000);

it("gathers deployed soldiers inside the harbour before the pickup ship arrives, without reloading", () => {
  const world = edgeBayWorld(); world.start = { x: 32, z: 42 };
  let simulation: ReturnType<typeof createSettlementSimulation>;
  const roads = createRoadNetwork(world, { isBlocked: (x,z) => simulation?.isOccupied(x,z) ?? false });
  simulation = createSettlementSimulation({ world, roads, homeBuilding: 39, initialSettlers: 30 });
  const types = ["heavy", "shield", "archer", "cavalry"] as const;
  simulation.receiveTroops(types.map(type => ({ type, rank: 0, hp: 75 })));
  const ids = simulation.militarySoldiers().map(soldier => soldier.actor);
  simulation.callOutMilitary(types, { x: 22, z: 30 });
  for (let tick = 0; tick < 1600; tick++) simulation.update(.05);
  expect(simulation.frames().filter(actor => ids.includes(actor.uid)).every(actor => actor.phase === "militaryField")).toBe(true);
  const accepted = simulation.requestTroopPickup(ids, 180);
  expect(accepted).toHaveLength(4);
  expect(simulation.returnMilitaryHome(accepted)).toBe(true);
  for (let tick = 0; tick < 1600; tick++) simulation.update(.05);
  expect(simulation.frames().filter(actor => ids.includes(actor.uid)).map(actor => actor.phase)).toEqual(
    ["militaryReserve", "militaryReserve", "militaryReserve", "militaryReserve"]);
  expect(simulation.ships().some(ship => ship.troopRecall && ship.phase === "away")).toBe(true);
}, 30000);

it("retains one infantry for a tower completed after recall, boards the rest, and allows explicit extras", () => {
  const world = edgeBayWorld(); world.start = { x: 32, z: 42 };
  const returned: EmigratedTroop[] = [];
  let simulation: ReturnType<typeof createSettlementSimulation>;
  const roads = createRoadNetwork(world, { isBlocked: (x, z) => simulation?.isOccupied(x, z) ?? false });
  simulation = createSettlementSimulation({ world, roads, homeBuilding: 39, initialSettlers: 30,
    initialStock: { planks: 50, stone: 50 },
    onTroopsReturned: troops => returned.push(...troops) });
  simulation.receiveTroops(["heavy", "shield", "archer", "cavalry"].map(type =>
    ({ type: type as EmigratedTroop["type"], rank: 0, hp: 75 })));
  const ids = simulation.militarySoldiers().map(soldier => soldier.actor);
  expect(simulation.requestTroopPickup(ids, 180)).toHaveLength(4);
  let site: ReturnType<typeof simulation.placeBuilding>["building"];
  for (let z = 25; z < 42 && !site; z++) for (let x = 20; x < 43 && !site; x++) {
    const placed = simulation.placeBuilding(1, x, z);
    if (placed.ok) site = placed.building;
  }
  expect(site).toBeDefined();
  // It becomes ready while the requested pickup ship is already sailing toward this colony.
  Object.assign(site!, { construction: 1, required: {}, foundationProgress: 1 });
  expect(simulation.connectRoads(simulation.headquarters.access, site!.access)).toBe(true);
  for (let tick = 0; tick < 1800; tick++) simulation.update(.05);
  const garrison = simulation.militaryBuildings().find(entry => entry.uid === site!.uid)!;
  expect(garrison.target).toBe(1); expect(garrison.stationed).toBe(1);
  const retained = simulation.militarySoldiers().filter(soldier => soldier.building === site!.uid);
  expect(retained).toHaveLength(1); expect(retained[0]!.combat?.type).not.toBe("cavalry");
  expect(simulation.frames().filter(actor => ids.includes(actor.uid) && actor.uid !== retained[0]!.actor)
    .every(actor => actor.phase === "militaryReserve")).toBe(true);
  expect(simulation.loadState(structuredClone(simulation.saveState()))).toEqual({ ok: true });
  for (let tick = 0; tick < 14000 && returned.length < 3; tick++) simulation.update(.05);
  expect(returned).toHaveLength(3);
  expect(simulation.militarySoldiers()).toHaveLength(1);
  expect(simulation.militaryBuildings().find(entry => entry.uid === site!.uid)!.stationed).toBe(1);
  // The colony default is not a hard capacity limit: a deliberate + request can add another guard.
  simulation.setMilitaryTarget(site!.uid, 2);
  expect(simulation.militaryBuildings().find(entry => entry.uid === site!.uid)!.target).toBe(2);
  simulation.receiveTroops([{ type: "shield", rank: 0, hp: 75 }]);
  for (let tick = 0; tick < 1800; tick++) simulation.update(.05);
  expect(simulation.militaryBuildings().find(entry => entry.uid === site!.uid)!.stationed).toBe(2);
}, 30000);
