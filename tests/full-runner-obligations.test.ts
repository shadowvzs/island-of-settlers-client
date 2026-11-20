import { describe, expect, it } from "vitest";

import { aggregateCoverage, classifyLane, coverageExitCode } from "../tools/e2e/full/coverage-aggregation";
import {
  deriveObligations, EMPTY_REVIEW_LEDGER, type LaneContext, parseReviewLedger, type ReviewLedger
} from "../tools/e2e/full/obligation-outcomes";
import { type CoverageObligation,OBLIGATIONS } from "../tools/e2e/full/obligation-registry";
import { reconcileLane } from "../tools/e2e/full/reconcile";

const high: LaneContext = { lane: "quests", nation: "roman", quality: "high" };
const QUEST_CASES = ["E2E-12-tutorial-progress-claim", "E2E-12-daily-progress-claim", "E2E-12-claim-reload"];
const obligation = (id: string) => OBLIGATIONS.find(item => item.id === id)!;
const passing = (ids: readonly string[]) => ids.map(id => ({ id, outcome: "pass" as const }));
const reviewed = (ids: readonly string[], context: LaneContext): ReviewLedger => ({
  reviews: ids.map(caseId => ({ caseId, lane: context.lane, note: "Clip and state inspected",
    quality: context.quality, reviewer: "owner" }))
});
const derive = (id: string, cases: { id: string; outcome: "pass" | "fail" | "blocked" | "not-run" }[],
  ledger = EMPTY_REVIEW_LEDGER, context = high) => deriveObligations([obligation(id)], cases, context, ledger)[0]!;

describe("full runner obligation registry", () => {
  it("resolves templated case IDs from their source constants and the player's catalog", () => {
    const resolve = (id: string) => obligation(id).resolve("roman").cases;
    expect(resolve("E2E-03-tier-fixtures")).toContain("E2E-03-colony-pair-4");
    expect(resolve("E2E-05-six-tier-carts")).toEqual(["stone", "marble", "limestone", "basalt", "granite"]
      .map(tier => `E2E-05-road-tier-${tier}`));
    expect(resolve("E2E-08-recruitment-territory")).toContain("E2E-08-recruit-cavalry");
    expect(resolve("E2E-13-phase-conservation")).toContain("E2E-13-voyage-restore");
    expect(resolve("E2E-06-five-recipe-reload")).toEqual(expect.arrayContaining(
      ["E2E-06-type-33-mahoganyPlanks", "E2E-06-type-33-handcart", "E2E-06-upgrade-33", "E2E-06-upgrade-33-level-5"]));
    expect(obligation("E2E-06-all-modes").resolve(null).uncovered.join(" ")).toMatch(/nation unavailable/);
  });

  it("keeps every obligation either backed by cases or explicitly uncovered", () => {
    for (const item of OBLIGATIONS) {
      const { cases, uncovered } = item.resolve("roman");
      expect(cases.length + uncovered.length, item.id).toBeGreaterThan(0);
      expect(new Set(cases).size, item.id).toBe(cases.length);
    }
    expect(new Set(OBLIGATIONS.map(item => item.id)).size).toBe(OBLIGATIONS.length);
  });
});

describe("full runner obligation outcomes", () => {
  it("keeps an uncovered sub-requirement not-run although every case passed and was reviewed", () => {
    const ids = obligation("E2E-03-tier-fixtures").resolve("roman").cases;
    const result = derive("E2E-03-tier-fixtures", passing(ids), reviewed(ids, high));
    expect(result.outcome).toBe("not-run");
    expect(result.reason).toMatch(/historical legacy saves/i);
  });

  it("propagates failed and blocked required cases ahead of other gaps", () => {
    const [first, second] = QUEST_CASES;
    expect(derive("E2E-12-reward-progression", [{ id: first!, outcome: "fail" },
      { id: second!, outcome: "blocked" }]).outcome).toBe("fail");
    expect(derive("E2E-12-reward-progression", [{ id: second!, outcome: "blocked" }]).outcome).toBe("blocked");
    expect(derive("E2E-12-reward-progression", passing([first!, second!])).reason).toMatch(/not run: E2E-12-claim/);
  });

  it("leaves unreviewed or other-quality reviews awaiting review", () => {
    expect(derive("E2E-12-reward-progression", passing(QUEST_CASES)).reason).toMatch(/^Awaiting review/);
    const minimal = { ...high, quality: "minimal" };
    const result = derive("E2E-12-reward-progression", passing(QUEST_CASES), reviewed(QUEST_CASES, minimal));
    expect(result.outcome).toBe("not-run");
  });

  it("passes a fully covered obligation once every required case passed and was reviewed", () => {
    const result = derive("E2E-12-reward-progression", passing(QUEST_CASES), reviewed(QUEST_CASES, high));
    expect(result.outcome).toBe("pass");
  });

  it("replaces stored derived rows when reconciling a lane report", () => {
    const stored = { metadata: { lane: "quests", playerNation: "roman", quality: "high" },
      cases: [...passing(QUEST_CASES), { id: "E2E-12-reward-progression", outcome: "not-run" as const }] };
    const lane = reconcileLane(stored, reviewed(QUEST_CASES, high));
    const rows = lane.cases.filter(item => item.id === "E2E-12-reward-progression");
    expect(rows).toEqual([{ id: "E2E-12-reward-progression", outcome: "pass" }]);
    expect(lane.incomplete).toBe(true);
  });

  it("rejects malformed reviewer ledgers instead of treating them as empty", () => {
    expect(() => parseReviewLedger('{"reviews":[{"caseId":"x","lane":"quests"}]}')).toThrow(/review 0/);
    expect(parseReviewLedger('{"reviews":[]}').reviews).toEqual([]);
  });
});

describe("complete reviewed run", () => {
  const registry: CoverageObligation[] = Array.from({ length: 16 }, (_, index) => {
    const task = `E2E-${String(index + 1).padStart(2, "0")}`;
    return { id: `${task}-proof`, task, title: task, resolve: () => ({ cases: [`${task}-case`], uncovered: [] }) };
  });
  const executed = passing(registry.map(item => `${item.task}-case`));
  const lane = (quality: string, ledger: ReviewLedger) => {
    const context = { lane: "all", nation: "roman" as const, quality };
    const cases = [...executed, ...deriveObligations(registry, executed, context, ledger)];
    return { cases, lane: "all", quality, ...classifyLane(cases, false) };
  };
  const exitCode = (ledgers: Record<string, ReviewLedger>) => {
    const lanes = Object.entries(ledgers).map(([quality, ledger]) => lane(quality, ledger));
    const aggregate = aggregateCoverage(lanes, ["high", "minimal"], registry);
    const incomplete = lanes.filter(item => item.incomplete).length + Number(!aggregate.complete);
    return coverageExitCode(lanes.filter(item => item.failed).length, incomplete);
  };
  const review = (quality: string) => reviewed(executed.map(item => item.id), { lane: "all", nation: null, quality });

  it("exits 0 only when both qualities are fully reviewed", () => {
    expect(exitCode({ high: review("high"), minimal: review("minimal") })).toBe(0);
    expect(exitCode({ high: review("high"), minimal: EMPTY_REVIEW_LEDGER })).toBe(2);
    expect(exitCode({ high: review("high") })).toBe(2);
  });
});
