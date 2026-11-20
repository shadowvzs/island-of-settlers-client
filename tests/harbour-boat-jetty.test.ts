import { describe, expect, it } from "vitest";

import { findBoatJetty } from "../src/shared/settlement/harbour-boat-jetty";
import { createBoatRoutePlanner } from "../src/shared/settlement/harbour-boat-route";
import { createShipSea } from "./helpers/ship-motion-scenarios";

describe("jetty shore approach searches", () => {
  for (const reachable of [true, false]) it(`searches each shore foot once per validation, reachable=${reachable}`, () => {
    const { context, harbour, sea, world } = createShipSea();
    const building = harbour(40), planner = createBoatRoutePlanner(world, sea);
    const calls = new Map<string, number>();
    context.options.findWorkerPath = (_from, to) => {
      const key = `${to.x},${to.z}`;
      calls.set(key, (calls.get(key) ?? 0) + 1);
      return reachable ? [{ ...to }] : null;
    };
    const first = findBoatJetty(context, building, planner, []);
    expect(Boolean(first)).toBe(reachable);
    expect(calls.size).toBeGreaterThan(0);
    expect([...calls.values()].every(count => count === 1)).toBe(true);
    // A later navigation change must search afresh; this is not a persistent path cache.
    context.navigationRevision = (context.navigationRevision ?? 0) + 1;
    const second = findBoatJetty(context, building, planner, []);
    expect(second).toEqual(first);
    expect([...calls.values()].every(count => count === 2)).toBe(true);
  });
});
