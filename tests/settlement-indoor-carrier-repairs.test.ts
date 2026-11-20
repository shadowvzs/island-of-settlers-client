import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { DOOR_EXIT_QUEUE_LIMIT } from "../src/shared/settlement/settlement-door-exit-queue";
import type { SettlementActor } from "../src/shared/settlement/settlement-types";
import { createCrowdScenario } from "../tools/bench/settlement-crowd-scenario";

const WOODCUTTER = 14;
const PLOTS = [[16, 12], [22, 12], [28, 12], [34, 12], [40, 12], [16, 36], [22, 36], [34, 36]] as const;

const OUTBOUND_PHASES = new Set(["exitLoaded", "pickup"]);

const isHqCarrier = (actor: SettlementActor, hq: number) => actor.job === "Carrier" && actor.home === hq;
const isQueuedAtHqDoor = (actor: SettlementActor, hq: number) =>
  isHqCarrier(actor, hq) && !actor.visible && actor.phase !== "inside";

/** Eight finished woodcutters with full output stock: the HQ sends a carrier burst through its one door. */
const runOutputBurst = () => {
  const { simulation } = createCrowdScenario(60);
  const [width, depth] = getBuildingDefinition(WOODCUTTER).gridFootprint;
  // Plots first: a road reserves its stone width and verges, so an earlier road would block a later plot.
  const woodcutters = PLOTS.map(([x, z]) => {
    const placed = simulation.placeBuilding(WOODCUTTER, x + width % 2 / 2, z + depth % 2 / 2);
    expect(placed.ok, placed.reason).toBe(true);
    return Object.assign(placed.building!, { construction: 1, input: {}, output: { logs: 8 }, required: {} });
  });
  for (const woodcutter of woodcutters)
    expect(simulation.connectRoads(simulation.headquarters.access, woodcutter.access)).toBe(true);
  const hq = simulation.headquarters.uid, wasVisible = new Map<number, boolean>();
  let indoor = 0, exits = 0;
  for (let tick = 0; tick < 3600; tick++) {
    simulation.update(.05);
    let waiting = 0;
    for (const actor of simulation.frames()) {
      if (!isHqCarrier(actor, hq)) continue;
      // An exit: a carrier that was indoors (or just recruited) now stands outside on its way out.
      if (actor.visible && wasVisible.get(actor.uid) !== true && OUTBOUND_PHASES.has(actor.phase)) exits++;
      wasVisible.set(actor.uid, actor.visible);
      if (isQueuedAtHqDoor(actor, hq)) waiting++;
    }
    indoor = Math.max(indoor, waiting);
  }
  return { exits, indoor, simulation };
};

/** Owner replay 2026-10-20: ~30 carriers queued inside the HQ door asked for ~500 path repairs a second. */
it("lets carriers queued indoors for the door wait without people-aware path repairs (LOG-02)", () => {
  const { indoor, simulation } = runOutputBurst();
  expect(indoor).toBeGreaterThan(0);
  // Before the fix: ~1,100 granted repair searches and ~20,000 deferred requests in these three minutes.
  expect(simulation.navigationDiagnostics().repairs.deferred).toBeLessThan(100);
  expect(simulation.navigationDiagnostics().repairs.grants).toBeLessThan(200);
}, 60000);

/** The same replay: carriers waited up to 98 s inside the HQ for the door (mean 50 s, now about 5 s). */
it("dispatches no more HQ carriers than its door lets out, keeping the door's throughput (LOG-02)", () => {
  const { exits, indoor } = runOutputBurst();
  // Before (at the BAL-01 walking speed): up to 50 carriers queued indoors and 47 left through the door in
  // these three minutes; now at most four wait and at least as many leave. Carriers now rarely wait indoors
  // (at most one on 2026-11-11), so every departure through the door counts (76 then).
  expect(indoor).toBeLessThanOrEqual(DOOR_EXIT_QUEUE_LIMIT);
  expect(exits).toBeGreaterThanOrEqual(47);
}, 60000);
