import { describe, expect, it } from "vitest";

import {
  auditEventCoreCoverage, EVENT_CORE_LANE_PHASES, type EventCoreActorLane
} from "../src/shared/settlement/event-core/coverage";

const lanes = new Set(Object.keys(EVENT_CORE_LANE_PHASES) as EventCoreActorLane[]);
const owned = (entries: Partial<Record<EventCoreActorLane, number[]>>, fields: number[] = []) => ({
  fields: new Set(fields),
  lanes: Object.fromEntries(Object.entries(entries).map(([lane, uids]) =>
    [lane, new Set(uids)])) as Partial<Record<EventCoreActorLane, Set<number>>>,
  population: true,
  stone: true,
  tree: true
});

const actor = (uid: number, phase: string, extra: Record<string, unknown> = {}) =>
  ({ uid, job: "Settler", phase, timer: 1, path: [], pathIndex: 0, ...extra });

describe("event-core coverage audit", () => {
  it("accepts a base-rate worker whose timer has a scheduled event", () => {
    const eligible = { work: new Set([1]) };
    const report = auditEventCoreCoverage({ actors: [actor(1, "work")], eligible,
      fields: [], maskedLanes: lanes, owned: owned({ work: [1] }) });
    expect(report.covered).toBe(true);
    expect(report.reasons).toEqual([]);
  });

  it("reports a masked phase whose event is missing", () => {
    const report = auditEventCoreCoverage({ actors: [actor(1, "work")],
      eligible: { work: new Set([1]) }, fields: [], maskedLanes: lanes, owned: owned({}) });
    expect(report.covered).toBe(false);
    expect(report.reasons).toContain("masked-phase-without-event:work");
  });

  it("leaves an accelerated worker on the fixed lane without failing coverage", () => {
    const report = auditEventCoreCoverage({ actors: [actor(1, "work")], eligible: {},
      fields: [], maskedLanes: lanes, owned: owned({}) });
    expect(report.covered).toBe(true);
  });

  it("reports an unsupported phase instead of guessing", () => {
    const report = auditEventCoreCoverage({ actors: [actor(1, "futureMechanic")], eligible: {},
      fields: [], maskedLanes: lanes, owned: owned({}) });
    expect(report.covered).toBe(false);
    expect(report.reasons).toContain("unknown-phase:futureMechanic");
  });

  it("reports a maturing field without a scheduled event", () => {
    const report = auditEventCoreCoverage({ actors: [], fields: [{ id: 7, state: "growing" }],
      maskedLanes: lanes, owned: owned({}) });
    expect(report.covered).toBe(false);
    expect(report.reasons).toContain("masked-field-without-event");
  });

  it("detects but does not fail on fixed-lane carriers, handling, ships and expeditions", () => {
    const report = auditEventCoreCoverage({
      actors: [
        actor(1, "deliver", { job: "Carrier" }),
        actor(2, "outputPutdown", { wareTransfer: { progress: .5 } }),
        actor(3, "militaryField", { job: "Soldier" })
      ],
      fields: [], maskedLanes: lanes, owned: owned({}),
      systems: { adventure: true, colony: true, ships: 2, soldiers: 1, tradeOffers: 1 }
    });
    expect(report.covered).toBe(true);
    expect(report.fixedLane.carriers).toBe(1);
    expect(report.fixedLane.handling).toBe(1);
    expect(report.fixedLane.combat).toBe(1);
    expect(report.fixedLane.ships).toBe(2);
    expect(report.fixedLane.systems.colony).toBe(true);
  });
});
