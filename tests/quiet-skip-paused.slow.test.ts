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
import type { SettlementActor } from "../src/shared/settlement/settlement-types";
import { huntingWorld } from "./helpers/hunting-world";

const START = 10_000_000;
const SAVE_SECONDS = 600;
const RESUME_SECONDS = 60;
const TIMEOUT = 300_000;

/**
 * One completed, paused mill at the population cap: its Miller is inside, idle and has no path,
 * target, queue, cargo or handling. Nothing else can move stock, actors or reservations, so the
 * only live fixed-tick work is the clocks and the actor animation timer.
 */
const pausedProductionSettlement = (
  world: ReturnType<typeof huntingWorld>, roads: ReturnType<typeof createRoadNetwork>, paused = true
) => {
  const simulation = createSettlementSimulation({ world, roads, initialSettlers: 100 });
  expect(simulation.buildings()).toHaveLength(1);
  const placed = simulation.placeBuilding(31, 50.5, 20);
  expect(placed.ok, placed.reason).toBe(true);
  const settlement = simulation.saveState();
  const home = settlement.buildings.find(building => building.typeId === 0)!;
  const mill = settlement.buildings.find(building => building.uid === placed.building!.uid)!;
  Object.assign(mill, {
    construction: 1, foundationProgress: 1, productionPaused: paused, working: false,
    status: paused ? "Production stopped" : "Working",
    door: 1, input: { grain: 10 }, output: {}, incoming: {}, required: {}
  });
  const actor: SettlementActor = {
    uid: 1, job: "Miller", home: home.uid, building: mill.uid,
    x: mill.x, y: 2, z: mill.z, yaw: 0, visible: false, action: "idle", ware: null,
    phase: "inside", path: [], pathIndex: 0, timer: -0.2, animationTime: 0
  };
  settlement.actors = [actor];
  settlement.nextActor = 2;
  mill.worker = actor.uid;
  home.idleSettlers = 99;
  settlement.settlers = 99;
  settlement.integrity = countSaveIntegrity(settlement);
  return settlement;
};

const pausedProductionSave = async (paused = true): Promise<GameSaveV1> => {
  const world = huntingWorld();
  const roads = createRoadNetwork(world, { isBlocked: () => false });
  return createGameSave(world, pausedProductionSettlement(world, roads, paused), {
    name: "Paused production", savedAt: START - SAVE_SECONDS * 1000, source: "generated", animals: []
  });
};

const fingerprint = async (save: GameSaveV1) => {
  const loaded = await stageGameSession(save);
  return {
    e1: valueStateKey({ player: save.player, runtime: loaded.runtime, settlement: loaded.settlement }),
    e2: hashSettlementState({ runtime: loaded.runtime, settlement: loaded.settlement, world: loaded.map.world })
  };
};

const replay = async (source: GameSaveV1, now: number, quietSkip: boolean) => {
  const metrics: OfflineIslandMetrics[] = [];
  const result = await advanceOfflineGame(structuredClone(source), now, () => {},
    { exact: true, quietSkip, onIslandMetrics: value => metrics.push(value) });
  return { metrics: metrics[0]!, result };
};

describe.each([180, 600])("quiet paused-production island (%i s)", (seconds) => {
  it("matches the fixed tick over the whole run and after a 60 s resume", async () => {
    const source = await pausedProductionSave();
    const at = source.savedAt + seconds * 1000;
    const exact = await replay(source, at, false);
    const quiet = await replay(source, at, true);

    expect(exact.metrics.fixedTicks).toBe(seconds * 20);
    expect(quiet.metrics.mode).toBe("exact");
    expect(quiet.metrics.quietSkips, "the quiet path ran").toBeGreaterThan(0);
    expect(quiet.metrics.quietTicks, "every paused-production tick was skipped")
      .toBe(seconds * 20 - 1);
    expect(quiet.metrics.fixedTicks, "only the settling tick ran").toBe(1);

    expect(await fingerprint(quiet.result), "E1/E2 value state")
      .toEqual(await fingerprint(exact.result));

    const exactResumed = await replay(exact.result, at + RESUME_SECONDS * 1000, false);
    const quietResumed = await replay(quiet.result, at + RESUME_SECONDS * 1000, false);
    expect(await fingerprint(quietResumed.result), "E3 resume value state")
      .toEqual(await fingerprint(exactResumed.result));
  }, TIMEOUT);
});

describe("quiet paused-production fallback", () => {
  it("runs every fixed tick while the same mill is not paused", async () => {
    const source = await pausedProductionSave(false);
    const at = source.savedAt + 60 * 1000;
    const exact = await replay(source, at, false);
    const quiet = await replay(source, at, true);
    expect(quiet.metrics.quietSkips, "an active production building is never skipped").toBe(0);
    expect(quiet.metrics.fixedTicks).toBe(exact.metrics.fixedTicks);
    expect(await fingerprint(quiet.result)).toEqual(await fingerprint(exact.result));
  }, TIMEOUT);
});

describe("quiet paused-production clock parity", () => {
  it("advances door, animation and transient clocks exactly in a same-session skip", () => {
    const makeSimulation = () => {
      const world = huntingWorld();
      const roads = createRoadNetwork(world, { isBlocked: () => false });
      const simulation = createSettlementSimulation({
        world, roads, clockStart: START, now: () => START
      });
      expect(simulation.loadState(
        pausedProductionSettlement(world, roads)
      ).ok).toBe(true);
      return simulation;
    };
    const exact = makeSimulation(), quiet = makeSimulation();
    // The first fixed tick settles load-time work; the quiet path starts from the second tick.
    exact.update(0.05); quiet.update(0.05);
    expect(quiet.quietSkipStatus()).toEqual({ quiet: true });

    expect(quiet.advanceQuietTicks(180 * 20), "the whole quiet stretch was claimed")
      .toBe(180 * 20);
    // Step the exact lane in the same whole fixed ticks the quiet lane skips.
    for (let tick = 0; tick < 180 * 20; tick++) exact.update(0.05);

    expect(valueStateKey({ settlement: quiet.saveState() }), "E1 value state")
      .toEqual(valueStateKey({ settlement: exact.saveState() }));
    expect(quiet.workCounters(), "door/actor clock work counters")
      .toEqual(exact.workCounters());
    expect(quiet.gameTick()).toBe(exact.gameTick());

    for (let tick = 0; tick < RESUME_SECONDS * 20; tick++) {
      exact.update(0.05); quiet.update(0.05);
    }
    expect(valueStateKey({ settlement: quiet.saveState() }), "E3 resume value state")
      .toEqual(valueStateKey({ settlement: exact.saveState() }));
  }, TIMEOUT);
});
