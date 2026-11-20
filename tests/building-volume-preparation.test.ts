import { createHash } from "node:crypto";
import { expect, it } from "vitest";

import { buildingVolumeClearance, prepareBuildingVolumeClearance } from "../src/render-common/buildings/building-navigation-geometry";
import type { BuildingNavigationVolume } from "../src/render-common/buildings/building-navigation-types";

const volumes: BuildingNavigationVolume[] = [
  { min: [-2, 0, -1], max: [2, 3, 1] },
  { min: [-2, 0, -1], max: [2, 3, 1], shape: "ellipse", yaw: .7 },
  { min: [-.000001, -100, -1000000], max: [.000001, 100, 1000000], shape: "ellipse", yaw: Math.PI / 2 },
  { min: [1, 0, 2], max: [1, 0, 2], shape: "ellipse" },
  { min: [2, 3, 4], max: [-2, -3, -4], shape: "ellipse", yaw: -10 },
  { min: [-3000, 1, 12000], max: [123456, 3, 12345], shape: "box", yaw: 12345.6789 },
  { min: [-3, 0, -2], max: [3, 2, 2], shape: "ellipse", yaw: -Math.PI / 2 },
  { min: [-1, 0, -1], max: [1, 2, 1], shape: "ellipse", yaw: 0 }
];
const points = Array.from({ length: 257 }, (_, index) => ({ x: (index % 17 - 8) * .31875,
  z: (Math.floor(index / 17) - 7) * .413125 }));
points.push({ x: 0, z: 0 }, { x: -0, z: -0 }, { x: 1, z: 0 }, { x: 1 + Number.EPSILON, z: 0 },
  { x: 1 - Number.EPSILON, z: 0 }, { x: 1000000, z: -1000000 });

it("preserves the exact canonical clearance bits for rotated boxes, ellipse edges and extreme bounds", () => {
  const bytes = Buffer.alloc(volumes.length * points.length * 8);
  let offset = 0;
  for (const volume of volumes) {
    const clearance = prepareBuildingVolumeClearance(volume);
    for (const point of points) {
      const expected = buildingVolumeClearance(volume, point.x, point.z);
      expect(Object.is(clearance(point.x, point.z), expected)).toBe(true);
      bytes.writeDoubleLE(expected, offset); offset += 8;
    }
  }
  // Recorded from the canonical evaluator before introducing preparation.
  expect(createHash("sha256").update(bytes).digest("hex")).toBe("edafff3b3c3efaa38c633c483f9662886538070af5597dcb2c88dd71ef319051");
});

it("snapshots invariant data only for its query and observes mutated volume data on the next preparation", () => {
  const volume: BuildingNavigationVolume = { min: [-1, 0, -1], max: [1, 2, 1], shape: "box" };
  const original = prepareBuildingVolumeClearance(volume), value = original(2, .5);
  volume.min = [-4, 0, -1]; volume.max = [1, 2, 3]; volume.yaw = .8; volume.shape = "ellipse";
  expect(Object.is(original(2, .5), value)).toBe(true);
  const changed = prepareBuildingVolumeClearance(volume);
  expect(Object.is(changed(2, .5), buildingVolumeClearance(volume, 2, .5))).toBe(true);
  expect(changed(2, .5)).not.toBe(value);
});
