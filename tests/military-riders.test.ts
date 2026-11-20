import { expect, it, vi } from "vitest";

import type { MilitaryCombatant } from "../src/shared/settlement/military-combat-rules";
import { createMilitaryRiders } from "../src/shared/settlement/military-riders";
import type { SettlementActor, SettlementContext } from "../src/shared/settlement/settlement-types";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

it("returns to the unoccupied side of the horse when comrades block its usual mounting place", () => {
  const size = 40;
  const world = { cellsX: size, cellsZ: size, seaLevel: -1,
    heights: new Float32Array((size + 1) ** 2), walkCost: new Uint8Array(size ** 2).fill(10),
    buildClass: new Uint8Array(size ** 2).fill(BUILD.large), blocking: new Uint8Array(size ** 2),
    props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array(),
      scale: new Float32Array() } } as unknown as WorldData;
  const actor = { uid: 1, x: 17, z: 20, y: 0, visible: true, mounted: false, action: "idle",
    phase: "militaryField", path: [], pathIndex: 0 } as unknown as SettlementActor;
  const horse = { uid: 2, x: 20, z: 20, y: 0, yaw: 0, visible: false } as SettlementActor;
  const blocker = { uid: 3, x: 19.3, z: 20, visible: true, mounted: false } as SettlementActor;
  const context = { actors: [actor, horse, blocker], buildings: [],
    occupied: new Uint8Array(size ** 2), reservations: new Set(), options: { world } } as unknown as SettlementContext;
  const plan = vi.fn();
  const riders = createMilitaryRiders(context, { actorById: id => context.actors.find(a => a.uid === id),
    soldiers: new Map(), hasDoorSlot: () => false, plan, stand: () => {}, walk: () => {} });
  const state = { type: "cavalry", mount: 2, dismounted: true } as MilitaryCombatant;
  riders.updateDismounted(actor, state, "guard", .05);
  expect(plan.mock.calls[0]![2]).toEqual({ x: 20.7, z: 20 });
  Object.assign(actor, plan.mock.calls[0]![2]);
  riders.updateDismounted(actor, state, "guard", .05);
  expect(actor.mounted).toBe(true);
  expect(state.dismounted).toBeUndefined();
  expect(riders.waitingHorses()).toEqual([]);
});
