import { afterEach, describe, expect, it } from "vitest";

import {
  createTickPhaseTotals, endTickPhases, groupTickPhases, markTickPhase, setTickPhaseRecorder
} from "../src/shared/settlement/tick-phase-profile";

afterEach(() => setTickPhaseRecorder(null));

describe("tick-phase attribution", () => {
  it("does nothing without a recorder", () => {
    expect(() => { markTickPhase("military"); endTickPhases(); }).not.toThrow();
  });

  it("closes each phase at the next mark and the tick end", () => {
    let clock = 0;
    const totals = createTickPhaseTotals(() => clock);
    setTickPhaseRecorder(totals.recorder);
    markTickPhase("military"); clock += 1;
    markTickPhase("military.combat"); clock += 3;
    markTickPhase("actor", "Carrier"); clock += 2;
    markTickPhase("actor", "Carrier"); clock += 4;
    markTickPhase("actor", "Soldier"); clock += 1;
    endTickPhases();
    const report = totals.report();
    expect(report.ticks).toBe(1);
    expect(report.totalMs).toBe(11);
    expect(report.phases["actor:Carrier"]).toEqual({ calls: 2, maxMs: 4, totalMs: 6 });
    const groups = groupTickPhases(groupTickPhases(report.phases, ":"), ".");
    expect(groups.military).toEqual({ calls: 2, maxMs: 3, totalMs: 4 });
    expect(groups.actor).toEqual({ calls: 3, maxMs: 4, totalMs: 7 });
  });

  it("starts empty again after a reset", () => {
    let clock = 0;
    const totals = createTickPhaseTotals(() => clock);
    setTickPhaseRecorder(totals.recorder);
    markTickPhase("naval"); clock += 5; endTickPhases();
    totals.reset();
    expect(totals.report()).toEqual({ phases: {}, ticks: 0, totalMs: 0 });
  });
});
