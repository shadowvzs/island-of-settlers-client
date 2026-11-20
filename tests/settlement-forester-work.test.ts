import { expect, it } from "vitest";

import { createIslandStockContacts } from "../src/app/settlement/island-stock-contacts";
import { startForesterPickup, updateForester } from "../src/shared/settlement/settlement-forester-work";
import { makeBuilding } from "../src/shared/settlement/settlement-placement";
import type { SettlementActor, SettlementContext } from "../src/shared/settlement/settlement-types";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

const fixture = (success: boolean) => {
  const size = 48;
  const world = { cellsX: size, cellsZ: size, seed: 1,
    heights: new Float32Array((size + 1) ** 2), walkCost: new Uint8Array(size ** 2).fill(10),
    blocking: new Uint8Array(size ** 2), slopeClass: new Uint8Array(size ** 2),
    buildClass: new Uint8Array(size ** 2).fill(BUILD.large), props: { count: 0 } } as WorldData;
  let planted = 0;
  const events: string[] = [];
  const context = { options: { world, roads: { route: () => null },
    findWorkerPath: (_from: unknown, to: unknown) => [to], stockContact: createIslandStockContacts(world),
    onPlantTree: () => { planted++; return success; }, onTutorialEvent: (key: string) => events.push(key) }, buildings: [], actors: [],
    occupied: new Uint8Array(size ** 2), reservations: new Set<string>(), nextBuilding: 0,
    resourceAmounts: new Map() } as unknown as SettlementContext;
  const building = makeBuilding(context, 20, 20, 20, 0); building.construction = 1;
  context.buildings.push(building);
  const actor = { uid: 0, home: 0, job: "Forester", tool: "shovel", building: building.uid,
    x: building.access.x, z: building.access.z, y: 0, visible: true, yaw: 0, ware: null,
    action: "idle", phase: "inside", timer: 0, path: [], pathIndex: 0, animationTime: 0,
    preparedTarget: { id: 1, kind: "plant", x: 26.5, z: 26.5 } } as SettlementActor;
  context.actors.push(actor); context.reservations.add("plant:1");
  startForesterPickup(context, actor, building);
  return { context, actor, building, planted: () => planted, events };
};
for (const success of [true, false]) it(`physically carries and ${success ? "plants then replenishes" : "returns failed planting before replenishing"}`, () => {
  const { actor, building, context, events, planted } = fixture(success);
  let missingSeen = false, returnSeen = false;
  for (let tick = 0; tick < 1200 && actor.phase.startsWith("forester"); tick++) {
    updateForester(context, actor, building, .05);
    if (building.nurserySeedlingTaken) missingSeen = true;
    if (actor.phase.startsWith("foresterReturn")) {
      returnSeen = true; expect(building.nurserySeedlingTaken).toBe(true);
      expect(actor.foresterSeedling).toBeDefined();
    }
    if (actor.phase === "foresterPlantWalk" || actor.phase === "foresterPlant") {
      expect(actor.foresterSeedling).toBeDefined(); expect(actor.tool).toBe("shovel");
      expect(building.nurserySeedlingTaken).toBe(true);
    }
  }
  expect(missingSeen).toBe(true); expect(returnSeen).toBe(!success);
  expect(planted()).toBe(1); expect(building.nurserySeedlingTaken).toBe(false);
  expect(actor.foresterSeedling).toBeUndefined(); expect(context.reservations.size).toBe(0);
  expect(actor.phase).toBe("outputWalk");
  expect(events).toEqual(success ? ["plant"] : []);
});
