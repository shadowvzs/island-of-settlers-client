import { expect, it } from "vitest";

import { createReplaySceneAdapter, createReplaySceneJournal } from "../src/shared/settlement/replay-scene";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { nextScoutLeg, SCOUT_DISTANCE_LIMIT, SCOUT_LEG_LIMIT, scoutPathLength } from "../src/shared/settlement/scout-exploration";
import { moveActor } from "../src/shared/settlement/settlement-paths";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import type { SettlementActor, SettlementContext } from "../src/shared/settlement/settlement-types";
import { BUILD, FOG, type WorldData } from "../src/shared/world/world-data";

const worldFixture = (size = 48) => {
  return { seed: 17, cellsX: size, cellsZ: size, seaLevel: -1, start: { x: 8.5, z: 8.5 },
    heights: new Float32Array((size + 1) ** 2), blocking: new Uint8Array(size ** 2),
    walkCost: new Uint8Array(size ** 2).fill(10), buildClass: new Uint8Array(size ** 2).fill(BUILD.large),
    fog: new Uint8Array(size ** 2), mineZone: new Uint16Array(size ** 2), oreAmount: new Uint8Array(size ** 2),
    mineZones: [], props: { count: 0, types: new Uint8Array(), x: new Float32Array(), z: new Float32Array(),
      scale: new Float32Array(), y: new Float32Array(), rotation: new Float32Array(),
      phase: new Float32Array(), form: new Float32Array() } } as unknown as WorldData;
};
/**
 * The headquarters' territory (radius 48 round the start) is visible since the simulation owns the fog
 * (A13 phase 2): Scout targets lie beyond it on a larger island.
 */
const FAR = { x: 80.5, z: 80.5 };
const create = (world = worldFixture(128)) => {
  const simulation = createSettlementSimulation({ world, roads: createRoadNetwork(world), now: () => 1000,
    initialStock: { spyglass: 1, bow: 3 }, initialSettlers: 20 });
  return { simulation, world };
};

it("uses ground transit without roads, excludes it from24tiles, pauses each≤6tile leg and returns one spyglass", () => {
  const { simulation } = create();
  const assigned = simulation.dispatchSurveyJob("Scout", FAR);
  expect(assigned.ok).toBe(true);
  const actor = assigned.ok ? assigned.actor : undefined;
  expect(actor).toBeDefined();
  let maximum = 0, pauses = 0, previous = "assigned", outbound = false;
  for (let tick = 0; tick < 8000 && actor!.phase !== "retired"; tick++) {
    simulation.update(.05);
    const state = simulation.saveState().surveys[0]?.[1].scout;
    if (state) {
      maximum = Math.max(maximum, state.distance);
      expect(state.distance).toBeLessThanOrEqual(SCOUT_DISTANCE_LIMIT + 1e-6);
      expect(state.legDistance).toBeLessThanOrEqual(SCOUT_LEG_LIMIT + 1e-6);
      if (actor!.phase === "assigned") { outbound = true; expect(state.distance).toBe(0); }
    }
    if (actor!.phase === "surveyWork" && previous !== "surveyWork") {
      pauses++; expect(actor!.timer).toBe(4); expect(actor!.action).toBe("work");
    }
    previous = actor!.phase;
  }
  expect(outbound).toBe(true);
  expect(maximum).toBeCloseTo(24, 5);
  expect(pauses).toBeGreaterThanOrEqual(4);
  expect(actor!.phase).toBe("retired");
  expect(actor!.tool).toBeUndefined();
  expect(simulation.headquarters.inventory).toMatchObject({ spyglass: 1, bow: 3 });
  for (let tick = 0; tick < 200; tick++) simulation.update(.05);
  expect(simulation.headquarters.inventory.spyglass).toBe(1);
});

it("stops at the requested fog target when no other undiscovered ground remains", () => {
  const { simulation, world } = create();
  world.fog.fill(FOG.discovered); world.fog[80 * world.cellsX + 80] = FOG.hidden;
  const assigned = simulation.dispatchSurveyJob("Scout", FAR);
  expect(assigned.ok).toBe(true);
  let maximum = 0;
  for (let tick = 0; tick < 6000 && assigned.ok && assigned.actor.phase !== "retired"; tick++) {
    simulation.update(.05);
    maximum = Math.max(maximum, simulation.saveState().surveys[0]?.[1].scout?.distance ?? 0);
  }
  expect(maximum).toBe(0);
  expect(assigned.ok && assigned.actor.phase).toBe("retired");
  expect(simulation.headquarters.inventory.spyglass).toBe(1);
});

