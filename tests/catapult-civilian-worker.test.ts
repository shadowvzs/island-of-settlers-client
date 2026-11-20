import { expect, it } from "vitest";

import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { canCrewCart } from "../src/shared/settlement/settlement-handcart-crew";
import { walkingCarrierCandidates } from "../src/shared/settlement/settlement-land-transport-selection";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import type { SettlementContext } from "../src/shared/settlement/settlement-types";
import { huntingWorld } from "./helpers/hunting-world";

const session = (settlers = 12, ground = 0) => {
  const world = huntingWorld(40), roads = createRoadNetwork(world);
  const simulation = createSettlementSimulation({ world, roads, initialSettlers: settlers,
    initialStock: { stone: 20, planks: 20 } });
  const tower = simulation.placeBuilding(16, 20.5, 10.5).building!;
  Object.assign(tower, { construction: 1, foundationProgress: 1, required: {}, accepts: { stone: false },
    catapultSupply: { ground } });
  expect(simulation.connectRoads(simulation.headquarters.access, tower.access)).toBe(true);
  return { simulation, tower };
};

it("admits exactly one ordinary Carrier from storage and keeps that employee idle inside", () => {
  const { simulation, tower } = session(1);
  const initial = simulation.saveState().settlers;
  for (let tick = 0; tick < 1_200; tick++) simulation.update(.05);
  const saved = simulation.saveState(), worker = saved.actors.find(actor => actor.uid === tower.worker)!;
  expect(worker.job).toBe("Carrier"); expect(worker.phase).toBe("inside"); expect(worker.visible).toBe(false);
  expect(worker.delivery).toBeUndefined(); expect(worker.handcart).toBeUndefined(); expect(worker.tool).toBeUndefined();
  expect(saved.settlers).toBe(initial - 1);
  expect(saved.actors.filter(actor => actor.building === tower.uid && actor.job === "Carrier")).toHaveLength(1);
  expect(simulation.militarySoldiers()).toHaveLength(0);
  const context = { actors: saved.actors, buildings: saved.buildings, settlers: saved.settlers } as SettlementContext;
  const storage = saved.buildings.find(site => site.uid === worker.home)!;
  expect(canCrewCart(context, storage)).toBe(false);
  expect(walkingCarrierCandidates(context, storage, true)).toEqual([]);
  const id = tower.worker;
  expect(simulation.resetCarriers().carriers).toBe(0);
  expect(tower.worker).toBe(id); expect(simulation.saveState()).toEqual(saved);
  expect(simulation.loadState(JSON.parse(JSON.stringify(saved)))).toEqual({ ok: true });
  expect(simulation.saveState()).toEqual(saved);
});

it("does not invent an employee when the real workforce is unavailable", () => {
  const { simulation, tower } = session(0, 1);
  for (let tick = 0; tick < 200; tick++) simulation.update(.05);
  expect(tower.worker).toBeUndefined(); expect(tower.catapultSupply?.porter).toBeUndefined();
  expect(tower.catapultSupply?.ground).toBe(1); expect(tower.input.stone ?? 0).toBe(0);
  expect(simulation.saveState().actors).toHaveLength(0);
});

it("resupplies a lone heavy operator without recruiting or borrowing a shield guard", () => {
  const { simulation, tower } = session(2, 1);
  simulation.setMilitaryTarget(tower.uid, 1);
  simulation.receiveTroops([{ type: "heavy", hp: 100, rank: 0 }]);
  for (let tick = 0; tick < 2_000; tick++) {
    simulation.update(.05);
    if (tower.input.stone === 1 && !tower.catapultSupply?.porter) break;
  }
  expect(tower.input.stone).toBe(1); expect(tower.catapultSupply?.ground).toBe(0);
  const soldiers = simulation.militarySoldiers().filter(soldier => soldier.building === tower.uid);
  expect(soldiers).toHaveLength(1); expect(soldiers[0]!.combat!.type).toBe("heavy");
  expect(tower.worker).not.toBe(soldiers[0]!.actor);
});

it("rejects a saved porter whose actor is not the tower's employed civilian", () => {
  const { simulation, tower } = session(2, 1);
  for (let tick = 0; tick < 1_000 && !tower.catapultSupply?.porter; tick++) simulation.update(.05);
  const saved = simulation.saveState();
  const bad = JSON.parse(JSON.stringify(saved));
  const site = bad.buildings.find((entry: { uid: number }) => entry.uid === tower.uid);
  delete site.worker;
  expect(simulation.loadState(bad)).toEqual({ ok: false, reason: "Invalid catapult porter identity" });
  expect(simulation.saveState()).toEqual(saved);
});

