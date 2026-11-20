import { describe, expect, it } from "vitest";

import { aggregateCoverage } from "../tools/e2e/full/coverage-aggregation";

const requirements = Array.from({ length: 16 }, (_, index) => {
  const task = `E2E-${String(index + 1).padStart(2, "0")}`;
  return { id: `${task}-full-proof`, task };
});
const cases = requirements.map(({ id }) => ({ id, outcome: "pass" as const }));

describe("full runner obligation aggregation", () => {
  it("requires explicit proof in both requested qualities, not a narrow passing case", () => {
    const partial = aggregateCoverage([
      { lane: "natural", quality: "high", cases },
      { lane: "natural", quality: "minimal", cases: [{ id: "E2E-04-well", outcome: "pass" }] }
    ], ["high", "minimal"], requirements);
    expect(partial.complete).toBe(false);
    expect(partial.tasks.every(task => !task.complete)).toBe(true);
    const full = aggregateCoverage([
      { lane: "natural", quality: "high", cases },
      { lane: "natural", quality: "minimal", cases }
    ], ["high", "minimal"], requirements);
    expect(full.complete).toBe(true);
  });

  it("keeps failed or blocked evidence visible despite another passing attempt", () => {
    const result = aggregateCoverage([
      { lane: "a", quality: "high", cases },
      { lane: "b", quality: "high", cases: [{ id: requirements[0]!.id, outcome: "fail" },
        { id: requirements[1]!.id, outcome: "blocked" }] }
    ], ["high"], requirements);
    expect(result.tasks[0]!.obligations[0]!.qualities[0]!.outcome).toBe("fail");
    expect(result.tasks[1]!.obligations[0]!.qualities[0]!.outcome).toBe("blocked");
    expect(result.complete).toBe(false);
  });
});
