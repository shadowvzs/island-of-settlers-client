import { expect, it } from "vitest";

import { getWorkerPhaseText } from "../src/app/settlement-ui/building-details/helpers";
import type { SettlementBuildingSummary } from "../src/app/settlement-ui/types";
import type { WorkerPhaseSpec } from "../src/shared/settlement/worker-phase-spec";

const spec = (extra: Partial<WorkerPhaseSpec>): WorkerPhaseSpec => ({
  clock: "work", ownership: "none", phase: "work", rate: 1, rateApplies: true,
  talentShare: 0, levelShare: 0, materialScale: 1, wake: "timer", ...extra
});
const building = (workerPhase: WorkerPhaseSpec) => ({ id: "1", type: 35, workerPhase } as SettlementBuildingSummary);

it("shows the current phase, remaining fixed-clock time and effective rate", () => {
  expect(getWorkerPhaseText(building(spec({ authoredSeconds: 8, remainingSeconds: 6, rate: 2.2 }))))
    .toBe("Working · 6s left · 220% work rate");
  expect(getWorkerPhaseText(building(spec({ clock: "travel", phase: "outbound", rateApplies: false }))))
    .toBe("Walking");
  expect(getWorkerPhaseText(building(spec({ clock: "inactive", phase: "retired" })))).toBeNull();
});
