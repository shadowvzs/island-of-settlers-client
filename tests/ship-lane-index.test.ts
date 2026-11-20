import { expect, it } from "vitest";

import { ENVELOPE_REACH, type ShipObstacle } from "../src/shared/settlement/settlement-ship-clearance";
import { createShipLaneIndex } from "../src/shared/settlement/settlement-ship-lane-index";

it("rechecks strict reach for different points sharing a cached bucket neighbourhood", () => {
  const r = ENVELOPE_REACH;
  const ways = [{ x: -.5 * r, z: .1 * r, yaw: 0 }, { x: 2.5 * r, z: .1 * r, yaw: 0 }];
  const indexed = createShipLaneIndex(ways);
  for (const x of [.1 * r, 1.9 * r, .1 * r, 1.9 * r]) {
    const point = { x, z: .1 * r, yaw: 0 }, visited: ShipObstacle[] = [];
    indexed(point, way => { visited.push(way); return false; });
    expect(visited).toStrictEqual(ways.filter(way =>
      Math.abs(way.x - point.x) < r && Math.abs(way.z - point.z) < r));
  }
});

it("retains strict reach boundaries and the original lane callback order across bucket edges", () => {
  const r = ENVELOPE_REACH;
  for (const center of [0, -0, r * 2, -r * 2, .217, 1024, -40, 1e308]) {
    const point = { x: center, z: center, yaw: .217 };
    const ways = [-r - 1e-10, -r, -r + 1e-10, -.1, 0, .1, r - 1e-10, r, r + 1e-10]
      .flatMap(x => [-r - 1e-10, -r, -r + 1e-10, 0, r - 1e-10, r, r + 1e-10]
        .map(z => ({ x: center + x, z: center + z, yaw: x + z })));
    const index = createShipLaneIndex(ways);
    const expected = ways.filter(way => Math.abs(way.x - point.x) < r && Math.abs(way.z - point.z) < r);
    const seen: ShipObstacle[] = [];
    expect(index(point, way => { seen.push(way); return false; })).toBe(false);
    expect(seen).toStrictEqual(expected);
    for (const stop of [0, 1, Math.floor(expected.length / 2), expected.length]) {
      const order: ShipObstacle[] = [];
      const found = index(point, way => { order.push(way); return order.length === stop; });
      expect(order).toStrictEqual(expected.slice(0, stop || expected.length));
      expect(found).toBe(stop > 0 && stop <= expected.length);
    }
  }
});

it("matches the linear broad phase for long crossing lanes and repeated moving queries", () => {
  const ways = Array.from({ length: 2400 }, (_, index) => ({
    x: (index * 37 % 6000) / 10 - 100, z: (index * 79 % 6000) / 10 - 100, yaw: index / 17
  }));
  const indexed = createShipLaneIndex(ways), r = ENVELOPE_REACH;
  for (let index = 0; index < 2000; index++) {
    const point = { x: (index * 71 % 6000) / 10 - 100, z: (index * 43 % 6000) / 10 - 100, yaw: index / 11 };
    const expected = ways.filter(way => Math.abs(way.x - point.x) < r && Math.abs(way.z - point.z) < r);
    const actual: ShipObstacle[] = [];
    indexed(point, way => { actual.push(way); return false; });
    expect(actual).toStrictEqual(expected);
  }
});
