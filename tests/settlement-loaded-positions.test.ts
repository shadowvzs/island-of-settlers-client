import { expect, it } from "vitest";

import { createSettlementRenderFrames } from "../src/app/settlement/settlement-render-frames";
import type { WorkerFrame } from "../src/render-common/workers/worker-unit";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { reconcileLoadedWorkerPositions } from "../src/shared/settlement/settlement-loaded-positions";
import { movementOutcome } from "../src/shared/settlement/settlement-navigation-recovery";
import { advanceShipPier } from "../src/shared/settlement/settlement-ship-workpoint";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import type { SettlementActor, SettlementContext } from "../src/shared/settlement/settlement-types";
import { BUILD, type WorldData } from "../src/shared/world/world-data";

const fixture = () => {
  const size = 40;
  const world = { seed: 9, cellsX: size, cellsZ: size, seaLevel: -1, start: { x: 5.5, z: 5.5 },
    heights: new Float32Array((size + 1) ** 2), blocking: new Uint8Array(size ** 2),
    walkCost: new Uint8Array(size ** 2).fill(10), buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    oreAmount: new Uint8Array(size ** 2), mineZone: new Uint16Array(size ** 2), mineZones: [],
    props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array(), scale: new Float32Array() }
  } as unknown as WorldData;
  const simulation = createSettlementSimulation({ world, roads: createRoadNetwork(world) });
  const actor = { uid: 100, x: 20.5, y: 0, z: 20.5, yaw: 0, job: "Fisher", action: "carry",
    ware: "fish", visible: true, phase: "returnBlocked", building: simulation.headquarters.uid,
    home: simulation.headquarters.uid, path: [{ x: 19.5, z: 20.5 }], pathIndex: 0,
    timer: 0, animationTime: 0 } as SettlementActor;
  simulation.frames().push(actor);
  const context = { options: { world, roads: createRoadNetwork(world) }, buildings: simulation.buildings(),
    actors: simulation.frames(), occupied: new Uint8Array(size ** 2) } as SettlementContext;
  return { world, simulation, actor, context };
};

it("repairs invalid saved footing, conserving cargo, identity and accounting; reload is idempotent", () => {
  const { actor, simulation, world } = fixture();
  world.walkCost[20 * 40 + 20] = 0;
  const saved = simulation.saveState(); saved.nextActor = 101;
  const before = { inventory: saved.buildings[0]!.inventory, reservations: saved.reservations,
    transfers: saved.transfers, settlers: saved.settlers };
  expect(simulation.loadState(saved)).toEqual({ ok: true });
  const loaded = simulation.frames().find(entry => entry.uid === actor.uid)!;
  expect(Math.hypot(loaded.x - actor.x, loaded.z - actor.z)).toBeGreaterThan(0);
  expect(world.walkCost[Math.floor(loaded.z) * 40 + Math.floor(loaded.x)]).toBeGreaterThan(0);
  expect(loaded.ware).toBe("fish"); expect(loaded.job).toBe("Fisher");
  expect(loaded.phase).toBe("returnBlocked");
  const repaired = simulation.saveState();
  expect({ inventory: repaired.buildings[0]!.inventory, reservations: repaired.reservations,
    transfers: repaired.transfers, settlers: repaired.settlers }).toEqual(before);
  expect(simulation.loadState(repaired)).toEqual({ ok: true });
  expect(simulation.saveState()).toEqual(repaired);
});

it("leaves valid actors and hidden interiors unchanged, while rejecting occupied placements", () => {
  const { actor, context } = fixture();
  const original = JSON.stringify(actor);
  reconcileLoadedWorkerPositions(context); expect(JSON.stringify(actor)).toBe(original);
  actor.visible = false; context.occupied.fill(1);
  reconcileLoadedWorkerPositions(context); expect(actor.x).toBe(20.5);
  actor.visible = true; context.occupied.fill(0); context.occupied[20 * 40 + 20] = 1;
  reconcileLoadedWorkerPositions(context); expect(actor.x !== 20.5 || actor.z !== 20.5).toBe(true);
});

