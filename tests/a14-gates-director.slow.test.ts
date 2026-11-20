import { describe, expect, it } from "vitest";

import { withBalanceDifficulty } from "../tools/bench/garrison-balance-harness";
import { runA14Fixture } from "../tools/bench/military-a14-metrics";
import { A14_FIXTURES } from "../tools/bench/military-a14-scenarios";
import { a14Medians, a14Off, a14Run, STUCK_FLOOR_SECONDS } from "./helpers/a14-fixtures";

/**
 * A14-0 phase, A14-4 director/knowledge/contract gates and the stagger (plan §9, §10.1, §11). Lane gates run
 * once the lane is in `A14_LANES_ON`. Phase budgets read `aiPhases`, empty on master.
 */
const TACTICAL_P95_MS = .6;
/** Plan §9: director decision tick p95 (desktop). */
const DIRECTOR_P95_MS = .3;

describe("A14-4 director, knowledge and stagger", () => {
  it("4-faction stagger: no two computer factions decide in the same tick", () => {
    const metrics = a14Run("stagger4");
    expect(Object.values(metrics.rounds).every(rounds => rounds > 0)).toBe(true);
    expect(metrics.maxFactionsPerTick).toBe(1);
  }, 120_000);

  it("unseen archer: the computer reads no unseen archer", () => {
    const metrics = a14Run("unseenArcher");
    expect(metrics.probeReads).toBeGreaterThan(0);
    expect(metrics.probeUnseenReads).toBe(0);
  }, 120_000);

  it.skipIf(a14Off("A14-0"))("the AI commander's tick phase is measured", () => {
    expect(Object.keys(a14Run("field64").aiPhases).length).toBeGreaterThan(0);
  }, 120_000);

  it.skipIf(a14Off("A14-4a"))("4-faction stagger: each AI phase's tick p95 stays within 0.6 ms (quiet machine)", () => {
    // The decision phases only (plan §9 budget: commander, director, morale). Their `.march` sub-phases are the
    // order layer's flow fields (A14-0 split them out), the same marches master orders, so they are reported apart.
    const phases = Object.entries(a14Run("stagger4").aiPhases).filter(([phase]) => !phase.includes("."));
    expect(phases.map(([phase]) => phase)).toEqual(["commander", "director", "morale"]);
    for (const [, stats] of phases) expect(stats.p95).toBeLessThanOrEqual(TACTICAL_P95_MS);
  }, 120_000);

  it.skipIf(a14Off("A14-4a"))("4-faction stagger: one director decision per tick, every wave force decides", () => {
    const metrics = a14Run("stagger4");
    expect(metrics.maxDirectorDecisionsPerTick).toBe(1);
    expect(Object.keys(metrics.directorMacros)).toEqual(["1:1", "2:1", "3:1", "4:1"]);
    expect(metrics.aiPhases.director?.p95 ?? 0).toBeLessThanOrEqual(DIRECTOR_P95_MS);
  }, 120_000);

  it.skipIf(a14Off("A14-4a"))("fog raid: the first permit becomes scout; a strike only after a site is known", () => {
    const metrics = a14Run("fogRaid");
    expect(metrics.pendingHooks).not.toContain("A14-4a:director");
    expect(metrics.directorMacros["1:1"]?.startsWith("scout")).toBe(true);
    expect(metrics.directorMacros["1:1"]).toContain("strike");
    expect(metrics.strikesWithoutKnownSite).toBe(0);
    expect(metrics.probeUnseenReads).toBe(0);
  }, 120_000);

  it.skipIf(a14Off("A14-4b"))("fog raid: a strike starts only after a player site is known; probe stays at 0", () => {
    const metrics = a14Run("fogRaid");
    expect(metrics.pendingHooks).not.toContain("A14-4b:knownSites");
    expect(metrics.probeUnseenReads).toBe(0);
  }, 120_000);

  it.skipIf(a14Off("A14-4c"))("intent contract: an unknown target is rejected and scouted, attacked after discovery", () => {
    const metrics = a14Run("intentContract");
    expect(metrics.pendingHooks).not.toContain("A14-4c:intentContract");
    expect(metrics.directorMacros["1:1"]?.startsWith("scout")).toBe(true);
    expect(metrics.directorMacros["1:1"]).toContain("strike");
    expect(metrics.strikesWithoutKnownSite).toBe(0);
    expect(metrics.probeUnseenReads).toBe(0);
  }, 120_000);

  it.skipIf(a14Off("A14-5"))("defend post: holds until a known enemy stands in its area, then defends", () => {
    const metrics = a14Run("defendPost");
    expect(metrics.directorMacros["1:1"]?.startsWith("hold>defend")).toBe(true);
    expect(metrics.directorMacros["1:1"]).not.toMatch(/strike|raid|scout/);
    expect(metrics.strikesWithoutKnownSite).toBe(0);
    expect(metrics.probeUnseenReads).toBe(0);
    expect(a14Medians("defendPost").stuckSeconds).toBeLessThanOrEqual(STUCK_FLOOR_SECONDS);
  }, 300_000);

  it.skipIf(a14Off("A14-5"))("site raid: a known site is raided at once, then the party withdraws", () => {
    const metrics = a14Run("siteRaid");
    expect(metrics.directorMacros).toEqual({ "1:1": "raid>withdraw" });
    expect(metrics.strikesWithoutKnownSite).toBe(0);
    expect(metrics.probeUnseenReads).toBe(0);
    expect(a14Medians("siteRaid").stuckSeconds).toBeLessThanOrEqual(STUCK_FLOOR_SECONDS);
  }, 300_000);

  it.skipIf(a14Off("A14-5")).each(["hard", "veryHard"] as const)(
    "4-faction stagger at the global %s difficulty: still one decision per layer and tick, no unseen read",
    difficulty => {
      const metrics = withBalanceDifficulty(difficulty, () => runA14Fixture(A14_FIXTURES.stagger4()));
      expect(metrics.maxFactionsPerTick).toBe(1);
      expect(metrics.maxDirectorDecisionsPerTick).toBe(1);
      expect(metrics.probeUnseenReads).toBe(0);
      // Hard decides 1.5 times (Very hard twice) as often as medium (plan §7).
      expect(metrics.directorDecisions).toBeGreaterThan(a14Run("stagger4").directorDecisions);
    }, 300_000);

  it.skipIf(a14Off("A14-1"))("unseen archer: the alert reaction reads only what the alert reveals", () => {
    // Exposure +1 on a place under alerted fire (§6) is covered by tests/commander-role-positions.test.ts: on flat
    // ground the fixture's archers stand inside sight, so here only the probe gate applies to the new read site.
    const metrics = a14Run("unseenArcher");
    expect(metrics.pendingHooks).toEqual([]);
    expect(metrics.probeUnseenReads).toBe(0);
  }, 120_000);
});
