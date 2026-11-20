import { expect, it, vi } from "vitest";

import { snapBuildingPlot } from "../src/app/settlement/building-plot";
import type { PlacementCheck } from "../src/app/settlement/placement-check";
import { roadFacingRotation } from "../src/app/settlement/road-facing-placement";
import { getPlacedBuildingLogistics } from "../src/render-common/buildings/building-grid-metrics";
const point = { x: 20, z: 20 }, type = 17;
const entrance = (rotation: number) => {
  const plot = snapBuildingPlot(type, point, rotation);
  return getPlacedBuildingLogistics(type, plot.x, plot.z, rotation).road;
};
it.each([0, 1, 2, 3])("faces a usable road on side %s without choosing an invalid alternative", desired => {
  const flag = entrance(desired);
  const roads = [{ start: { x: flag.x - .5, z: flag.z }, end: { x: flag.x + .5, z: flag.z } }];
  const check = (rotation: number) => ({ reason: null,
    ghost: { road: rotation === desired ? [] : null } } as unknown as PlacementCheck);
  expect(roadFacingRotation(type, point, (desired + 2) % 4, roads, check)).toBe(desired);
  expect(roadFacingRotation(type, point, (desired + 2) % 4, roads,
    rotation => ({ ...check(rotation), reason: "Blocked" }))).toBe((desired + 2) % 4);
});
it("keeps the current rotation without nearby roads and performs no path checks", () => {
  const check = vi.fn();
  expect(roadFacingRotation(type, point, 2, [], check)).toBe(2);
  expect(check).not.toHaveBeenCalled();
});