it.each(["navalBoarding", "navalDeckWalk", "navalAboard"])(
  "preserves a validated owned ship passenger in %s above water during position recovery", phase => {
    const { actor, context, world } = fixture();
    Object.assign(actor, { job: "Soldier", phase, navalOrder: 7, y: 2.5, ware: null });
    world.walkCost[20 * 40 + 20] = 0;
    const aboard = JSON.stringify(actor);
    reconcileLoadedWorkerPositions(context, [], new Set([actor.uid]));
    expect(JSON.stringify(actor)).toBe(aboard);
    reconcileLoadedWorkerPositions(context);
    expect(actor.x !== 20.5 || actor.z !== 20.5 || actor.y !== 2.5).toBe(true);
  });

it("keeps a landing soldier only when its position matches the actual gangway and its height", () => {
  const { actor, context, world } = fixture();
  const pier = { shore: { x: 20.5, z: 20.5 }, point: { x: 23.5, z: 20.5 },
    contact: { x: 23.8, z: 20.5 }, shoreY: 0, y: .18 };
  Object.assign(actor, { job: "Soldier", phase: "adventureGangway", ware: null,
    x: 22, y: .09, z: 20.5 });
  world.walkCost[20 * 40 + 22] = 0;
  const original = JSON.stringify(actor);
  reconcileLoadedWorkerPositions(context, [pier]);
  expect(JSON.stringify(actor)).toBe(original);
  actor.y += .5;
  reconcileLoadedWorkerPositions(context, [pier]);
  expect(actor.y).not.toBeCloseTo(.59);
});

it("preserves only ship-owned counterattack deck soldiers over water", () => {
  const { actor, context, world } = fixture();
  Object.assign(actor, { job: "Soldier", phase: "adventureAboard", ware: null, y: 2.5 });
  world.walkCost[20 * 40 + 20] = 0;
  const original = JSON.stringify(actor);
  reconcileLoadedWorkerPositions(context, [], new Set([actor.uid]));
  expect(JSON.stringify(actor)).toBe(original);
  reconcileLoadedWorkerPositions(context);
  expect(JSON.stringify(actor)).not.toBe(original);
});

it("keeps an indoor carrier route that legitimately starts at its storage exit", () => {
  const { actor, context, simulation } = fixture();
  const home = simulation.headquarters;
  // Loaded indoors, before its first visible step (the hall itself is building body since 041bde88c).
  Object.assign(actor, { job: "Carrier", phase: "exitLoaded", visible: false, ware: "planks",
    x: home.x, z: home.z, building: home.uid,
    delivery: { source: home.uid, destination: home.uid + 1, ware: "planks", reserved: false },
    path: [{ x: home.access.x, z: home.access.z }, { x: home.access.x + 2, z: home.access.z }],
    pathIndex: 0 });
  const original = JSON.stringify(actor);
  reconcileLoadedWorkerPositions(context);
  expect(JSON.stringify(actor)).toBe(original);
});

it("repairs a carrier route fabricated from a storage it is not at, keeping its cargo and identity", () => {
  const { actor, context, simulation } = fixture();
  const home = simulation.headquarters;
  Object.assign(actor, { job: "Carrier", phase: "exitLoaded", ware: "ironOre",
    x: 30.5, z: 30.5, building: home.uid,
    delivery: { source: home.uid, destination: home.uid + 1, ware: "ironOre", reserved: false },
    path: [{ x: home.access.x, z: home.access.z }, { x: 31.5, z: 31.5 }], pathIndex: 0 });
  const original = { uid: actor.uid, job: actor.job, ware: actor.ware, delivery: actor.delivery,
    home: actor.home, building: actor.building };
  reconcileLoadedWorkerPositions(context);
  expect({ uid: actor.uid, job: actor.job, ware: actor.ware, delivery: actor.delivery,
    home: actor.home, building: actor.building }).toEqual(original);
  expect(actor.path[0]?.x === home.access.x && actor.path[0]?.z === home.access.z).toBe(false);
  expect(Math.hypot(actor.x - home.access.x, actor.z - home.access.z)).toBeGreaterThan(2);
});

it("keeps a valid waiting carrier beside a reserved plot without changing its queue or cargo", () => {
  const { actor, context } = fixture();
  actor.job = "Carrier"; actor.phase = "deliver"; actor.x = 20.9; actor.ware = "planks";
  actor.queueTarget = { x: 19.5, z: 20.5 }; actor.queueWait = 2;
  context.occupied[20 * 40 + 21] = 1;
  const queued = JSON.stringify(actor);
  reconcileLoadedWorkerPositions(context);
  expect(JSON.stringify(actor)).toBe(queued);
});

