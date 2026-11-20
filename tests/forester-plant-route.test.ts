import { expect, it } from "vitest";

import { updateForester } from "../src/shared/settlement/settlement-forester-work";
import { makeBuilding } from "../src/shared/settlement/settlement-placement";
import type { SettlementActor, SettlementContext } from "../src/shared/settlement/settlement-types";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

const fixture = () => {
  const size = 48;
  const world = { cellsX: size, cellsZ: size, seed: 1,
    heights: new Float32Array((size + 1) ** 2), walkCost: new Uint8Array(size ** 2).fill(10),
    blocking: new Uint8Array(size ** 2), slopeClass: new Uint8Array(size ** 2),
    buildClass: new Uint8Array(size ** 2).fill(BUILD.large), props: { count: 0 } } as WorldData;
  const context = { options: { world, roads: { route: () => null } }, buildings: [], actors: [],
    occupied: new Uint8Array(size ** 2), reservations: new Set(["plant:1"]),
    resourceAmounts: new Map() } as unknown as SettlementContext;
  const building = makeBuilding(context, 20, 20, 20, 0);
  building.construction = 1;
  building.nurserySeedlingTaken = true;
  context.buildings.push(building);
  const actor = { uid: 1, home: 0, job: "Forester", building: building.uid,
    x: 22.0738888888889, z: 20.82666666666667, y: 0, visible: true, yaw: 0, ware: null,
    action: "idle", phase: "foresterPlantBlocked", timer: 0, path: [], pathIndex: 0,
    animationTime: 0, stockBuilding: building.uid,
    target: { id: 1, kind: "plant", x: 7.5, z: 38.5 },
    foresterSeedling: { target: { x: 21.66, y: .6, z: 20.826 }, scale: 1.77 }
  } as SettlementActor;
  context.actors.push(actor);
  return { actor, building, context };
};

it("recovers a saved blocked seedling carrier onto a reachable half-cell planting approach", () => {
  const { actor, building, context } = fixture();
  const before = structuredClone(actor), target = actor.target!;
  // Use the real pathfinder. The owner-save analysis separately reproduces the old budget exhaustion;
  // this small empty-terrain fixture checks the route contract without importing that private save.
  updateForester(context, actor, building, .05);
  expect(actor.phase).toBe("foresterPlantWalk");
  expect(actor.x).toBe(before.x); expect(actor.z).toBe(before.z);
  expect(actor.foresterSeedling).toEqual(before.foresterSeedling);
  expect(actor.target).toEqual(before.target);
  expect(context.reservations.has("plant:1")).toBe(true);
  expect(building.nurserySeedlingTaken).toBe(true);
  const end = actor.path.at(-1)!;
  expect(Math.hypot(end.x - target.x, end.z - target.z)).toBeCloseTo(.5, 10);
  expect(end.x * 2).toBe(Math.round(end.x * 2));
  expect(end.z * 2).toBe(Math.round(end.z * 2));
});

it("tries the other standing sides when the nearest planting approach is unavailable", () => {
  const { actor, building, context } = fixture();
  const blocked = { x: 7.5, z: 38 };
  const attempts: { x: number; z: number }[] = [];
  context.options.findWorkerPath = (_from, to) => {
    attempts.push(to);
    if (to.x === blocked.x && to.z === blocked.z) return null;
    return [to];
  };
  updateForester(context, actor, building, .05);
  expect(attempts[0]).toEqual(blocked);
  expect(attempts.length).toBe(2);
  expect(actor.phase).toBe("foresterPlantWalk");
  expect(actor.foresterSeedling).toBeDefined();
});

it("retains the same held seedling and reservation when all standing approaches remain blocked", () => {
  const { actor, building, context } = fixture();
  const before = structuredClone(actor);
  context.options.findWorkerPath = () => null;
  updateForester(context, actor, building, .05);
  expect(actor.phase).toBe("foresterPlantBlocked");
  expect(actor.foresterSeedling).toEqual(before.foresterSeedling);
  expect(actor.target).toEqual(before.target);
  expect(building.nurserySeedlingTaken).toBe(true);
  expect(context.reservations.has("plant:1")).toBe(true);
  // A later topology change can unblock the retry without replacing the actor or cargo.
  context.options.findWorkerPath = (_from, to) => [to];
  updateForester(context, actor, building, 1);
  expect(actor.phase).toBe("foresterPlantWalk");
  expect(actor.foresterSeedling).toEqual(before.foresterSeedling);
});
