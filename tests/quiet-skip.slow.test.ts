import { describe, expect, it } from "vitest";

import { stageGameSession } from "../src/app/settlement/game-session";
import type { OfflineIslandMetrics } from "../src/app/settlement/offline-island-replay";
import { advanceOfflineGame } from "../src/app/settlement/offline-progress";
import { valueStateKey } from "../src/shared/settlement/event-core/value-state";
import { createGameSave, type GameSaveV1 } from "../src/shared/settlement/game-save";
import { createRoadNetwork } from "../src/shared/settlement/road-network";
import { createSettlementSimulation } from "../src/shared/settlement/settlement-simulation";
import { hashSettlementState } from "../src/shared/settlement/settlement-state-hash";
import { huntingWorld } from "./helpers/hunting-world";

const SECONDS = 3600;
const RESUME_SECONDS = 60;
const START = 10_000_000;
const TIMEOUT = 300_000;

/**
 * A paused island: one completed HQ at the population cap, no roads, fields, actors, wildlife
 * habitat, ships, soldiers, colony, adventure or trade offers. Fixed ticks can only advance clocks.
 */
const quietIslandSave = async (settlers = 100, storage = false): Promise<GameSaveV1> => {
  const world = huntingWorld();
  const roads = createRoadNetwork(world, { isBlocked: () => false });
  const simulation = createSettlementSimulation({ world, roads, initialSettlers: settlers });
  expect(simulation.buildings()).toHaveLength(1);
  expect(simulation.snapshot().actors).toEqual([]);
  if (storage) {
    let placed: ReturnType<typeof simulation.placeBuilding> | undefined;
    for (const [x, z] of [[18.5, 12.5], [20.5, 20.5], [15.5, 18.5], [22.5, 14.5]] as const) {
      placed = simulation.placeBuilding(29, x, z);
      if (placed.ok) break;
    }
    expect(placed).toMatchObject({ ok: true });
    Object.assign(placed!.building!, { construction: 1, foundationProgress: 1,
      input: {}, incoming: {}, output: {}, required: {} });
  }
  return createGameSave(world, simulation.saveState(), {
    name: "Quiet island", savedAt: START - SECONDS * 1000, source: "generated", animals: [] });
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

describe("quiet-island coarse skip", () => {
  it("matches the exact fixed tick, resumes exactly and really skips ticks", async () => {
    const source = await quietIslandSave();
    const at = source.savedAt + SECONDS * 1000;
    const exact = await replay(source, at, false);
    const quiet = await replay(source, at, true);

    expect(exact.metrics.fixedTicks).toBe(SECONDS * 20);
    expect(quiet.metrics.mode).toBe("exact");
    expect(quiet.metrics.quietSkips, "the quiet path ran").toBeGreaterThan(0);
    expect(quiet.metrics.quietTicks, "provably quiet ticks were skipped").toBe(SECONDS * 20 - 1);
    expect(quiet.metrics.fixedTicks, "only the settling tick ran").toBe(1);
    expect(quiet.metrics.skippedSeconds).toBeCloseTo((SECONDS * 20 - 1) / 20, 6);

    expect(await fingerprint(quiet.result), "E1/E2 value state").toEqual(await fingerprint(exact.result));

    const exactResumed = await replay(exact.result, at + RESUME_SECONDS * 1000, false);
    const quietResumed = await replay(quiet.result, at + RESUME_SECONDS * 1000, false);
    expect(await fingerprint(quietResumed.result), "E3 resume value state")
      .toEqual(await fingerprint(exactResumed.result));
  }, TIMEOUT);

  it("falls back to every fixed tick while the population timer is live", async () => {
    const source = await quietIslandSave(50);
    const at = source.savedAt + 600_000;
    const exact = await replay(source, at, false);
    const quiet = await replay(source, at, true);
    expect(quiet.metrics.quietSkips, "no quiet stretch was claimed").toBe(0);
    expect(quiet.metrics.fixedTicks).toBe(exact.metrics.fixedTicks);
    expect(await fingerprint(quiet.result)).toEqual(await fingerprint(exact.result));
  }, TIMEOUT);

  it("skips a quiet island with completed storage buildings", async () => {
    const source = await quietIslandSave(100, true);
    const at = source.savedAt + 600_000;
    const exact = await replay(source, at, false);
    const quiet = await replay(source, at, true);
    expect(quiet.metrics.quietTicks, "the storage-only island stayed quiet").toBeGreaterThan(0);
    expect(await fingerprint(quiet.result)).toEqual(await fingerprint(exact.result));
  }, TIMEOUT);
});
