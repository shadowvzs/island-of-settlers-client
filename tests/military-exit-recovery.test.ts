import { expect, it } from "vitest";

import { createBalanceSimulation, forceTroops, typicalForce } from "../tools/bench/garrison-balance-harness";

it("keeps proven exit routes through save/reload, disperses riders and hands every order to field units", () => {
  const simulation = createBalanceSimulation(96, 8);
  simulation.receiveTroops(forceTroops(typicalForce(20, { cavalry: true }, [0])));
  expect(simulation.callOutMilitary(["shield", "heavy", "cavalry"], { x: 70, z: 70 })).toBe(20);
  const saved = structuredClone(simulation.saveState());
  // Route search is deferred, while every accepted troop already retains its assigned goal.
  const queued = saved.military!.combat!.pendingMarches!;
  expect(queued).toHaveLength(20);
  expect(saved.military!.soldiers.every(soldier => soldier.combat?.destination)).toBe(true);
  const riders = saved.military!.soldiers.filter(soldier => soldier.combat?.type === "cavalry");
  const places = riders.map(soldier => queued.find(job => job.uid === soldier.actor)!.goal);
  places.forEach((point, index) => places.slice(index + 1).forEach(other =>
    expect(Math.hypot(other.x - point.x, other.z - point.z)).toBeGreaterThanOrEqual(2.2 - 1e-8)));
  expect(simulation.loadState(saved).ok).toBe(true);
  for (let tick = 0; tick < 20 * 180; tick++) simulation.update(.05);
  expect(simulation.militarySoldiers()).toHaveLength(20);
  expect(simulation.frames().filter(actor => actor.job === "Soldier")
    .every(actor => actor.phase === "militaryField")).toBe(true);
  expect(simulation.loadState(simulation.saveState()).ok).toBe(true);
});