it.each(["roof", "stairs-up"])("demolition saves the same loaded civilian's physical %s evacuation", phase => {
  const { simulation, tower } = session(2, 1);
  for (let tick = 0; tick < 1_500; tick++) {
    simulation.update(.05);
    const porter = tower.catapultSupply?.porter;
    if (porter?.phase === phase && (phase !== "stairs-up" || porter.elapsed > 8)) break;
  }
  expect(tower.catapultSupply?.porter?.phase).toBe(phase);
  const id = tower.catapultSupply!.porter!.actor;
  const worker = simulation.saveState().actors.find(actor => actor.uid === id)!;
  expect(worker.ware).toBe("stone"); expect(worker.y).toBeGreaterThan(tower.y);
  const original = { x: worker.x, y: worker.y, z: worker.z };
  const stock = simulation.resourceTotal("stone");
  expect(simulation.demolishBuilding(tower.uid)).toEqual({ ok: true });
  let after = simulation.saveState().actors.find(actor => actor.uid === id)!;
  expect({ x: after.x, y: after.y, z: after.z }).toEqual(original);
  expect(after.catapultEvacuation).toBeDefined(); expect(after.ware).toBe("stone");
  expect(simulation.resourceTotal("stone")).toBe(stock);
  const checkpoint = simulation.saveState();
  expect(simulation.loadState(JSON.parse(JSON.stringify(checkpoint)))).toEqual({ ok: true });
  expect(simulation.saveState()).toEqual(checkpoint);
  let last = original;
  for (let tick = 0; tick < 2_000; tick++) {
    simulation.update(.05);
    after = simulation.saveState().actors.find(actor => actor.uid === id)!;
    if (!after?.catapultEvacuation) break;
    expect(Math.abs(after.y - last.y)).toBeLessThanOrEqual(.4 * .05 + 1e-8);
    expect(Math.hypot(after.x - last.x, after.z - last.z)).toBeLessThan(.1);
    expect(after.ware).toBe("stone");
    expect(simulation.resourceTotal("stone")).toBe(stock);
    last = { x: after.x, y: after.y, z: after.z };
  }
  expect(after.catapultEvacuation).toBeUndefined(); expect(after.y).toBeCloseTo(tower.y);
  expect(Math.hypot(after.x - tower.doorThreshold.x, after.z - tower.doorThreshold.z)).toBeLessThan(.01);
  for (let tick = 0; tick < 2_000 && simulation.resourceTotal("stone") === stock; tick++) simulation.update(.05);
  expect(simulation.resourceTotal("stone")).toBe(stock + 1);
});

it.each(["roof", "inbound"])("a structural fall accounts for the real loaded Carrier at %s", phase => {
  const { simulation, tower } = session(2, 1);
  for (let tick = 0; tick < 1_500 && tower.catapultSupply?.porter?.phase !== phase; tick++) simulation.update(.05);
  expect(tower.catapultSupply?.porter?.phase).toBe(phase);
  const id = tower.worker!, before = simulation.population().people;
  const saved = simulation.saveState(), body = saved.actors.find(actor => actor.uid === id)!;
  const point = { x: body.x, y: body.y, z: body.z };
  expect(body.ware).toBe("stone");
  const door = saved.military!.combat!.doors.find(entry => entry.building === tower.uid)!;
  door.structure!.hp = 0; door.structure!.fallen = 0;
  expect(simulation.loadState(JSON.parse(JSON.stringify(saved)))).toEqual({ ok: true });
  simulation.update(.05);
  const ruined = simulation.buildings().find(site => site.uid === tower.uid)!;
  expect(ruined.worker).toBeUndefined(); expect(ruined.catapultSupply?.porter).toBeUndefined();
  expect(simulation.transferWare(simulation.headquarters.uid, ruined.uid, "stone", 1)).toBe(false);
  if (phase === "roof") {
    expect(simulation.population().people).toBe(before - 1);
    expect(simulation.saveState().actors.find(actor => actor.uid === id)).toBeUndefined();
    const death = simulation.militaryDeaths().find(entry => entry.id === id)!;
    expect({ x: death.x, y: death.y, z: death.z }).toEqual(point);
    expect(simulation.resourceTotal("stone")).toBe(20);
    expect(ruined.catapultSupply?.drops ?? []).toEqual([]);
  } else {
    expect(simulation.population().people).toBe(before);
    expect(simulation.saveState().actors.find(actor => actor.uid === id)?.ware).toBe("stone");
    for (let tick = 0; tick < 2_000 && simulation.resourceTotal("stone") < 21; tick++) simulation.update(.05);
    expect(simulation.resourceTotal("stone")).toBe(21);
  }
  for (let tick = 0; tick < 20; tick++) simulation.update(.05);
  expect(simulation.buildings().find(site => site.uid === tower.uid)?.worker).toBeUndefined();
  const checkpoint = simulation.saveState();
  expect(simulation.loadState(JSON.parse(JSON.stringify(checkpoint)))).toEqual({ ok: true });
  expect(simulation.saveState()).toEqual(checkpoint);
});
