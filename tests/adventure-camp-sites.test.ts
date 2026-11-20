import { expect, it } from "vitest";

import { rankAdventureCampSites } from "../src/shared/settlement/adventure-camp-sites";

it.each([{ x: 4, z: 48 }, { x: 92, z: 48 }, { x: 48, z: 4 }, { x: 48, z: 92 }])(
  "keeps six camps together inland opposite a landing at %j", beach => {
    const centre = { x: 48, z: 48 };
    const points = [];
    for (let z = 10; z < 86; z += 3) for (let x = 10; x < 86; x += 3) points.push({ x, z });
    const ranked = rankAdventureCampSites(points, beach, centre);
    const chosen: typeof points = [];
    for (const point of ranked) {
      if (chosen.some(other => Math.hypot(other.x - point.x, other.z - point.z) < 9)) continue;
      chosen.push(point);
      if (chosen.length === 6) break;
    }
    expect(chosen).toHaveLength(6);
    for (const point of chosen) {
      expect((point.x - centre.x) * (centre.x - beach.x) +
        (point.z - centre.z) * (centre.z - beach.z)).toBeGreaterThan(0);
      expect(Math.hypot(point.x - beach.x, point.z - beach.z)).toBeGreaterThan(24);
      for (const other of chosen) expect(Math.hypot(point.x - other.x, point.z - other.z)).toBeLessThan(30);
    }
    expect(rankAdventureCampSites([...points].reverse(), beach, centre)).toEqual(ranked);
  }
);

it("still ranks available ground when the preferred enemy area is obstructed", () => {
  const candidates = [{ x: 30, z: 30 }, { x: 35, z: 40 }];
  expect(rankAdventureCampSites(candidates, { x: 4, z: 48 }, { x: 48, z: 48 }))
    .toEqual([{ x: 35, z: 40 }, { x: 30, z: 30 }]);
});
