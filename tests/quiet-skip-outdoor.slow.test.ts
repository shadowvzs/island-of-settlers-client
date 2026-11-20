import { describe, expect, it } from "vitest";

import { stageGameSession } from "../src/app/settlement/game-session";
import type { OfflineIslandMetrics } from "../src/app/settlement/offline-island-replay";
import { advanceOfflineGame } from "../src/app/settlement/offline-progress";
import { valueStateKey } from "../src/shared/settlement/event-core/value-state";
import { createGameSave, type GameSaveV1 } from "../src/shared/settlement/game-save";
import { hashSettlementState } from "../src/shared/settlement/settlement-state-hash";
import { pausedProductionSettlement } from "./helpers/quiet-paused-building";

const START = 10_000_000;
const SAVE_SECONDS = 600;
const RESUME_SECONDS = 60;
const TIMEOUT = 300_000;

/**
 * One paused building whose worker is stationary inside it. Every newly allowed rule is represented:
 * the outdoor tree/stone/fish/wildlife/field jobs, the animal pig cycle and the drink-chain
 * grower that takes its tool before the pause check.
 */
const PAUSED_PRODUCTION = [
  ["woodcutter", 17],
  ["fisher", 18],
  ["quarry", 19],
  ["forester", 20],
  ["hunter", 22],
  ["charburner", 27],
  ["farmer", 37],
  ["pig breeder", 28],
  ["winegrower", 5]
] as const;

const pausedProductionSave = async (typeId: number, paused = true): Promise<GameSaveV1> => {
  const { settlement, world } = pausedProductionSettlement(typeId, paused);
  return createGameSave(world, settlement, {
    name: `Paused production ${typeId}`, savedAt: START - SAVE_SECONDS * 1000, source: "generated", animals: []
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

describe.each(PAUSED_PRODUCTION)("quiet paused %s production", (_name, typeId) => {
  describe.each([180, 600])("(%i s)", seconds => {
    it("matches the fixed tick over the whole run and after a 60 s resume", async () => {
      const source = await pausedProductionSave(typeId);
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
});

describe.each(PAUSED_PRODUCTION)("quiet active %s fallback", (_name, typeId) => {
  it("runs every fixed tick while the same building is not paused", async () => {
    const source = await pausedProductionSave(typeId, false);
    const at = source.savedAt + 60 * 1000;
    const exact = await replay(source, at, false);
    const quiet = await replay(source, at, true);
    expect(quiet.metrics.quietSkips, "an active production building is never skipped").toBe(0);
    expect(quiet.metrics.fixedTicks).toBe(exact.metrics.fixedTicks);
    expect(await fingerprint(quiet.result)).toEqual(await fingerprint(exact.result));
  }, TIMEOUT);
});
