import { describe, expect, it } from "vitest";

import { stageGameSession } from "../src/app/settlement/game-session";
import type { OfflineIslandMetrics } from "../src/app/settlement/offline-island-replay";
import { advanceOfflineGame } from "../src/app/settlement/offline-progress";
import { valueStateKey } from "../src/shared/settlement/event-core/value-state";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";
import { hashSettlementState } from "../src/shared/settlement/settlement-state-hash";
import {
  colonyDrawSource, FIXTURE_START, inputChangeSave, lateStockSave, populationBoundarySave
} from "./helpers/offline-measured-islands";
import { heldGoods, oreLeft, standingTreeCount } from "./helpers/offline-steady-island";

const HOUR_MS = 3_600_000;
const RESUME_MS = 300_000;
const SLOW_TIMEOUT = 300_000;

interface IslandOutcome {
  births: number;
  e1: string;
  goods: Record<string, number>;
  hash: string;
  name: string;
  ore: number;
  settlers: number;
  trees: number;
}

interface Outcome { islands: IslandOutcome[] }

const islandSaves = (save: GameSaveV1): GameSaveV1[] => [
  save,
  ...(save.archipelago?.home ? [save.archipelago.home] : []),
  ...save.archipelago?.colonies.flatMap(colony => colony.save ? [colony.save] : []) ?? [],
  ...save.archipelago?.adventures?.flatMap(adventure => adventure.save ? [adventure.save] : []) ?? []
];

/** Value-bearing saved state after a normal stage: goods, people, births, ore and trees. */
const outcome = async (save: GameSaveV1): Promise<Outcome> => ({
  islands: await Promise.all(islandSaves(save).map(async (island, index) => {
    const loaded = await stageGameSession(structuredClone(island));
    return {
      births: island.settlement.settlerBirths,
      e1: valueStateKey({ runtime: loaded.runtime, settlement: loaded.settlement }),
      goods: heldGoods(island.settlement),
      hash: hashSettlementState({
        runtime: loaded.runtime, settlement: loaded.settlement, world: loaded.map.world
      }),
      name: `island-${index}`,
      ore: oreLeft(loaded.map.world),
      settlers: island.settlement.settlers,
      trees: standingTreeCount(loaded.map.world)
    };
  }))
});

const wares = (values: readonly IslandOutcome[]) => {
  const total: Record<string, number> = {};
  for (const island of values)
    for (const [ware, count] of Object.entries(island.goods)) total[ware] = (total[ware] ?? 0) + count;
  return total;
};

/** Absolute error per ware and the largest one relative to how much the hour changed. */
const errorReport = (label: string, measured: Outcome, exact: Outcome, start: Outcome) => {
  const before = wares(start.islands), after = wares(exact.islands), fast = wares(measured.islands);
  const errors = [...new Set([...Object.keys(after), ...Object.keys(fast), ...Object.keys(before)])]
    .map(ware => {
      const change = Math.abs((after[ware] ?? 0) - (before[ware] ?? 0));
      const error = Math.abs((fast[ware] ?? 0) - (after[ware] ?? 0));
      return { change, error, ware, within: error <= Math.max(5, .06 * change) };
    })
    .filter(entry => entry.error > 0)
    .sort((left, right) => right.error - left.error);
  console.log(`${label}: goods errors ${JSON.stringify(errors)}`);
  return errors;
};

const totalSkipped = (metrics: readonly OfflineIslandMetrics[]) =>
  metrics.reduce((sum, value) => sum + value.skippedSeconds, 0);
const verification = (metrics: readonly OfflineIslandMetrics[]) => metrics.reduce((sum, value) => ({
  failed: sum.failed + (value.measured?.failed ?? 0),
  lastFailure: sum.lastFailure ?? value.measured?.lastFailure,
  skips: sum.skips + (value.measured?.skips ?? 0),
  verified: sum.verified + (value.measured?.verified ?? 0)
}), { failed: 0, lastFailure: undefined as Record<string, { actual: number; predicted: number }> | undefined,
  skips: 0, verified: 0 });

const equality = (label: string, exact: Outcome, measured: Outcome) => {
  const e1 = JSON.stringify(exact.islands.map(island => island.e1)) ===
    JSON.stringify(measured.islands.map(island => island.e1));
  const e2 = JSON.stringify(exact.islands.map(island => island.hash)) ===
    JSON.stringify(measured.islands.map(island => island.hash));
  const summary = JSON.stringify(values(exact)) === JSON.stringify(values(measured));
  console.log(`${label}: E1 ${e1}; value summary ${summary}; E2 ${e2}`);
  return { e1, e2, summary };
};

