import { describe, expect, it } from "vitest";

import { stageGameSession } from "../src/app/settlement/game-session";
import type { OfflineIslandMetrics } from "../src/app/settlement/offline-island-replay";
import { advanceOfflineGame } from "../src/app/settlement/offline-progress";
import { valueStateKey } from "../src/shared/settlement/event-core/value-state";
import { createGameSave, type GameSaveV1 } from "../src/shared/settlement/game-save";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { countSaveIntegrity } from "../src/shared/settlement/settlement-save-integrity";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { hashSettlementState } from "../src/shared/settlement/settlement-state-hash";
import type { SettlementActor, SettlementBuilding, SettlementPoint } from "../src/shared/settlement/settlement-types";
import { huntingWorld } from "./helpers/hunting-world";

const START = 10_000_000;
const RESUME_SECONDS = 60;
const TIMEOUT = 300_000;
const HORIZONS = [180, 600] as const;

/** Mills are parked far enough from the straight corridors to stay outside the 1.5-tile envelope. */
const MILLS = [
  { x: 50.5, z: 20 },
  { x: 44.5, z: 20 },
  { x: 38.5, z: 20 }
] as const;
const CORRIDORS = [2.5, 30.5, 58.5] as const;

/**
 * Plain Miller walkers on straight 60-tile final legs. Every mill is completed and paused, the
 * island is at its population cap, and there are no roads, fields, doors, stock contacts, other
 * actors or wildlife. `corridors` selects which corridors the actors walk; passing the same
 * corridor twice makes their routes interact so the guard has to fall back.
 */
const corridorSave = async (
  horizon: number, corridors: readonly number[] = [CORRIDORS[0]!]
): Promise<GameSaveV1> => {
  const world = huntingWorld();
  const roads = createRoadNetwork(world, { isBlocked: () => false });
  const simulation = createSettlementSimulation({ world, roads, initialSettlers: 100 });
  const mills: SettlementBuilding[] = [];
  for (let index = 0; index < corridors.length; index++) {
    const placed = simulation.placeBuilding(31, MILLS[index]!.x, MILLS[index]!.z);
    expect(placed.ok, placed.reason).toBe(true);
    Object.assign(placed.building!, {
      construction: 1, foundationProgress: 1, input: { grain: 10 }, incoming: {}, output: {},
      productionPaused: true, required: {}
    });
    mills.push(placed.building!);
  }
  const settlement = simulation.saveState();
  const home = settlement.buildings.find(building => building.typeId === 0)!;
  settlement.actors = corridors.map((z, index): SettlementActor => ({
    uid: index + 1, job: "Miller", home: home.uid, building: mills[index]!.uid,
    x: 2.5, y: 2, z, yaw: 0, visible: true, action: "walk", ware: null,
    phase: "outbound", path: [{ x: 2.545, z }, { x: 62.5, z }],
    pathIndex: 0, timer: 0, animationTime: 0
  }));
  settlement.nextActor = corridors.length + 1;
  for (let index = 0; index < corridors.length; index++)
    settlement.buildings.find(building => building.uid === mills[index]!.uid)!.worker = index + 1;
  settlement.integrity = countSaveIntegrity(settlement);
  return createGameSave(world, settlement, {
    name: "Movement corridor", savedAt: START - horizon * 1000, source: "generated", animals: []
  });
};

/**
 * Two independent serpentine routes: four straight legs each, one in the southern band and one in
 * the northern band, always clear of the HQ/mill envelopes and at least 14 tiles apart. The walker
 * starts on the first point; the remaining points are its path.
 */
const MULTI_LEG_SOUTH: readonly SettlementPoint[] = [
  { x: 2.5, z: 2.5 }, { x: 62.5, z: 2.5 }, { x: 62.5, z: 30.5 },
  { x: 2.5, z: 30.5 }, { x: 2.5, z: 2.5 }
];
const MULTI_LEG_NORTH: readonly SettlementPoint[] = [
  { x: 2.5, z: 58.5 }, { x: 2.5, z: 44.5 }, { x: 62.5, z: 44.5 },
  { x: 62.5, z: 58.5 }, { x: 2.5, z: 58.5 }
];

/**
 * The same walking fixture, but every actor follows a full polyline and starts on its first point.
 * Each route gets one completed, paused mill; the route itself only has to stay outside the building
 * envelopes, so the walker never interacts with it before the final goal.
 */
