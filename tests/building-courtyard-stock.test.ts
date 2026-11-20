import { expect, it } from "vitest";

import { isBuildingCourtyardPointWalkable } from "../src/render-common/buildings/building-courtyard";

it("opens empty farm stock lanes while retaining loaded bundles and house collisions", () => {
  let emptyOnly = 0, permanent = 0;
  for (let x = -1.9; x <= 1.9; x += .1) for (let z = -1.9; z <= 1.9; z += .1) {
    const point = { x, z };
    const empty = isBuildingCourtyardPointWalkable(37, 0, 0, 0, point, { grain: 0 });
    const full = isBuildingCourtyardPointWalkable(37, 0, 0, 0, point, { grain: 6 });
    if (empty && !full) emptyOnly++;
    if (!empty) permanent++;
    if (full) expect(empty).toBe(true);
    for (const rotation of [1, 2, 3]) {
      const angle = rotation * Math.PI / 2;
      const rotated = { x: x * Math.cos(angle) + z * Math.sin(angle),
        z: -x * Math.sin(angle) + z * Math.cos(angle) };
      expect(isBuildingCourtyardPointWalkable(37, 0, 0, rotation, rotated, { grain: 0 })).toBe(empty);
      expect(isBuildingCourtyardPointWalkable(37, 0, 0, rotation, rotated, { grain: 6 })).toBe(full);
    }
  }
  expect(emptyOnly).toBeGreaterThan(0);
  expect(permanent).toBeGreaterThan(0);
});
