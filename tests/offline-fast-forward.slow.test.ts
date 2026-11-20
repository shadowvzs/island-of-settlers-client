import { beforeAll, describe, expect, it } from "vitest";

import { stageGameSession } from "../src/app/settlement/game-session";
import { advanceOfflineGame } from "../src/app/settlement/offline-progress";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";
import { heldGoods, oreLeft, standingTreeCount, steadyIslandSave } from "./helpers/offline-steady-island";

const HOUR_MS = 3_600_000;
const SLOW_TIMEOUT = 300_000;

interface Outcome { births: number; goods: Record<string, number>; ore: number; trees: number }

const outcome = async (save: GameSaveV1): Promise<Outcome> => {
  const { world } = (await stageGameSession(save)).map;
  return { births: save.settlement.settlerBirths, goods: heldGoods(save.settlement), ore: oreLeft(world),
    trees: standingTreeCount(world) };
};

/** Fast and exact results agree within a few units, or 6% of what the hour changed. */
const expectClose = (label: string, fast: number, exact: number, start: number) =>
  expect(Math.abs(fast - exact), `${label}: fast ${fast}, exact ${exact}, start ${start}`)
    .toBeLessThanOrEqual(Math.max(5, .06 * Math.abs(exact - start)));

describe("fast offline catch-up", () => {
  let save: GameSaveV1;
  beforeAll(async () => { save = await steadyIslandSave(); }, SLOW_TIMEOUT);

  it.each([false, true])("matches exact ticking over an hour (analytic %s): goods, ore, births, trees", async analytic => {
    const skips: number[] = [];
    const exact = await advanceOfflineGame(save, save.savedAt + HOUR_MS, () => {}, { exact: true, eventCore: false });
    const fast = await advanceOfflineGame(save, save.savedAt + HOUR_MS, () => {},
      { analytic, measured: !analytic, onSkip: seconds => skips.push(seconds) });
    const [start, exactOutcome, fastOutcome] = await Promise.all([outcome(save), outcome(exact), outcome(fast)]);
    expect(skips.reduce((sum, seconds) => sum + seconds, 0)).toBeGreaterThan(HOUR_MS / 1000 / 3);
    expect(fast.savedAt).toBe(exact.savedAt);
    for (const ware of new Set([...Object.keys(exactOutcome.goods), ...Object.keys(fastOutcome.goods)]))
      expectClose(ware, fastOutcome.goods[ware] ?? 0, exactOutcome.goods[ware] ?? 0, start.goods[ware] ?? 0);
    expectClose("ore", fastOutcome.ore, exactOutcome.ore, start.ore);
    expectClose("trees", fastOutcome.trees, exactOutcome.trees, start.trees);
    expect(Math.abs(fastOutcome.births - exactOutcome.births)).toBeLessThanOrEqual(1);
    await expect(stageGameSession(fast)).resolves.toBeDefined();
  }, SLOW_TIMEOUT);

  it.each([false, true])("is deterministic (analytic %s)", async analytic => {
    const options = { analytic, measured: !analytic };
    const first = await advanceOfflineGame(save, save.savedAt + HOUR_MS, () => {}, options);
    const second = await advanceOfflineGame(structuredClone(save), save.savedAt + HOUR_MS, () => {}, options);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  }, SLOW_TIMEOUT);
});