const polylineSave = async (
  horizon: number, routes: readonly (readonly SettlementPoint[])[]
): Promise<GameSaveV1> => {
  const world = huntingWorld();
  const roads = createRoadNetwork(world, { isBlocked: () => false });
  const simulation = createSettlementSimulation({ world, roads, initialSettlers: 100 });
  const mills: SettlementBuilding[] = [];
  for (let index = 0; index < routes.length; index++) {
    const placed = simulation.placeBuilding(31, MILLS[index]!.x, MILLS[index]!.z);
    expect(placed.ok, placed.reason).toBe(true);
    Object.assign(placed.building!, {
      construction: 1, foundationProgress: 1, input: { grain: 10 }, incoming: {}, output: {},
      productionPaused: true, required: {}
    });
    mills.push(placed.building!);
  }
  const settlement = simulation.saveState();
  const home = settlement.buildings.find(building => building.typeId === 0)!;
  settlement.actors = routes.map((route, index): SettlementActor => ({
    uid: index + 1, job: "Miller", home: home.uid, building: mills[index]!.uid,
    x: route[0]!.x, y: 2, z: route[0]!.z, yaw: 0, visible: true, action: "walk", ware: null,
    phase: "outbound", path: route.slice(1).map(point => ({ ...point })),
    pathIndex: 0, timer: 0, animationTime: 0
  }));
  settlement.nextActor = routes.length + 1;
  for (let index = 0; index < routes.length; index++)
    settlement.buildings.find(building => building.uid === mills[index]!.uid)!.worker = index + 1;
  settlement.integrity = countSaveIntegrity(settlement);
  return createGameSave(world, settlement, {
    name: "Movement polyline", savedAt: START - horizon * 1000, source: "generated", animals: []
  });
};

const replay = async (source: GameSaveV1, now: number, movementSkip?: boolean) => {
  const metrics: OfflineIslandMetrics[] = [];
  const result = await advanceOfflineGame(structuredClone(source), now, () => {},
    { exact: true, ...(movementSkip === undefined ? {} : { movementSkip }),
      onIslandMetrics: value => metrics.push(value) });
  return { metrics: metrics[0]!, result };
};

const fingerprint = async (save: GameSaveV1) => {
  const loaded = await stageGameSession(save);
  return {
    e1: valueStateKey({ player: save.player, runtime: loaded.runtime, settlement: loaded.settlement }),
    e2: hashSettlementState({ runtime: loaded.runtime, settlement: loaded.settlement, world: loaded.map.world })
  };
};

const proveExact = async (horizon: number, corridors: readonly number[]) => {
  const source = await corridorSave(horizon, corridors);
  const at = source.savedAt + horizon * 1000;
  const baseline = await replay(source, at);
  const exact = await replay(source, at, false);
  const skipped = await replay(source, at, true);

  // Default off: the explicit false run is the untouched exact replay.
  expect(await fingerprint(exact.result), "E1/E2 default behaviour")
    .toEqual(await fingerprint(baseline.result));
  expect(exact.metrics.fixedTicks).toBe(baseline.metrics.fixedTicks);
  expect(exact.metrics.fixedTicks).toBe(horizon * 20);
  expect(skipped.metrics.mode).toBe("exact");

  expect(skipped.metrics.movementSkips, "the movement path ran").toBeGreaterThan(0);
  expect(skipped.metrics.movementSegments, "segments, not single ticks, were fast-forwarded")
    .toBeGreaterThan(0);
  expect(skipped.metrics.movementTicks, "the straight legs were skipped").toBeGreaterThan(1000);
  expect(skipped.metrics.fixedTicks, "exact fixed ticks were replaced")
    .toBe(exact.metrics.fixedTicks - skipped.metrics.movementTicks);
  expect(skipped.metrics.movementActorTicks, "every independent walker advanced")
    .toBe(skipped.metrics.movementTicks * corridors.length);

  expect(await fingerprint(skipped.result), "E1/E2 value state")
    .toEqual(await fingerprint(exact.result));

  const exactResumed = await replay(exact.result, at + RESUME_SECONDS * 1000, false);
  const skippedResumed = await replay(skipped.result, at + RESUME_SECONDS * 1000, false);
  expect(await fingerprint(skippedResumed.result), "E3 resume value state")
    .toEqual(await fingerprint(exactResumed.result));
  return { exact, skipped };
};

