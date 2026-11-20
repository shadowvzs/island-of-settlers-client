import { expect, it } from "vitest";

import type { SettlementSoldier } from "../src/shared/settlement/settlement-military";
import { createMilitaryActorUpdate } from "../src/shared/settlement/settlement-military-actor-update";
import { addActor, addPlot, createTrafficWorld } from "./helpers/traffic-scenario";

it("waits blocked garrison entrants in a spaced lane behind the access, not on its centre", () => {
  const scene = createTrafficWorld(24);
  const building = addPlot(scene, { typeId: 2, uid: 1, x: 8, z: 8, width: 4, depth: 4, doorRotation: 0 });
  const actor = addActor(scene, { job: "Soldier", phase: "assigned", uid: 10, building: 1,
    x: building.access.x, z: building.access.z });
  addActor(scene, { job: "Soldier", phase: "enterAssigned", uid: 11, building: 1,
    x: building.access.x, z: building.access.z - .1 });
  const soldier = { actor: 10, building: 1, combat: { faction: 0, type: "shield" },
    rank: 0, stationed: false } as unknown as SettlementSoldier;
  const update = createMilitaryActorUpdate(scene.context, new Map([[10, soldier]]), {
    allocateGarrisonOrder: () => 1,
    updateCombatActor: () => false
  });
  update(actor, .05);
  expect(actor.queueTarget).toBeDefined();
  expect(Math.hypot(actor.queueTarget!.x - building.access.x,
    actor.queueTarget!.z - building.access.z)).toBeGreaterThan(.35);
});

it("puts two blocked entrants on opposite sides of the waiting lane", () => {
  const scene = createTrafficWorld(24);
  const building = addPlot(scene, { typeId: 2, uid: 1, x: 8, z: 8, width: 4, depth: 4, doorRotation: 0 });
  const first = addActor(scene, { job: "Soldier", phase: "assigned", uid: 10, building: 1,
    x: building.access.x, z: building.access.z });
  const second = addActor(scene, { job: "Soldier", phase: "assigned", uid: 11, building: 1,
    x: building.access.x, z: building.access.z - .05 });
  addActor(scene, { job: "Soldier", phase: "enterAssigned", uid: 12, building: 1,
    x: building.access.x, z: building.access.z - .1 });
  const soldier = (uid: number) => ({ actor: uid, building: 1, combat: { faction: 0, type: "shield" },
    rank: 0, stationed: false }) as unknown as SettlementSoldier;
  const update = createMilitaryActorUpdate(scene.context,
    new Map([[10, soldier(10)], [11, soldier(11)]]), {
      allocateGarrisonOrder: () => 1,
      updateCombatActor: () => false
    });
  update(first, .05);
  update(second, .05);
  expect(first.queueTarget).toBeDefined();
  expect(second.queueTarget).toBeDefined();
  expect(Math.hypot(first.queueTarget!.x - second.queueTarget!.x,
    first.queueTarget!.z - second.queueTarget!.z)).toBeGreaterThan(.25);
});
