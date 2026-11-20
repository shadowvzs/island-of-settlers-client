import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { laneContext } from "./coverage";
import { aggregateCoverage, classifyLane, coverageExitCode } from "./coverage-aggregation";
import { deriveObligations, readReviewLedger, REVIEW_LEDGER_FILE, type ReviewLedger } from "./obligation-outcomes";
import { COVERAGE_REQUIREMENTS, OBLIGATIONS } from "./obligation-registry";
import { QUALITIES } from "./options";
import type { CaseResult } from "./report";

/** Written beside the run's own coverage.json, which stays the unreviewed live result. */
export const RECONCILED_COVERAGE_FILE = "reviewed-coverage.json";
const OBLIGATION_IDS = new Set(OBLIGATIONS.map(obligation => obligation.id));

export interface StoredLaneReport {
  cases: Pick<CaseResult, "id" | "outcome">[];
  metadata: Record<string, unknown>;
}
interface StoredRun {
  options: { lanes: string[]; qualities: string[] };
}

const readJson = async <T>(path: string) => JSON.parse(await readFile(path, "utf8")) as T;

const readLaneReport = async (directory: string, quality: string, lane: string) => {
  try {
    return await readJson<StoredLaneReport>(join(directory, `${quality}-${lane}`, "report.json"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
};

/** Re-derives a stored lane's obligations from its executed cases; earlier derived rows are discarded. */
export const reconcileLane = (report: StoredLaneReport, ledger: ReviewLedger) => {
  const executed = report.cases.filter(item => !OBLIGATION_IDS.has(item.id));
  const context = laneContext(report.metadata);
  const obligations = deriveObligations(OBLIGATIONS, executed, context, ledger);
  const cases = [...executed, ...obligations].map(({ id, outcome }) => ({ id, outcome }));
  return { ...context, cases, executed, obligations, ...classifyLane(cases, Boolean(report.metadata.aborted)) };
};
type ReconciledLane = ReturnType<typeof reconcileLane>;

const missingLane = (lane: string, quality: string): ReconciledLane => ({
  cases: [], executed: [], failed: false, incomplete: true, lane, nation: null, obligations: [], quality
});

const unmatchedReviews = (ledger: ReviewLedger, lanes: readonly ReconciledLane[]) =>
  ledger.reviews.filter(review => !lanes.some(lane => lane.lane === review.lane &&
    lane.quality === review.quality && lane.executed.some(item => item.id === review.caseId)));

/** Summarises reconciled lanes against both acceptance qualities and returns the run exit code. */
export const summariseReconciliation = (lanes: readonly ReconciledLane[], ledger: ReviewLedger) => {
  const aggregate = aggregateCoverage(lanes, QUALITIES, COVERAGE_REQUIREMENTS);
  const failures = lanes.filter(lane => lane.failed).length;
  const incomplete = lanes.filter(lane => lane.incomplete).length + Number(!aggregate.complete);
  return { aggregate, exitCode: coverageExitCode(failures, incomplete), unmatched: unmatchedReviews(ledger, lanes) };
};

/** Browser-free review pass over an existing run directory; never edits the recorded lane reports. */
export const reconcileRun = async (directory: string) => {
  const run = await readJson<StoredRun>(join(directory, "run.json"));
  const ledger = await readReviewLedger(join(directory, REVIEW_LEDGER_FILE));
  const lanes: ReconciledLane[] = [];
  for (const quality of run.options.qualities) for (const lane of run.options.lanes) {
    const report = await readLaneReport(directory, quality, lane);
    lanes.push(report ? reconcileLane(report, ledger) : missingLane(lane, quality));
  }
  const summary = summariseReconciliation(lanes, ledger);
  await writeFile(join(directory, RECONCILED_COVERAGE_FILE), JSON.stringify({
    reconciledAt: new Date().toISOString(), ledger, unmatchedReviews: summary.unmatched, exitCode: summary.exitCode,
    lanes: lanes.map(({ failed, incomplete, lane, obligations, quality }) => ({
      failed, incomplete, lane, obligations, quality
    })),
    aggregate: summary.aggregate
  }, null, 2));
  console.log(`Reviewed coverage: ${join(directory, RECONCILED_COVERAGE_FILE)} (exit ${summary.exitCode})`);
  return summary.exitCode;
};
