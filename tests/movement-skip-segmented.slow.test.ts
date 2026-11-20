import { describe, expect, it } from "vitest";

import { stageGameSession } from "../src/app/settlement/game-session";
import type { OfflineIslandMetrics } from "../src/app/settlement/offline-island-replay";
import { advanceOfflineGame, type OfflineReplayOptions } from "../src/app/settlement/offline-progress";
import { valueStateKey } from "../src/shared/settlement/event-core/value-state";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";
import { hashSettlementState } from "../src/shared/settlement/settlement-state-hash";
import { D6_CORRIDOR_START, d6CorridorHotspotSave } from "./helpers/d6-corridor-fixture";

const RESUME_SECONDS = 60;
const TIMEOUT = 120_000;
const HORIZONS = [180, 600] as const;

const replay = async (source: GameSaveV1, now: number, options: OfflineReplayOptions) => {
  const metrics: OfflineIslandMetrics[] = [];
  const result = await advanceOfflineGame(structuredClone(source), now, () => {}, {
    exact: true, eventCore: false, ...options, onIslandMetrics: value => metrics.push(value)
  });
  return { metrics: metrics[0]!, result };
};

const fingerprint = async (save: GameSaveV1) => {
  const loaded = await stageGameSession(save);
  return {
    e1: valueStateKey({ player: save.player, runtime: loaded.runtime, settlement: loaded.settlement }),
    e2: hashSettlementState({ runtime: loaded.runtime, settlement: loaded.settlement, world: loaded.map.world })
  };
};

describe("D6 segmented movement tick skip", () => {
  it("skips the clear corridor up to the workplace door and matches exact ticks", async () => {
    const source = await d6CorridorHotspotSave();
    for (const horizon of HORIZONS) {
      const at = D6_CORRIDOR_START + horizon * 1000;
      const exact = await replay(source, at, {});
      const prototype = await replay(source, at, { movementSkip: true, movementSkipGuard: "prototype" });
      const segmented = await replay(source, at, { movementSkip: true, movementSkipGuard: "segmented" });

      // The original whole-route guard refuses the entire route because its final approach enters
      // the mill's 1.5-tile door clearance. The candidate skips the clear prefix and leaves the
      // door tick to the exact pipeline.
      expect(prototype.metrics.movementTicks, "prototype refuses the door route").toBe(0);
      expect(segmented.metrics.movementSkips, "the candidate ran").toBeGreaterThan(0);
      expect(segmented.metrics.movementTicks, "the clear corridor was skipped").toBeGreaterThan(1_000);
      expect(segmented.metrics.movementSegments, "per-actor segments, not one global jump")
        .toBeGreaterThan(0);
      expect(segmented.metrics.movementWork.legStops, "the building boundary stopped a segment")
        .toBeGreaterThan(0);
      expect(segmented.metrics.fixedTicks, "exact fixed ticks replaced")
        .toBe(exact.metrics.fixedTicks - segmented.metrics.movementTicks);

      expect(await fingerprint(prototype.result), `E1/E2 prototype ${horizon}s`)
        .toEqual(await fingerprint(exact.result));
      expect(await fingerprint(segmented.result), `E1/E2 segmented ${horizon}s`)
        .toEqual(await fingerprint(exact.result));

      const exactResumed = await replay(exact.result, at + RESUME_SECONDS * 1000, {});
      const segmentedResumed = await replay(segmented.result, at + RESUME_SECONDS * 1000, {});
      expect(await fingerprint(segmentedResumed.result), `E3 segmented ${horizon}s`)
        .toEqual(await fingerprint(exactResumed.result));
    }
  }, TIMEOUT);

  it("resumes exactly from a save inside the skipped stretch", async () => {
    const source = await d6CorridorHotspotSave();
    const at = D6_CORRIDOR_START + 60_000;
    const exact = await replay(source, at, {});
    const segmented = await replay(source, at, { movementSkip: true, movementSkipGuard: "segmented" });
    expect(segmented.metrics.movementTicks, "the 60 s checkpoint is inside the walk").toBeGreaterThan(1_000);
    expect(await fingerprint(segmented.result), "checkpoint state")
      .toEqual(await fingerprint(exact.result));

    const exactResumed = await replay(exact.result, at + RESUME_SECONDS * 1000, {});
    const segmentedResumed = await replay(segmented.result, at + RESUME_SECONDS * 1000, {});
    expect(await fingerprint(segmentedResumed.result), "E3 resume from inside the skip")
      .toEqual(await fingerprint(exactResumed.result));
  }, TIMEOUT);

  it("matches exact ticks when the walker starts already inside the door clearance", async () => {
    const source = await d6CorridorHotspotSave();
    // Move the checkpoint next to the mill door: the candidate has no clear prefix to skip.
    source.settlement.actors[0]!.x = 48.5;
    source.settlement.actors[0]!.z = 22.5;
    source.settlement.actors[0]!.path = [{ x: 50.5, z: 22.5 }];
    source.settlement.actors[0]!.pathIndex = 0;
    const at = D6_CORRIDOR_START + 60_000;
    const exact = await replay(source, at, {});
    const segmented = await replay(source, at, { movementSkip: true, movementSkipGuard: "segmented" });
    expect(segmented.metrics.movementTicks).toBe(0);
    expect(await fingerprint(segmented.result), "near-door fallback is exact")
      .toEqual(await fingerprint(exact.result));
  }, TIMEOUT);
});
