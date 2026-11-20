import { expect, it } from "vitest";

import { snapExistingRoadEndpoint } from "../src/app/settlement/road-endpoint";
import { createRoadNetwork } from "../src/shared/settlement/road-network";

it("joins a visually touching separate road instead of stopping at the old component end", () => {
  const roads = createRoadNetwork({
    cellsX: 16,
    cellsZ: 16,
    heights: new Float32Array(17 * 17),
    blocking: new Uint8Array(16 * 16)
  });
  expect(roads.addRoad({ x: 2, z: 4 }, { x: 4, z: 4 })).toBe(true);
  expect(roads.addRoad({ x: 4.5, z: 4 }, { x: 7, z: 4 })).toBe(true);
  // Older saved roads or removed sections can still leave a gap for pointer snapping.
  expect(roads.removeRoad({ x: 4, z: 4 }, { x: 4.5, z: 4 })).toBe(true);
  expect(roads.route({ x: 2, z: 4 }, { x: 7, z: 4 })).toBeNull();
  const target = snapExistingRoadEndpoint({ x: 4, z: 4 }, roads.segments(), { x: 2, z: 4 });
  expect(target).toEqual({ x: 4.5, z: 4 });
  expect(roads.addRoad({ x: 2, z: 4 }, target!)).toBe(true);
  expect(roads.route({ x: 2, z: 4 }, { x: 7, z: 4 })).not.toBeNull();
});

it("leaves distant clicks free and snaps an initial click to an actual existing node", () => {
  const sections = [{ start: { x: 2, z: 3 }, end: { x: 2.5, z: 3 }, tier: "dirt" as const }];
  expect(snapExistingRoadEndpoint({ x: 2.45, z: 3.15 }, sections, null)).toEqual({ x: 2.5, z: 3 });
  expect(snapExistingRoadEndpoint({ x: 4, z: 5 }, sections, null)).toBeNull();
});