const report = (label: string, start: Outcome, exact: Outcome, measured: Outcome,
  metrics: readonly OfflineIslandMetrics[], skipped: number, acceptE0 = true, oreTolerance = 0) => {
  const exactGoods = wares(exact.islands), measuredGoods = wares(measured.islands);
  const exactBirths = exact.islands.reduce((sum, island) => sum + island.births, 0);
  const measuredBirths = measured.islands.reduce((sum, island) => sum + island.births, 0);
  const exactOre = exact.islands.reduce((sum, island) => sum + island.ore, 0);
  const measuredOre = measured.islands.reduce((sum, island) => sum + island.ore, 0);
  const exactTrees = exact.islands.reduce((sum, island) => sum + island.trees, 0);
  const measuredTrees = measured.islands.reduce((sum, island) => sum + island.trees, 0);
  const exactSettlers = exact.islands.reduce((sum, island) => sum + island.settlers, 0);
  const measuredSettlers = measured.islands.reduce((sum, island) => sum + island.settlers, 0);
  console.log(`${label}: skipped ${skipped} s, verification ${JSON.stringify(verification(metrics))}, ` +
    `fallbacks ${JSON.stringify(metrics.map(value => value.fallbackReason ?? null))}`);
  console.log(`${label}: births exact ${exactBirths} measured ${measuredBirths}; ` +
    `settlers exact ${exactSettlers} measured ${measuredSettlers}; ` +
    `ore exact ${exactOre} measured ${measuredOre}; trees exact ${exactTrees} measured ${measuredTrees}; ` +
    `goods exact ${JSON.stringify(exactGoods)} measured ${JSON.stringify(measuredGoods)}`);
  equality(label, exact, measured);
  expect(metrics.some(value => value.requestedMode === "measured")).toBe(true);
  expect(skipped).toBeGreaterThan(0);
  for (const value of metrics)
    if (value.fallbackReason === "measured-divergence") expect(value.mode).toBe("exact");
  expect(Math.abs(measuredBirths - exactBirths)).toBeLessThanOrEqual(2);
  expect(Math.abs(measuredSettlers - exactSettlers)).toBeLessThanOrEqual(2);
  if (acceptE0) expect(Math.abs(measuredOre - exactOre), `${label}: ore exact ${exactOre} measured ${measuredOre}`)
    .toBeLessThanOrEqual(oreTolerance);
  expect(measuredTrees).toBe(exactTrees);
  const errors = errorReport(label, measured, exact, start);
  for (const { error, ware, within } of errors) {
    if (acceptE0) expect(within, `${label}: ${ware} off by ${error}`).toBe(true);
  }
  return errors;
};

/** Value summary without diagnostics (full E1 and E2 are reported separately). */
const values = (value: Outcome) => value.islands.map(({ e1: _e1, hash: _hash, ...island }) => island);

/** E3 is reported, not assumed: compare the fixed exact resume window by the same E0 goods bound. */
const expectResumeClose = async (label: string, exact: GameSaveV1, measured: GameSaveV1, resumeAt: number) => {
  const exactResume = await advanceOfflineGame(structuredClone(exact), resumeAt, () => {}, { exact: true });
  const measuredResume = await advanceOfflineGame(structuredClone(measured), resumeAt, () => {}, { exact: true });
  const exactOutcome = await outcome(exactResume), measuredOutcome = await outcome(measuredResume);
  equality("resume " + label, exactOutcome, measuredOutcome);
  for (const { error, ware, within } of errorReport("resume " + label, measuredOutcome, exactOutcome, exactOutcome))
    expect(within, `${label} resume: ${ware} off by ${error}`).toBe(true);
  const exactBirths = exactOutcome.islands.reduce((sum, island) => sum + island.births, 0);
  const measuredBirths = measuredOutcome.islands.reduce((sum, island) => sum + island.births, 0);
  expect(Math.abs(measuredBirths - exactBirths)).toBeLessThanOrEqual(2);
};