it("keeps a valid reserved dock stance and advances loaded/unloaded legs instead of sliding", () => {
  const { actor, context, world } = fixture();
  actor.job = "Shipwright"; actor.ware = "planks"; actor.phase = "shipPierOut"; actor.tool = "hammer";
  const pier = { shore: { x: 20.5, z: 20.5 }, point: { x: 23.5, z: 20.5 },
    contact: { x: 23.8, z: 20.5 }, shoreY: 0, y: .18 };
  world.walkCost[20 * 40 + 21] = 0;
  const template = { nation: "roman", variant: "test", x: actor.x, y: 0, z: actor.z,
    action: "idle_breathe", animationTime: 0, gaitPhase: 0, runBlend: 0 } as WorkerFrame;
  const frames = createSettlementRenderFrames([template]); frames.updateWorkers([actor], 0);
  advanceShipPier(context, actor, pier, false, .5); frames.updateWorkers([actor], .5);
  expect(movementOutcome(actor)).toBe("moving"); expect(frames.workers[0]!.standingCarry).toBe(false);
  expect(frames.workers[0]!.gaitPhase).toBeGreaterThan(0);
  const position = { x: actor.x, y: actor.y, z: actor.z };
  reconcileLoadedWorkerPositions(context, [pier]);
  expect({ x: actor.x, y: actor.y, z: actor.z }).toEqual(position);
  const blocker = { ...actor, uid: 101, x: actor.x + .1 };
  context.actors.push(blocker); advanceShipPier(context, actor, pier, false, .1);
  frames.updateWorkers([actor], .1); expect(actor.action).toBe("idle");
  expect(frames.workers[0]!.standingCarry).toBe(true);
  context.actors.pop(); actor.ware = null; actor.phase = "shipPierReturn";
  advanceShipPier(context, actor, pier, true, .1); frames.updateWorkers([actor], .1);
  expect(frames.workers[0]!.action).toBe("walk");
  actor.phase = "shipWork"; actor.action = "work"; frames.updateWorkers([actor], .1);
  expect(frames.workers[0]!.shipHullWork).toBe(true); expect(frames.workers[0]!.workerTool).toBe("hammer");
});

it("does not replace a task's unreachable final destination with an intermediate waypoint", () => {
  const { actor, context, world } = fixture();
  actor.path = [{ x: 19.5, z: 20.5 }, { x: 25.5, z: 25.5 }];
  const path = JSON.stringify(actor.path);
  world.walkCost[20 * 40 + 20] = 0; world.walkCost[25 * 40 + 25] = 0;
  reconcileLoadedWorkerPositions(context);
  expect(JSON.stringify(actor.path)).toBe(path); expect(actor.ware).toBe("fish");
});

it("preserves authored well and resource work stances next to reserved or non-walking cells", async () => {
  const { actor, context, world } = fixture();
  const { wellWorkstation } = await import("../src/shared/settlement/settlement-well-work");
  const well = { ...context.buildings[0]!, uid: 2, typeId: 35, x: 20, z: 20, width: 4, depth: 4 };
  context.buildings.push(well); actor.building = well.uid; actor.job = "Well worker"; actor.phase = "inside";
  Object.assign(actor, wellWorkstation(well).point); context.occupied.fill(1);
  const station = JSON.stringify(actor);
  reconcileLoadedWorkerPositions(context); expect(JSON.stringify(actor)).toBe(station);
  context.occupied.fill(0); actor.job = "Stonemason"; actor.phase = "work";
  actor.x = 20.9; actor.z = 20.5; actor.target = { id: 0, kind: "stone", x: 21.3, z: 20.5,
    approach: { x: actor.x, z: actor.z } };
  world.walkCost[20 * 40 + 21] = 0;
  const working = JSON.stringify(actor);
  reconcileLoadedWorkerPositions(context); expect(JSON.stringify(actor)).toBe(working);
});

it("keeps a unit frozen by a failed route where it stands when the save retains the revision epoch", () => {
  const { actor, context } = fixture();
  context.occupied[20 * 40 + 20] = 1;
  actor.navigationRecovery = { attempts: 0, blocked: true, elapsed: 0, notified: true, revision: "1/1/1", task: "t" };
  reconcileLoadedWorkerPositions(context, [], undefined, true);
  expect([actor.x, actor.z]).toEqual([20.5, 20.5]);
  reconcileLoadedWorkerPositions(context);
  expect(actor.x !== 20.5 || actor.z !== 20.5).toBe(true);
});
