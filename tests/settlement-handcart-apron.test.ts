import { describe, expect, it } from "vitest";

import { cartCentreBehind } from "../src/render-common/logistics/handcart-rules";
import { canPullCartAcrossStorageApron } from "../src/shared/settlement/settlement-handcart-apron";
import { startCartReturn } from "../src/shared/settlement/settlement-handcart-moves";
import { stoneRouteFrom } from "../src/shared/settlement/settlement-handcart-roads";
import type { SettlementActor, SettlementContext } from "../src/shared/settlement/settlement-types";
import { BLOCKING } from "../src/shared/world/world-data";
import { createPlacementSession } from "./helpers/placement-session";

/** Exact relative pose and frontage from owner save November4 (1), cart1082. */
const fixture = () => {
  const { roads, simulation, world } = createPlacementSession();
  const storage = simulation.headquarters, flag = storage.access;
  // Adjacent owner building1: its plot begins just beyond the narrow cart rear, not its wheels.
  const neighbor = simulation.placeBuilding(17, storage.x + 3, storage.z + 7);
  expect(neighbor.ok, neighbor.reason).toBe(true);
  Object.assign(neighbor.building!, { construction: 1, productionPaused: true, required: {} });
  roads.replaceSegments([{ start: flag, end: { x: flag.x, z: flag.z + .5 }, tier: "stone" },
    { start: { x: flag.x, z: flag.z + .5 }, end: { x: flag.x, z: flag.z + 1 }, tier: "stone" }]);
  const yaw = 16.664136468338782, x = flag.x + .71022645845676, z = flag.z + .5527914414207;
  const actor = { uid: 1082, x, z, y: 0, yaw, visible: true, job: "Carrier", action: "idle",
    ware: null, phase: "cartRecover", building: storage.uid, home: storage.uid,
    path: [], pathIndex: 0, timer: 0, animationTime: 0,
    handcart: { cargo: 0, owner: storage.uid, state: "parked", roadRevision: roads.revision,
      parked: { ...cartCentreBehind(x, z, yaw), yaw } } } as SettlementActor;
  simulation.frames().push(actor);
  const context = { actors: simulation.frames(), buildings: simulation.buildings(),
    occupied: new Uint8Array(world.cellsX * world.cellsZ), navigationRevision: 1,
    options: { roads, world } } as unknown as SettlementContext;
  return { actor, context, roads, simulation, storage, world };
};

describe("empty handcart storage apron return", () => {
  it("pulls the owner-save pose continuously to its flag before shelving exactly once", () => {
    const { actor, context, simulation, storage } = fixture();
    expect(stoneRouteFrom(context, actor, storage.access)).toBeNull();
    const before = { x: actor.x, z: actor.z }, cart = actor.handcart;
    expect(startCartReturn(context, actor)).toBe(true);
    expect(actor.phase).toBe("cartReturn");
    expect(actor.handcart).toBe(cart);
    expect({ x: actor.x, z: actor.z }).toEqual(before);
    expect(storage.handcarts ?? 0).toBe(0);
    let moved = false;
    for (let step = 0; step < 100 && actor.handcart; step++) {
      const previous = { x: actor.x, z: actor.z };
      simulation.update(.05);
      const distance = Math.hypot(actor.x - previous.x, actor.z - previous.z);
      expect(distance).toBeLessThan(.1);
      moved ||= distance > 0;
    }
    expect(moved).toBe(true);
    expect(actor.handcart).toBeUndefined();
    expect(storage.handcarts).toBe(1);
    expect(Math.hypot(actor.x - storage.access.x, actor.z - storage.access.z)).toBeLessThan(.75);
  });

  it("refuses remote off-road recovery, loaded beds and dirt-only access", () => {
    const { actor, context, roads, storage } = fixture();
    actor.x += 2;
    expect(canPullCartAcrossStorageApron(context, actor, storage)).toBe(false);
    actor.x -= 2;
    actor.handcart!.cargo = 1;
    expect(canPullCartAcrossStorageApron(context, actor, storage)).toBe(false);
    actor.handcart!.cargo = 0;
    actor.x += .1;
    expect(canPullCartAcrossStorageApron(context, actor, storage)).toBe(false);
    actor.x -= .1;
    roads.replaceSegments(roads.segments().map(segment => ({ ...segment, tier: "dirt" })));
    expect(canPullCartAcrossStorageApron(context, actor, storage)).toBe(false);
  });

  it("rejects water under the swept cart body even when the puller's line stays clear", () => {
    const { actor, context, storage, world } = fixture();
    expect(canPullCartAcrossStorageApron(context, actor, storage)).toBe(true);
    const parked = actor.handcart!.parked!;
    const cell = Math.floor(parked.z) * world.cellsX + Math.floor(parked.x);
    world.walkCost[cell] = 0;
    world.blocking[cell] = BLOCKING.water;
    expect(canPullCartAcrossStorageApron(context, actor, storage)).toBe(false);
    expect(startCartReturn(context, actor)).toBe(false);
    expect(actor.handcart!.state).toBe("parked");
  });
});
