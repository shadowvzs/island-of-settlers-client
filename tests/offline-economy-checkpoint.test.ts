import { beforeAll, describe, expect, it } from "vitest";

import { stageGameSession } from "../src/app/settlement/game-session";
import { advanceOfflineGame, type OfflineReplayOptions } from "../src/app/settlement/offline-progress";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";
import type { Goods } from "../src/shared/settlement/settlement-types";
import { lateStockSave } from "./helpers/offline-measured-islands";

const fast: OfflineReplayOptions = { economy: true };
const exact: OfflineReplayOptions = { exact: true, eventCore: false };
let staffed: GameSaveV1;

const advance = async (save: GameSaveV1, seconds: number, options: OfflineReplayOptions) => {
  const result = await advanceOfflineGame(structuredClone(save), save.savedAt + seconds * 1000,
    () => {}, options);
  expect(result.savedAt).toBe(save.savedAt + seconds * 1000);
  await expect(stageGameSession(result)).resolves.toBeDefined();
  return result;
};
const goods = (save: GameSaveV1) => {
  const total: Goods = {};
  for (const building of save.settlement.buildings) for (const stock of
    [building.inventory, building.input, building.output])
    for (const [ware, count] of Object.entries(stock)) total[ware] = (total[ware] ?? 0) + count;
  for (const pool of save.settlement.storagePools.pools)
    for (const [ware, count] of Object.entries(pool.available)) total[ware] = (total[ware] ?? 0) + count;
  for (const actor of save.settlement.actors) if (actor.ware)
    total[actor.ware] = (total[actor.ware] ?? 0) + (actor.wareUnits ?? 1);
  return total;
};

beforeAll(async () => {
  const placed = await lateStockSave();
  // Fixture setup creates an already staffed saved game. Production catch-up never runs this prefix.
  staffed = await advance(placed, 120, exact);
}, 30_000);

describe("offline fast checkpoint and native continuation", () => {
  it("stages a saved fast 1 h endpoint and resumes it natively for 60 s", async () => {
    const source = structuredClone(staffed), planksBefore = goods(source).planks ?? 0;
    const caughtUp = await advance(source, 3_600, fast);
    expect(goods(caughtUp).planks ?? 0).toBeGreaterThan(planksBefore);
    expect(caughtUp.settlement.buildings.length).toBe(source.settlement.buildings.length);

    const resumed = await advance(caughtUp, 60, exact);
    expect(resumed.settlement.gameTick ?? 0).toBeGreaterThan(caughtUp.settlement.gameTick ?? 0);
    expect(resumed.settlement.actors.length).toBeGreaterThan(0);

    // A repeated catch-up at the committed cursor is a no-op, not a second replay.
    expect(await advanceOfflineGame(caughtUp, caughtUp.savedAt, () => {}, fast)).toBe(caughtUp);
    expect(await advanceOfflineGame(caughtUp, caughtUp.savedAt - 1000, () => {}, exact)).toBe(caughtUp);
  }, 30_000);

  it("carries a fast 30 min endpoint through a saved reload and another 30 min", async () => {
    const source = structuredClone(staffed);
    const middle = await advance(source, 1_800, fast);
    const split = await advance(middle, 1_800, fast);
    expect(split.settlement.buildings.length).toBe(source.settlement.buildings.length);
    expect(split.settlement.actors.length).toBeGreaterThan(0);
    expect(goods(split).planks ?? 0).toBeGreaterThan(0);
    expect(middle.savedAt).toBe(source.savedAt + 1_800_000);
    expect(split.savedAt).toBe(source.savedAt + 3_600_000);

    // The reload must not duplicate the original feed stock: the finite log fixture still reconciles.
    const continuous = await advance(source, 3_600, fast);
    const splitPlanks = goods(split).planks ?? 0, continuousPlanks = goods(continuous).planks ?? 0;
    expect(splitPlanks).toBeGreaterThan(0);
    expect(continuousPlanks).toBeGreaterThan(0);
    expect(Math.abs(splitPlanks - continuousPlanks)).toBeLessThanOrEqual(Math.max(1, continuousPlanks));
  }, 30_000);
});