describe("measured offline accuracy", () => {
  it("keeps a late finite stock inside the accepted error and stops the skip before depletion", async () => {
    const save = await lateStockSave();
    const start = await outcome(save);
    const exact = await advanceOfflineGame(structuredClone(save), FIXTURE_START + HOUR_MS, () => {}, { exact: true });
    const metrics: OfflineIslandMetrics[] = [], skips: number[] = [];
    const measured = await advanceOfflineGame(structuredClone(save), FIXTURE_START + HOUR_MS, () => {}, {
      measured: true, onIslandMetrics: value => metrics.push(value), onSkip: seconds => skips.push(seconds)
    });
    const skipped = skips.reduce((sum, seconds) => sum + seconds, 0);
    expect(totalSkipped(metrics)).toBe(skipped);
    report("late stock", start, await outcome(exact), await outcome(measured), metrics, skipped);
    await expectResumeClose("late stock", exact, measured, FIXTURE_START + HOUR_MS + RESUME_MS);
    expect(start.islands.length).toBe(1);
  }, SLOW_TIMEOUT);

  it("detects an alternative-food input change and reports the residual skip error", async () => {
    const save = await inputChangeSave();
    const start = await outcome(save);
    const exact = await advanceOfflineGame(structuredClone(save), FIXTURE_START + HOUR_MS, () => {}, { exact: true });
    const metrics: OfflineIslandMetrics[] = [], skips: number[] = [];
    const measured = await advanceOfflineGame(structuredClone(save), FIXTURE_START + HOUR_MS, () => {}, {
      measured: true, onIslandMetrics: value => metrics.push(value), onSkip: seconds => skips.push(seconds)
    });
    const exactOutcome = await outcome(exact), measuredOutcome = await outcome(measured);
    const errors = report("input change", start, exactOutcome, measuredOutcome, metrics,
      skips.reduce((sum, seconds) => sum + seconds, 0), false);
    // Until 2026-11-09 the measured ledger missed the shared storage pools, so this fixture diverged
    // once (one skip, one failed post-jump check, goods error bound 64, decisions/06). With pool stock
    // counted (offline-red) the measured regime follows the input change: every skip passes its
    // post-jump check and the goods meet the ordinary E0 bound.
    const checks = verification(metrics);
    expect(metrics.some(value => value.fallbackReason === "measured-divergence")).toBe(false);
    expect(checks.failed).toBe(0);
    expect(checks.verified).toBe(checks.skips);
    for (const { error, ware, within } of errors) expect(within, `input change: ${ware} off by ${error}`).toBe(true);
    const oreError = Math.abs(measuredOutcome.islands.reduce((sum, island) => sum + island.ore, 0) -
      exactOutcome.islands.reduce((sum, island) => sum + island.ore, 0));
    expect(oreError).toBeLessThanOrEqual(64);
  }, SLOW_TIMEOUT);

  it("keeps a population-boundary skip inside the accepted error or falls back", async () => {
    const save = await populationBoundarySave();
    const start = await outcome(save);
    const exact = await advanceOfflineGame(structuredClone(save), FIXTURE_START + HOUR_MS, () => {}, { exact: true });
    const metrics: OfflineIslandMetrics[] = [], skips: number[] = [];
    const measured = await advanceOfflineGame(structuredClone(save), FIXTURE_START + HOUR_MS, () => {}, {
      measured: true, onIslandMetrics: value => metrics.push(value), onSkip: seconds => skips.push(seconds)
    });
    report("population boundary", start, await outcome(exact), await outcome(measured), metrics,
      skips.reduce((sum, seconds) => sum + seconds, 0));
    expect(metrics.length, "the replay reported at least one island").toBeGreaterThan(0);
  }, SLOW_TIMEOUT);

  it("keeps a finite colony supply draw inside the accepted error and reports the fallback", async () => {
    const save = await colonyDrawSource();
    const start = await outcome(save);
    const exact = await advanceOfflineGame(structuredClone(save), FIXTURE_START + HOUR_MS, () => {},
      { exact: true, chronological: false });
    const metrics: OfflineIslandMetrics[] = [], skips: number[] = [];
    const measured = await advanceOfflineGame(structuredClone(save), FIXTURE_START + HOUR_MS, () => {}, {
      measured: true, chronological: false,
      onIslandMetrics: value => metrics.push(value), onSkip: seconds => skips.push(seconds)
    });
    const exactOutcome = await outcome(exact), measuredOutcome = await outcome(measured);
    // Owner 2026-11-09: a small provisional ore tolerance for this case (tighten later). A measured skip
    // may run just past the moment the colony stops drawing home fish; the post-jump check then falls
    // back to exact ticks, but the coal already mined in the skip stays (measured 737 vs exact 741).
    // Same bound as the goods E0 rule: five units or 6 % of the hour's change.
    const oreChange = Math.abs(start.islands.reduce((sum, island) => sum + island.ore, 0) -
      exactOutcome.islands.reduce((sum, island) => sum + island.ore, 0));
    report("colony draw", start, exactOutcome, measuredOutcome, metrics,
      skips.reduce((sum, seconds) => sum + seconds, 0), true, Math.max(5, Math.floor(.06 * oreChange)));
    // Sequential measured and exact use the same home-then-colony order; resume both with exact ticks.
    const resumeExact = (save: GameSaveV1) => advanceOfflineGame(structuredClone(save),
      FIXTURE_START + HOUR_MS + RESUME_MS, () => {}, { exact: true, chronological: false });
    const resumedExact = await outcome(await resumeExact(exact));
    const resumedMeasured = await outcome(await resumeExact(measured));
    equality("resume colony draw", resumedExact, resumedMeasured);
    for (const { error, ware, within } of errorReport("resume colony draw", resumedMeasured, resumedExact, resumedExact))
      expect(within, `colony draw resume: ${ware} off by ${error}`).toBe(true);
  }, SLOW_TIMEOUT);
});
