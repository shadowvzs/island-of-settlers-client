import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { CaseResult } from "./report";

export interface LaneEvidence {
  cases: Pick<CaseResult, "id" | "outcome">[];
  lane: string;
  quality: string;
}

/** Coverage merges evidence only; repeated failed/blocked attempts are never hidden by a later pass. */
export const aggregateCoverage = (
  lanes: readonly LaneEvidence[],
  qualities: readonly string[],
  requirements: readonly { id: string; task: string }[]
) => {
  const obligations = requirements.map((requirement) => ({
    ...requirement,
    qualities: qualities.map((quality) => {
      const evidence = lanes
        .filter((lane) => lane.quality === quality)
        .flatMap((lane) =>
          lane.cases
            .filter((item) => item.id === requirement.id)
            .map((item) => ({ lane: lane.lane, ...item }))
        );
      const attempts = evidence.filter((item) => item.outcome !== "not-run");
      let outcome = "not-run";
      if (attempts.some((item) => item.outcome === "fail")) outcome = "fail";
      else if (attempts.some((item) => item.outcome === "blocked")) outcome = "blocked";
      else if (attempts.length && attempts.every((item) => item.outcome === "pass"))
        outcome = "pass";
      return { quality, outcome, evidence };
    })
  }));
  const tasks = Array.from({ length: 16 }, (_, index) => {
    const id = `E2E-${String(index + 1).padStart(2, "0")}`;
    const required = obligations.filter((item) => item.task === id);
    return {
      id,
      complete:
        required.length > 0 &&
        required.every((item) => item.qualities.every((result) => result.outcome === "pass")),
      obligations: required
    };
  });
  return {
    complete: tasks.every((task) => task.complete),
    tasks,
    policy:
      "Every explicit obligation must pass in every requested quality. Narrow observation cases cannot replace it."
  };
};

export const writeAggregateCoverage = async (
  directory: string,
  lanes: readonly LaneEvidence[],
  qualities: readonly string[],
  requirements: readonly { id: string; task: string }[]
) => {
  const aggregate = aggregateCoverage(lanes, qualities, requirements);
  await writeFile(join(directory, "coverage.json"), JSON.stringify(aggregate, null, 2));
  return aggregate;
};

/** Lane status mirrors the case matrix: any failure fails it; any blocked/not-run row leaves it incomplete. */
export const classifyLane = (cases: readonly Pick<CaseResult, "outcome">[], aborted: boolean) => ({
  failed: aborted || cases.some((item) => item.outcome === "fail"),
  incomplete: cases.some((item) => item.outcome === "blocked" || item.outcome === "not-run")
});

/** 1 = failed/aborted evidence, 2 = blocked/not-run/unreviewed obligations remain, 0 = complete reviewed pass. */
export const coverageExitCode = (failures: number, incomplete: number) => {
  if (failures) return 1;
  if (incomplete) return 2;
  return 0;
};
