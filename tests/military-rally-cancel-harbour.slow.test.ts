import { expect, it } from "vitest";

import { militaryHealth } from "../src/shared/settlement/military-combat-rules";
import { edgeBaySettlement } from "./helpers/edge-bay-settlement";

type Simulation = ReturnType<typeof edgeBaySettlement>;
const RALLY = { x: 8, z: 8 };

/** A finished harbour with idle ships (the development expedition grants them; it is cancelled at once). */
const harbourSettlement = () => {
  const simulation = edgeBaySettlement();
  const started = simulation.startDebugExpedition("colony");
  if (!started.ok) throw new Error(started.reason);
  expect(simulation.cancelColonyExpedition(started.id)).toBe(true);
  for (let step = 0; step < 200; step++) simulation.update(.05);
  const harbour = simulation.buildings().find(building => building.typeId === 39)!;
  return { harbour, simulation };
};
const shields = (count: number) =>
  Array.from({ length: count }, () => ({ hp: militaryHealth("shield", 0), rank: 0, type: "shield" as const }));
const reload = (simulation: Simulation) =>
  expect(simulation.loadState(JSON.parse(JSON.stringify(simulation.saveState())))).toEqual({ ok: true });
const soldierBodies = (simulation: Simulation) => {
  const ids = new Set(simulation.militarySoldiers().map(soldier => soldier.actor));
  return simulation.frames().filter(actor => ids.has(actor.uid));
};
/** Runs until every soldier is stored again; none marches on to the cancelled banner. */
const expectAllStored = (simulation: Simulation, count: number) => {
  for (let step = 0; step < 3600 && soldierBodies(simulation).some(actor => actor.phase !== "militaryReserve");
    step++) simulation.update(.05);
  const military = simulation.saveState().military!;
  expect(soldierBodies(simulation).filter(actor => actor.phase === "militaryReserve")).toHaveLength(count);
  expect(military.combat?.pendingMarches ?? []).toHaveLength(0);
  expect(military.soldiers.every(soldier => !soldier.combat?.destination && !soldier.combat?.order)).toBe(true);
  expect(soldierBodies(simulation).every(actor => Math.hypot(actor.x - RALLY.x, actor.z - RALLY.z) > 10)).toBe(true);
};

it("keeps soldiers queued in the harbour door file at home once the banner is cancelled", () => {
  const { harbour, simulation } = harbourSettlement();
  const before = simulation.militarySoldiers().length;
  expect(simulation.plantMilitaryRally(RALLY)).toBe(true);
  simulation.receiveTroops(shields(12), harbour);
  for (let step = 0; step < 6; step++) simulation.update(.05);
  const leaving = soldierBodies(simulation).filter(actor => actor.phase === "militaryLeaving");
  expect(leaving.length).toBeGreaterThan(0);
  expect(simulation.saveState().military!.combat!.pendingMarches!.length).toBeGreaterThan(0);
  simulation.cancelMilitaryRally();
  reload(simulation);
  expectAllStored(simulation, before + 12);
}, 120000);

it("lands a troop ship's soldiers into the harbour after the banner was cancelled at sea", () => {
  const { simulation } = harbourSettlement();
  const before = simulation.militarySoldiers().length;
  expect(simulation.plantMilitaryRally(RALLY)).toBe(true);
  const id = simulation.sendVisitorShip({}, [], "troops", shields(3));
  expect(id).not.toBeNull();
  const visitor = () => simulation.ships().find(entry => entry.id === id);
  for (let step = 0; step < 6000 && visitor()?.phase !== "sailing"; step++) simulation.update(.05);
  expect(visitor()?.phase).toBe("sailing");
  simulation.cancelMilitaryRally();
  reload(simulation);
  for (let step = 0; step < 6000 && visitor(); step++) simulation.update(.05);
  expect(visitor()).toBeUndefined();
  expectAllStored(simulation, before + 3);
}, 120000);