it("rejects known or unreachable targets before reserving people or tools", () => {
  const { simulation, world } = create();
  const target = FAR, cell = 80 * world.cellsX + 80;
  world.fog[cell] = FOG.visible;
  const before = simulation.saveState();
  expect(simulation.dispatchSurveyJob("Scout", target).ok).toBe(false);
  world.fog[cell] = FOG.hidden; world.walkCost[cell] = 0;
  expect(simulation.dispatchSurveyJob("Scout", target).ok).toBe(false);
  expect(simulation.saveState()).toEqual(before);
});

it("charges a detour's navigable polyline rather than its shorter straight distance with bounded search", () => {
  const world = worldFixture();
  world.fog.fill(FOG.visible); world.fog[12 * world.cellsX + 18] = FOG.hidden;
  for (let z = 11; z <= 13; z++) world.walkCost[z * world.cellsX + 16] = 0;
  const origin = { x: 14.5, z: 12.5 };
  const context = { options: { world }, occupied: new Uint8Array(world.cellsX * world.cellsZ),
    buildings: [], actors: [] } as unknown as SettlementContext;
  const leg = nextScoutLeg(context, origin, { distance: 0, legDistance: 0, visited: [] });
  expect(leg).not.toBeNull();
  expect(leg!.length).toBeCloseTo(scoutPathLength(origin, leg!.path), 8);
  expect(leg!.length).toBeGreaterThan(Math.hypot(leg!.target.x - origin.x, leg!.target.z - origin.z));
  expect(leg!.length).toBeLessThanOrEqual(6 + 1e-7);
  expect(leg!.visits).toBeLessThanOrEqual(512);
  expect(nextScoutLeg(context, origin, { distance: 24, legDistance: 0, visited: [] })).toBeNull();
});

it.each(["surveyWalk", "surveyWork"])("restores %s with deterministic choices/budgets and rejects corrupt Scout state", phase => {
  const { simulation, world } = create();
  expect(simulation.dispatchSurveyJob("Scout", FAR).ok).toBe(true);
  for (let tick = 0; tick < 6000 && !simulation.frames().some(actor => actor.phase === phase); tick++) simulation.update(.05);
  expect(simulation.frames().some(actor => actor.phase === phase)).toBe(true);
  const saved = simulation.saveState(), restored = create(structuredClone(world)).simulation;
  expect(restored.loadState(saved)).toEqual({ ok: true });
  for (let tick = 0; tick < 800; tick++) { simulation.update(.05); restored.update(.05); }
  const actual = restored.saveState(), expected = simulation.saveState();
  // Loading rebuilds navigation caches; their generation stamps are not persisted Scout choices.
  for (const snapshot of [actual, expected]) for (const actor of snapshot.actors) {
    if (actor.navigationRecovery) actor.navigationRecovery.revision = "derived-cache-generation";
    if (actor.workerMovementPlan) actor.workerMovementPlan.revision = "derived-cache-generation";
  }
  expect(actual).toEqual(expected);
  for (const change of [
    (state: typeof saved) => { state.surveys[0]![1].scout!.distance = 25; },
    (state: typeof saved) => { state.surveys[0]![1].scout!.legDistance = 7; },
    (state: typeof saved) => { state.surveys[0]![1].scout!.visited.push(-1); },
    (state: typeof saved) => { state.actors.find(actor => actor.job === "Scout")!.tool = "bow"; },
    (state: typeof saved) => { state.surveys.push(structuredClone(state.surveys[0]!)); }
  ]) {
    const corrupt = structuredClone(saved); change(corrupt);
    expect(restored.loadState(corrupt).ok).toBe(false);
  }
});