const provePolylineExact = async (
  horizon: number, routes: readonly (readonly SettlementPoint[])[]
) => {
  const source = await polylineSave(horizon, routes);
  const at = source.savedAt + horizon * 1000;
  const baseline = await replay(source, at);
  const exact = await replay(source, at, false);
  const skipped = await replay(source, at, true);

  // Default off: the explicit false run is the untouched exact replay.
  expect(await fingerprint(exact.result), "E1/E2 default behaviour")
    .toEqual(await fingerprint(baseline.result));
  expect(exact.metrics.fixedTicks).toBe(baseline.metrics.fixedTicks);
  expect(exact.metrics.fixedTicks).toBe(horizon * 20);
  expect(skipped.metrics.mode).toBe("exact");

  expect(skipped.metrics.movementSkips, "the movement path ran").toBeGreaterThan(0);
  expect(skipped.metrics.movementSegments, "every straight leg re-segmented")
    .toBeGreaterThanOrEqual(4);
  expect(skipped.metrics.movementTicks, "the four straight legs were skipped").toBeGreaterThan(3000);
  expect(skipped.metrics.fixedTicks, "exact fixed ticks were replaced")
    .toBe(exact.metrics.fixedTicks - skipped.metrics.movementTicks);
  expect(skipped.metrics.movementActorTicks, "at least one walker advanced")
    .toBeGreaterThanOrEqual(skipped.metrics.movementTicks);
  expect(skipped.metrics.movementActorTicks, "no more than every walker advanced")
    .toBeLessThanOrEqual(skipped.metrics.movementTicks * routes.length);
  if (routes.length > 1)
    expect(skipped.metrics.movementActorTicks, "both independent walkers advanced")
      .toBeGreaterThan(skipped.metrics.movementTicks);

  expect(await fingerprint(skipped.result), "E1/E2 value state")
    .toEqual(await fingerprint(exact.result));

  const exactResumed = await replay(exact.result, at + RESUME_SECONDS * 1000, false);
  const skippedResumed = await replay(skipped.result, at + RESUME_SECONDS * 1000, false);
  expect(await fingerprint(skippedResumed.result), "E3 resume value state")
    .toEqual(await fingerprint(exactResumed.result));
  return { exact, skipped };
};

describe("corridor movement tick skip", () => {
  it("matches one Miller's exact fixed tick at 180 s and 600 s", async () => {
    const results = [];
    for (const horizon of HORIZONS) results.push(await proveExact(horizon, [CORRIDORS[0]!]));
    expect(results.every(result => result.skipped.metrics.movementSegments > 0)).toBe(true);
  }, TIMEOUT);

  it("matches independent walkers' exact fixed tick at 180 s and 600 s", async () => {
    const results = [];
    for (const horizon of HORIZONS)
      results.push(await proveExact(horizon, [CORRIDORS[0]!, CORRIDORS[1]!]));
    expect(results.every(result => result.skipped.metrics.movementActorTicks ===
      result.skipped.metrics.movementTicks * 2)).toBe(true);
  }, TIMEOUT);

  it("falls back to normal ticks when corridors interact", async () => {
    const horizon = 180;
    const source = await corridorSave(horizon, [CORRIDORS[0]!, CORRIDORS[0]!]);
    const at = source.savedAt + horizon * 1000;
    const exact = await replay(source, at, false);
    const skipped = await replay(source, at, true);
    expect(skipped.metrics.movementTicks, "overlapping corridors are not skipped").toBe(0);
    expect(skipped.metrics.movementActorTicks).toBe(0);
    expect(await fingerprint(skipped.result), "the fallback is the exact replay")
      .toEqual(await fingerprint(exact.result));
  }, TIMEOUT);
});

describe("multi-leg movement tick skip", () => {
  it("matches one four-waypoint Miller's exact fixed tick at 180 s and 600 s", async () => {
    const results = [];
    for (const horizon of HORIZONS)
      results.push(await provePolylineExact(horizon, [MULTI_LEG_SOUTH]));
    expect(results.every(result => result.skipped.metrics.movementSegments >= 4)).toBe(true);
  }, TIMEOUT);

  it("matches two independent four-waypoint Millers at 180 s and 600 s", async () => {
    const results = [];
    for (const horizon of HORIZONS)
      results.push(await provePolylineExact(horizon, [MULTI_LEG_SOUTH, MULTI_LEG_NORTH]));
    expect(results.every(result => result.skipped.metrics.movementActorTicks >
      result.skipped.metrics.movementTicks)).toBe(true);
  }, TIMEOUT);

  it("falls back when two full polylines cross on a later leg", async () => {
    // Stop before the 28-tile first leg ends (31.1 s): the walkers are still on independent
    // vertical legs, so only the future-leg check can reject the skip. Checking just the current
    // leg would have skipped these 600 ticks.
    const horizon = 30;
    // The first legs are 60 tiles apart; only the second legs meet at z=30.5.
    const source = await polylineSave(horizon, [
      [{ x: 2.5, z: 2.5 }, { x: 2.5, z: 30.5 }, { x: 62.5, z: 30.5 }],
      [{ x: 62.5, z: 2.5 }, { x: 62.5, z: 30.5 }, { x: 2.5, z: 30.5 }]
    ]);
    const at = source.savedAt + horizon * 1000;
    const exact = await replay(source, at, false);
    const skipped = await replay(source, at, true);
    expect(skipped.metrics.movementTicks, "future crossing legs are not skipped").toBe(0);
    expect(skipped.metrics.movementActorTicks).toBe(0);
    expect(await fingerprint(skipped.result), "the fallback is the exact replay")
      .toEqual(await fingerprint(exact.result));
  }, TIMEOUT);
});
