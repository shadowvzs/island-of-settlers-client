import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { isWorkerNation } from "../../../src/render-common/workers/worker-appearance";
import type { WorkerNation } from "../../../src/render-common/workers/worker-unit";
import { createAcceptanceManifest, productionModeCaseId, productionUpgradeCaseId } from "./acceptance-manifest";
import {
  deriveObligations, EMPTY_REVIEW_LEDGER, type LaneContext, type ObligationResult
} from "./obligation-outcomes";
import { OBLIGATIONS } from "./obligation-registry";
import { progressionRequirements } from "./progression-manifest";
import type { CaseResult, FullReport } from "./report";

type UpgradeEvidence = { upgradedProduction?: { mode?: string } } | undefined;

export const laneContext = (metadata: Record<string, unknown>): LaneContext => ({
  lane: String(metadata.lane),
  nation: isWorkerNation(metadata.playerNation) ? metadata.playerNation : null,
  quality: String(metadata.quality)
});

const caseOutcome = (cases: readonly CaseResult[], caseId: string) =>
  cases.find(item => item.id === caseId)?.outcome ?? "not-run";

const belongsToTask = (caseId: string, taskId: string) => caseId.startsWith(taskId) ||
  (taskId === "E2E-10" && caseId.startsWith("E2E-adventure-")) ||
  (taskId === "E2E-11" && caseId.startsWith("E2E-colony-"));

const taskCoverage = (obligations: readonly ObligationResult[], cases: readonly CaseResult[]) =>
  Array.from({ length: 16 }, (_, index) => {
    const id = `E2E-${String(index + 1).padStart(2, "0")}`;
    const required = obligations.filter(obligation => obligation.task === id);
    return {
      id,
      complete: required.length > 0 && required.every(obligation => obligation.outcome === "pass"),
      obligations: required,
      cases: cases.filter(item => belongsToTask(item.id, id)).map(({ id, outcome }) => ({ id, outcome }))
    };
  });

const catalogCoverage = (cases: readonly CaseResult[], nation: WorkerNation) =>
  createAcceptanceManifest(nation).buildings.map(building => {
    const upgradeCase = productionUpgradeCaseId(building.id, { displayedLevel: 2, offset: 1 });
    const upgrades = building.upgrade?.steps.map(step => {
      const caseId = productionUpgradeCaseId(building.id, step);
      const evidence = cases.find(item => item.id === caseId)?.evidence as UpgradeEvidence;
      return { ...step, caseId, outcome: caseOutcome(cases, caseId), mode: evidence?.upgradedProduction?.mode };
    }) ?? [];
    return { ...building,
      modes: building.modes.map(mode => {
        const caseId = productionModeCaseId(building.id, mode);
        return { name: mode, caseId, outcome: caseOutcome(cases, caseId),
          upgradedOutcome: upgrades.find(step => step.mode === mode)?.outcome ?? "not-run" };
      }),
      upgrades,
      upgradeCase: building.upgrade ? upgradeCase : null,
      upgradeOutcome: building.upgrade ? caseOutcome(cases, upgradeCase) : "not-applicable"
    };
  });

/**
 * Derives every explicit obligation from this lane's real outcomes and records it in the lane report.
 * Evidence produced by this run is necessarily unreviewed; `--reconcile` applies a reviewer ledger later.
 */
export const writeCoverage = async (report: FullReport) => {
  const context = laneContext(report.metadata);
  const executed = [...report.cases];
  const obligations = deriveObligations(OBLIGATIONS, report.cases, context, EMPTY_REVIEW_LEDGER);
  for (const { cases, id, outcome, reason, title, uncovered } of obligations)
    report.record(id, title, outcome, { reason, cases, uncovered });
  const coverage = {
    progressionRequirements: progressionRequirements(),
    playerNation: context.nation,
    nationEvidence: context.nation ? "Read from the initialized/restored live simulation" :
      "Unavailable; catalog omitted rather than assuming Roman",
    policy: "Obligations pass only when every registered case passed and was reviewed, with no uncovered " +
      "sub-requirement. Narrow observation cases never replace an obligation.",
    tasks: taskCoverage(obligations, executed),
    catalog: context.nation ? catalogCoverage(executed, context.nation) : [],
    findings: executed.filter(item => item.outcome === "fail").map(item => ({
      case: item.id, evidence: item.state ?? item.screenshot, severity: "needs-triage", confirmedGameBug: false,
      details: item.error
    })),
    usabilityIdeas: [],
    notes: "Unreviewed failures may be environment, driver or fixture defects. " +
      "Confirm reproduction before labelling a game bug."
  };
  await writeFile(join(report.directory, "coverage.json"), JSON.stringify(coverage, null, 2));
  await report.save();
};