it("walks six-tile visible prefixes toward fog beyond the actual eighteen-tile Scout sight", () => {
  const world = worldFixture(64), origin = { x: 32.5, z: 32.5 };
  for (let z = 0; z < world.cellsZ; z++) for (let x = 0; x < world.cellsX; x++)
    if (Math.hypot(x + .5 - origin.x, z + .5 - origin.z) <= 18) world.fog[z * world.cellsX + x] = FOG.visible;
  const context = { options: { world }, occupied: new Uint8Array(world.cellsX * world.cellsZ),
    buildings: [], actors: [] } as unknown as SettlementContext;
  const leg = nextScoutLeg(context, origin, { distance: 0, legDistance: 0, visited: [] });
  expect(leg).not.toBeNull();
  expect(leg!.length).toBeCloseTo(6, 8);
  expect(world.fog[Math.floor(leg!.target.z) * world.cellsX + Math.floor(leg!.target.x)]).toBe(FOG.visible);
  expect(leg!.visits).toBeLessThanOrEqual(512);
  world.fog.fill(FOG.visible);
  expect(nextScoutLeg(context, origin, { distance: 6, legDistance: 0, visited: [] })).toBeNull();
});


it("reads the simulation's own fog, so a replay journals no Scout observation", () => {
  const world = worldFixture(), origin = { x: 24.5, z: 24.5 };
  const journal = createReplaySceneJournal(world);
  const options = journal.wrap({ world, roads: createRoadNetwork(world) });
  const context = { options, occupied: new Uint8Array(world.cellsX * world.cellsZ), buildings: [], actors: [] } as unknown as SettlementContext;
  const state = { distance: 0, legDistance: 0, visited: [] };
  journal.begin();
  const selected = nextScoutLeg(context, origin, state);
  expect(selected).not.toBeNull();
  journal.stop();
  expect(journal.snapshot().some(event => "hook" in event)).toBe(false);
  const adapter = createReplaySceneAdapter(world, journal.snapshot());
  const replay = { ...context, options: { ...options, ...adapter.hooks } };
  expect(nextScoutLeg(replay, origin, state)).toEqual(selected);
  world.fog.fill(FOG.visible);
  expect(nextScoutLeg(replay, origin, state)).toBeNull();
  expect(() => adapter.finish()).not.toThrow();
});


it("continues the full bounded tour while its own simulation sight explores each previous step", () => {
  const { simulation, world } = create();
  const assigned = simulation.dispatchSurveyJob("Scout", FAR);
  expect(assigned.ok).toBe(true);
  if (!assigned.ok) throw new Error("Scout assignment failed");
  let maximum = 0;
  for (let tick = 0; tick < 8000 && assigned.actor.phase !== "retired"; tick++) {
    simulation.update(.05);
    maximum = Math.max(maximum, simulation.saveState().surveys[0]?.[1].scout?.distance ?? 0);
  }
  expect(maximum).toBeCloseTo(24, 5);
  expect(assigned.actor.phase).toBe("retired");
  expect(simulation.headquarters.inventory.spyglass).toBe(1);
  // The Scout's trail stays explored after it went home.
  expect(world.fog[80 * world.cellsX + 80]).toBe(FOG.discovered);
});


it("counts actual movement substeps across bends and the final arrival exactly once", () => {
  const world = worldFixture();
  const actor = { uid: 1, job: "Scout", phase: "surveyWalk", action: "walk", visible: true,
    x: 5, y: 0, z: 5, yaw: 0, timer: 0, pathIndex: 0,
    path: [{ x: 5.1, z: 5 }, { x: 5.1, z: 5.1 }, { x: 5.2, z: 5.1 }] } as SettlementActor;
  const context = { options: { world, roads: createRoadNetwork(world) },
    occupied: new Uint8Array(world.cellsX * world.cellsZ), actors: [actor], buildings: [] } as unknown as SettlementContext;
  let distance = 0;
  expect(moveActor(context, actor, 1, moved => { distance += moved; })).toBe(true);
  expect(distance).toBeCloseTo(.3, 10);
  expect(distance).toBeGreaterThan(Math.hypot(actor.x - 5, actor.z - 5));
  expect(moveActor(context, actor, 1, moved => { distance += moved; })).toBe(true);
  expect(distance).toBeCloseTo(.3, 10);
});
