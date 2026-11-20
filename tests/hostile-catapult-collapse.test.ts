import { expect, it } from "vitest";

import { collapseCatapultWorker } from "../src/shared/settlement/catapult-worker-collapse";
import type { MilitaryDeathEffect } from "../src/shared/settlement/military-combat-rules";
import { updateDemolitionReturn } from "../src/shared/settlement/settlement-demolition";
import { countOnDutyPeople, createIslandPopulation } from "../src/shared/settlement/settlement-population";
import type { SettlementActor, SettlementBuilding, SettlementContext } from "../src/shared/settlement/settlement-types";

it.each(["inside", "inputReturn", "catapultResupply"])("hostile %s staff never credits friendly population or salvage when its tower falls", phase => {
  const carrier = { uid: 9, job: "Carrier", home: 4, building: 4, hostileCivilianFaction: 2, phase, x: 2,
    y: phase === "catapultResupply" ? 2 : 0, z: 3,
    ware: phase === "inside" ? null : "stone", visible: phase !== "inside", path: [], pathIndex: 0, yaw: 0, action: "idle",
    timer: 0, animationTime: 0 } as SettlementActor;
  const site = { uid: 4, typeId: 16, y: 0, worker: 9, militaryFaction: 2,
    enemyCatapultVariant: "pirate", input: { stone: 1 },
    catapultSupply: { ground: 3, porter: phase === "inside" ? undefined :
      { actor: 9, carrying: true, elapsed: 0, phase: "inbound" } } } as unknown as SettlementBuilding;
  const context = { actors: [carrier], buildings: [site], settlers: 0,
    population: createIslandPopulation() } as unknown as SettlementContext;
  expect(countOnDutyPeople(context)).toBe(0);
  const effects: MilitaryDeathEffect[] = [];
  collapseCatapultWorker(context, site, effect => effects.push(effect));
  if (phase === "inputReturn") {
    expect(context.actors).toEqual([carrier]);
    expect(carrier).toMatchObject({ x: 2, y: 0, z: 3, ware: "stone", hostileCivilianFaction: 2,
      demolitionReturning: true, phase: "demolitionBlocked" });
    context.buildings = [];
    expect(countOnDutyPeople(context)).toBe(0);
    expect(updateDemolitionReturn(context, carrier, 10)).toBe(true);
    expect(carrier.ware).toBe("stone"); expect(carrier.x).toBe(2);
    expect(effects).toEqual([]);
    return;
  }
  expect(context.actors).toHaveLength(0);
  expect(context.population?.onDuty).toBe(0);
  expect(context.settlers).toBe(0);
  expect(site.worker).toBeUndefined();
  expect(site.catapultSupply?.porter).toBeUndefined();
  expect(effects).toMatchObject([{ faction: 2, id: 9, x: 2, y: phase === "catapultResupply" ? 2 : 0, z: 3 }]);
});
