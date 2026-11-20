import { expect, it } from "vitest";

import { createShapeFields } from "../src/shared/world/generation/heights";

it("varies closed border shorelines deterministically while retaining the sea margin", () => {
  const grid = { cellsX: 128, cellsZ: 128 };
  const layout = { kind: "island" as const, openSide: null, shape: () => 2 };
  const first = createShapeFields(grid, 123, layout, 0).continentalness;
  expect(createShapeFields(grid, 123, layout, 0).continentalness).toEqual(first);
  const crossings: number[] = [];
  for (let x = 16; x < 112; x++) {
    expect(first[x]).toBeLessThan(0);
    let z = 1;
    while (first[z * 129 + x]! < 0 && z < 20) z++;
    const before = first[(z - 1) * 129 + x]!, after = first[z * 129 + x]!;
    crossings.push(z - 1 - before / (after - before));
  }
  expect(Math.max(...crossings) - Math.min(...crossings)).toBeGreaterThan(2);
  expect(first[64 * 129 + 64]).toBeGreaterThan(0);
});
