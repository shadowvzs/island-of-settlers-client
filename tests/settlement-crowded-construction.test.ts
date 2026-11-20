import { expect, it } from "vitest";

import type { SettlementActor } from "../src/shared/settlement/settlement-types";
import { createCrowdScenario } from "../tools/bench/settlement-crowd-scenario";

interface BuilderTrace { construct?: { x: number; z: number }; phase: string; spotPicks: number }

/** Builder calm: one spot per wall side (first pick + three side changes), never nudged while hammering. */
const traceBuilder = (traces: Map<number, BuilderTrace>, actor: SettlementActor) => {
  const trace = traces.get(actor.uid) ?? { phase: "", spotPicks: 0 };
  traces.set(actor.uid, trace);
  if (actor.phase === "builderWork" && trace.phase !== "builderWork") trace.spotPicks++;
  if (actor.phase !== "construct") trace.construct = undefined;
  else if (!trace.construct) trace.construct = { x: actor.x, z: actor.z };
  else expect(Math.hypot(actor.x - trace.construct.x, actor.z - trace.construct.z)).toBe(0);
  trace.phase = actor.phase;
};

it("finishes both heavily supplied yards without trapping couriers at storage", () => {
  const { simulation, sites } = createCrowdScenario(100);
  const builders = new Map<number, BuilderTrace>();
  let peak = 0;
  // BAL-01 carriers walk 30% slower: both yards finish at 462 s (331 s at the former 1.2 cells/s).
  // Shared storage routes make the same bench take longer than the old per-storage acceptance path;
  // 30,000 ticks (1,500 s) bounds it without changing the calm/courier invariants below.
  for (let tick = 0; tick < 30000; tick++) {
    simulation.update(.05);
    for (const actor of simulation.frames()) if (actor.job === "Builder") traceBuilder(builders, actor);
    for (const site of sites) {
      const couriers = simulation.frames().filter(actor => actor.job === "Carrier" &&
        actor.building === site.uid && actor.phase !== "inside" && actor.phase !== "retired").length;
      peak = Math.max(peak, couriers);
    }
  }
  expect(peak).toBeLessThanOrEqual(16);
  expect(sites.every(site => site.construction === 1)).toBe(true);
  expect(builders.size).toBe(2);
  for (const trace of builders.values()) expect(trace.spotPicks).toBeLessThanOrEqual(4);
  expect(simulation.navigationDiagnostics().actors.some(actor => actor.blocked)).toBe(false);
  expect(simulation.loadState(simulation.saveState()).ok).toBe(true);
}, 45000);
