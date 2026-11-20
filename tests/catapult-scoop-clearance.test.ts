import { Euler, Matrix4, Quaternion, Vector3 } from "three";
import { expect, it } from "vitest";

import { CATAPULT_ARM, CATAPULT_ENGINE_SCALE, CATAPULT_SCOOP, CATAPULT_SCOOP_SOCKET, catapultMechanismPoint } from "../src/render-common/buildings/catapult-mechanism";
import { createCatapultTowerRecipe } from "../src/render-common/buildings/catapult-tower-recipe";

it.each([false, true])("keeps the shortened beam and underside socket outside the hollow scoop, detailed=%s", detailed => {
  const recipe = createCatapultTowerRecipe("roman", detailed);
  const solidParts = recipe.parts.filter(part => part.catapultPart === "arm" && part.shape !== "catapult-scoop");
  expect(solidParts).toHaveLength(2);
  const inverse = new Matrix4().compose(new Vector3(...CATAPULT_SCOOP.position),
    new Quaternion().setFromEuler(new Euler(CATAPULT_SCOOP.pitch, 0, 0)), new Vector3(1, 1, 1)).invert();
  for (const part of solidParts) {
    const transform = new Matrix4().compose(new Vector3(...part.position),
      new Quaternion().setFromEuler(new Euler(...(part.rotation ?? [0, 0, 0]))), new Vector3(1, 1, 1));
    const corners = [-1, 1].flatMap(x => [-1, 1].flatMap(y => [-1, 1].map(z =>
      new Vector3(x * part.size[0] / 2, y * part.size[1] / 2, z * part.size[2] / 2).applyMatrix4(transform).applyMatrix4(inverse))));
    if (part.size[1] === CATAPULT_ARM.size[1])
      expect(Math.max(...corners.map(point => point.z))).toBeLessThanOrEqual(-CATAPULT_SCOOP.size[2] / 2 + 1e-8);
    else {
      expect(part.size).toEqual([...CATAPULT_SCOOP_SOCKET.size]);
      expect(Math.max(...corners.map(point => point.y))).toBeLessThan(CATAPULT_SCOOP.innerFloor * CATAPULT_SCOOP.size[1]);
    }
  }
  const oldCenter = catapultMechanismPoint([0, 2.39, .08]), oldLength = 1.24 * CATAPULT_ENGINE_SCALE;
  const originalLower = new Vector3(...oldCenter).addScaledVector(new Vector3(0, Math.cos(.58), Math.sin(.58)), -oldLength / 2);
  const shortenedLower = new Vector3(...CATAPULT_ARM.position).addScaledVector(new Vector3(0, Math.cos(.58), Math.sin(.58)), -CATAPULT_ARM.size[1] / 2);
  expect(shortenedLower.distanceTo(originalLower)).toBeLessThan(1e-8);
});

it.each([false, true])("fits the enlarged actual rock inside the carved scoop without wall penetration, detailed=%s", async detailed => {
  const { CATAPULT_STONE_DIAMETER, CATAPULT_STONE_SEAT_LIFT } = await import("../src/render-common/buildings/catapult-mechanism");
  const { createCatapultRockGeometry } = await import("../src/renderers/three/buildings/catapult-rock-geometry");
  const geometry = createCatapultRockGeometry(detailed), vertices = geometry.getAttribute("position");
  const inner = [[-.22, 0], [-.20, .22], [-.08, .34], [.20, .39], [.5, .40]] as const;
  const points = Array.from({ length: vertices.count }, (_, index) => {
    const x = vertices.getX(index) * CATAPULT_STONE_DIAMETER;
    const y = vertices.getY(index) * CATAPULT_STONE_DIAMETER, z = vertices.getZ(index) * CATAPULT_STONE_DIAMETER;
    return new Vector3(x, y * Math.cos(CATAPULT_SCOOP.pitch) + z * Math.sin(CATAPULT_SCOOP.pitch) +
      CATAPULT_SCOOP.innerFloor * CATAPULT_SCOOP.size[1] + CATAPULT_STONE_DIAMETER / 2 + CATAPULT_STONE_SEAT_LIFT,
    z * Math.cos(CATAPULT_SCOOP.pitch) - y * Math.sin(CATAPULT_SCOOP.pitch));
  });
  const samples = [...points], indices = geometry.getIndex(), rim = CATAPULT_SCOOP.size[1] / 2;
  // Clip the actual triangles at the rim: an above-rim vertex alone cannot prove its edge clears the lip.
  for (let index = 0; index < (indices?.count ?? points.length); index += 3) for (let edge = 0; edge < 3; edge++) {
    const a = points[indices ? indices.getX(index + edge) : index + edge]!;
    const b = points[indices ? indices.getX(index + (edge + 1) % 3) : index + (edge + 1) % 3]!;
    if ((a.y - rim) * (b.y - rim) < 0) samples.push(a.clone().lerp(b, (rim - a.y) / (b.y - a.y)));
  }
  let contained = 0, smallestGap = Infinity;
  for (const { x, y, z } of samples) {
    const height = y / CATAPULT_SCOOP.size[1];
    if (height > .5 + 1e-8) continue;
    expect(height).toBeGreaterThanOrEqual(-.22 - 1e-7);
    for (let row = 1; row < inner.length; row++) {
      const before = inner[row - 1]!, after = inner[row]!;
      if (height < before[0] || height > after[0] + 1e-8) continue;
      const radius = before[1] + (after[1] - before[1]) * (height - before[0]) / (after[0] - before[0]);
      // The carved Lathe cavity is faceted: its inscribed polygon is narrower than the ideal circle.
      const segments = detailed ? 24 : 12;
      let demand = -Infinity;
      for (let side = 0; side < segments; side++) {
        const angle = (side + .5) * 2 * Math.PI / segments;
        demand = Math.max(demand, (x / CATAPULT_SCOOP.size[0] * Math.sin(angle) +
          z / CATAPULT_SCOOP.size[2] * Math.cos(angle)) / Math.cos(Math.PI / segments));
      }
      const gap = radius - demand;
      smallestGap = Math.min(smallestGap, gap); contained++;
      expect(gap).toBeGreaterThanOrEqual(-1e-7);
    }
  }
  expect(CATAPULT_STONE_DIAMETER).toBe(.23375);
  expect(contained).toBeGreaterThan(10); expect(smallestGap).toBeGreaterThan(0);
  geometry.dispose();
});
