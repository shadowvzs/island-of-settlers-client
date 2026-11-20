import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import type { SettlementActor } from "../src/shared/settlement/settlement-types";
import { createCrowdScenario } from "../tools/bench/settlement-crowd-scenario";

/** Save 2026-10-20 (1), building 11: a mill whose flour carriers met head-on at its court entry. */
const MILL = 31;

const isMillEntrant = (actor: SettlementActor, mill: number) =>
  actor.visible && actor.stockBuilding === mill && ["deliveryStockWalk", "pickupStockWalk"].includes(actor.phase);

it("lets carriers meeting at a stock-court entry wait in turn instead of hopping shoulders (LOG-02)", () => {
  const { simulation } = createCrowdScenario(60);
  const [width, depth] = getBuildingDefinition(MILL).gridFootprint;
  const placed = simulation.placeBuilding(MILL, 40 + width % 2 / 2, 34 + depth % 2 / 2);
  expect(placed.ok, placed.reason).toBe(true);
  const mill = placed.building!;
  Object.assign(mill, { construction: 1, input: {}, output: { flour: 6 }, required: {} });
  expect(simulation.connectRoads(simulation.headquarters.access, mill.access)).toBe(true);
  simulation.headquarters.inventory.grain = 12;
  const hops = new Map<number, number>(), aimed = new Map<number, boolean>();
  let entrants = 0;
  for (let tick = 0; tick < 6000 && (mill.output.flour ?? 0) > 0; tick++) {
    simulation.update(.05);
    const waiting = simulation.frames().filter(actor => isMillEntrant(actor, mill.uid));
    entrants = Math.max(entrants, waiting.length);
    for (const actor of waiting) {
      const sidestep = Boolean(actor.queueTarget);
      if (sidestep && !aimed.get(actor.uid)) hops.set(actor.uid, (hops.get(actor.uid) ?? 0) + 1);
      aimed.set(actor.uid, sidestep);
    }
  }
  expect(mill.output.flour ?? 0).toBeLessThan(6);
  expect(entrants).toBeGreaterThan(1);
  // Before: a queued entrant without a free slot hopped to a new shoulder after every pause (up to 45 times).
  // What remains (7 on 2026-11-11) is clearing the court owner's way in or out, which a waiter must do.
  expect(Math.max(0, ...hops.values())).toBeLessThanOrEqual(8);
}, 60000);
