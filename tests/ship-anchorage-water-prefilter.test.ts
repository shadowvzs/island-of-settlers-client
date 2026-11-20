import { expect, it } from "vitest";

import { findShipAnchorage } from "../src/shared/settlement/settlement-ship-anchorage";
import { createShipOverlapTest, type ShipObstacle } from "../src/shared/settlement/settlement-ship-clearance";

it("rejects impossible water before lane SAT without changing ring choice or the four-route budget", () => {
  const berth = { x: 16, z: 16 };
  const approaches = [{ from: berth, path: [{ x: 16, z: 64 }] }];
  const water = (point: ShipObstacle) => point.x > 24 && point.z > 24;
  const run = (early: boolean, overflow: boolean, succeeds: boolean) => {
    const attempts: ShipObstacle[] = [], overlap = createShipOverlapTest();
    let checks = 0, tries = 0;
    const reachable = (point: ShipObstacle) => {
      if (tries++ >= 4) return false;
      attempts.push({ ...point });
      return succeeds && attempts.length === 3;
    };
    const selected = findShipAnchorage([berth], approaches, [], {
      overlaps: (a, b) => { checks++; return overlap(a, b); },
      usable: point => early ? reachable(point) : water(point) && reachable(point),
      waterClear: early ? water : undefined
    }, berth, overflow);
    return { attempts, checks, selected, tries };
  };
  let originalChecks = 0, filteredChecks = 0;
  for (const overflow of [false, true]) for (const succeeds of [false, true]) {
    const reference = run(false, overflow, succeeds), filtered = run(true, overflow, succeeds);
    expect(filtered.selected).toStrictEqual(reference.selected);
    expect(filtered.attempts).toStrictEqual(reference.attempts);
    expect(filtered.tries).toBe(reference.tries);
    expect(filtered.attempts).toHaveLength(succeeds ? 3 : 4);
    expect(filtered.checks).toBeLessThanOrEqual(reference.checks);
    originalChecks += reference.checks; filteredChecks += filtered.checks;
  }
  expect(filteredChecks).toBeLessThan(originalChecks);
});
