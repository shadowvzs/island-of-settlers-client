import { readFile } from "node:fs/promises";

import type { WorkerNation } from "../../../src/render-common/workers/worker-unit";
import type { CoverageObligation } from "./obligation-registry";
import type { CaseResult, Outcome } from "./report";

/** Written by a human reviewer into the run directory after inspecting each case's artifacts. */
export const REVIEW_LEDGER_FILE = "reviewed-evidence.json";
export interface EvidenceReview {
  caseId: string;
  lane: string;
  note: string;
  quality: string;
  reviewer: string;
}
export interface ReviewLedger {
  reviews: readonly EvidenceReview[];
}
export interface LaneContext {
  lane: string;
  nation: WorkerNation | null;
  quality: string;
}
export interface ObligationResult {
  cases: { id: string; outcome: Outcome; reviewed: boolean }[];
  id: string;
  outcome: Outcome;
  reason: string;
  task: string;
  title: string;
  uncovered: readonly string[];
}
type CaseOutcome = Pick<CaseResult, "id" | "outcome">;

/** Evidence produced by the current run cannot have been reviewed before it existed. */
export const EMPTY_REVIEW_LEDGER: ReviewLedger = { reviews: [] };
const REVIEW_FIELDS = ["caseId", "lane", "note", "quality", "reviewer"] as const;

const isReview = (value: unknown): value is EvidenceReview => {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return REVIEW_FIELDS.every(field => typeof record[field] === "string" && record[field].trim() !== "");
};

export const parseReviewLedger = (text: string): ReviewLedger => {
  const parsed = JSON.parse(text) as { reviews?: unknown };
  if (!Array.isArray(parsed.reviews)) throw new Error(`${REVIEW_LEDGER_FILE} needs a "reviews" array`);
  const invalid = parsed.reviews.findIndex(entry => !isReview(entry));
  if (invalid >= 0)
    throw new Error(`${REVIEW_LEDGER_FILE} review ${invalid} needs non-empty ${REVIEW_FIELDS.join(", ")}`);
  return { reviews: parsed.reviews as EvidenceReview[] };
};

/** A missing ledger means nothing has been reviewed; a malformed one is an error, never silently empty. */
export const readReviewLedger = async (path: string) => {
  try {
    return parseReviewLedger(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return EMPTY_REVIEW_LEDGER;
    throw error;
  }
};

const isReviewed = (ledger: ReviewLedger, context: LaneContext, caseId: string) =>
  ledger.reviews.some(review => review.caseId === caseId && review.lane === context.lane &&
    review.quality === context.quality);

const caseIdsWith = (cases: ObligationResult["cases"], outcome: Outcome) =>
  cases.filter(item => item.outcome === outcome).map(item => item.id).join(", ");

const notRunReason = (cases: ObligationResult["cases"], uncovered: readonly string[]) => {
  const missing = caseIdsWith(cases, "not-run");
  const parts = [missing && `Required cases not run: ${missing}`,
    uncovered.length > 0 && `Uncovered: ${uncovered.join("; ")}`];
  return parts.filter(Boolean).join(". ");
};

/** Precedence: fail, blocked, missing/uncovered, awaiting review, pass. */
const decide = (cases: ObligationResult["cases"], uncovered: readonly string[]) => {
  if (cases.some(item => item.outcome === "fail"))
    return { outcome: "fail" as const, reason: `Required cases failed: ${caseIdsWith(cases, "fail")}` };
  if (cases.some(item => item.outcome === "blocked"))
    return { outcome: "blocked" as const, reason: `Required cases blocked: ${caseIdsWith(cases, "blocked")}` };
  if (!cases.length && !uncovered.length)
    return { outcome: "not-run" as const, reason: "Registry lists no required cases" };
  if (cases.some(item => item.outcome === "not-run") || uncovered.length)
    return { outcome: "not-run" as const, reason: notRunReason(cases, uncovered) };
  const unreviewed = cases.filter(item => !item.reviewed).map(item => item.id).join(", ");
  if (unreviewed) return { outcome: "not-run" as const, reason: `Awaiting review: ${unreviewed}` };
  return { outcome: "pass" as const, reason: `All ${cases.length} required cases passed and were reviewed` };
};

/** Derives each obligation from this lane's real case outcomes and the explicit review ledger only. */
export const deriveObligations = (
  obligations: readonly CoverageObligation[],
  cases: readonly CaseOutcome[],
  context: LaneContext,
  ledger: ReviewLedger
): ObligationResult[] => obligations.map(obligation => {
  const requirements = obligation.resolve(context.nation);
  const required = requirements.cases.map(id => ({
    id,
    outcome: cases.find(item => item.id === id)?.outcome ?? "not-run",
    reviewed: isReviewed(ledger, context, id)
  }));
  const { outcome, reason } = decide(required, requirements.uncovered);
  return { cases: required, id: obligation.id, outcome, reason, task: obligation.task, title: obligation.title,
    uncovered: requirements.uncovered };
});
