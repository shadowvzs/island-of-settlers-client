import { describe, expect, it } from "vitest";

import { tentClothPoint, tentRoofHeight } from "../src/renderers/three/settlement/camp-tent-cloth";

describe("camp canvas support and footprint", () => {
  it("softens corners without expanding the navigation envelope", () => {
    const width = 2.7, depth = 2.8;
    for (let row = 0; row <= 20; row++) for (let column = 0; column <= 20; column++) {
      const [x, z] = tentClothPoint(width, depth, column / 20, row / 20);
      expect(Math.abs(x)).toBeLessThanOrEqual(width / 2);
      expect(Math.abs(z)).toBeLessThanOrEqual(depth / 2);
    }
    const corner = tentClothPoint(width, depth, 1, 1);
    expect(corner[0]).toBeLessThan(width / 2);
    expect(corner[1]).toBeLessThan(depth / 2);
    expect(tentClothPoint(width, depth, .5, 1)).toEqual([0, depth / 2]);
  });
  it("keeps roof corners on supporting poles and sags between them", () => {
    for (const shape of ["ridge", "hipped", "pagoda"] as const) {
      expect(tentRoofHeight(shape, 0, 0, .65, 2.4)).toBeCloseTo(.65);
      expect(tentRoofHeight(shape, 1, 1, .65, 2.4)).toBeCloseTo(.65);
    }
    const taut = .65 + (2.4 - .65) * .5;
    expect(tentRoofHeight("ridge", .25, .5, .65, 2.4)).toBeLessThan(taut);
    expect(tentRoofHeight("ridge", .5, .5, .65, 2.4)).toBeCloseTo(2.4);
  });
  it("leaves the half hip entrance tall while closing the rear slope", () => {
    expect(tentRoofHeight("hipped", .5, 1, .65, 2.4)).toBeCloseTo(2.4);
    expect(tentRoofHeight("hipped", .5, 0, .65, 2.4)).toBeCloseTo(.65);
    expect(tentRoofHeight("saddle", .5, .5, 1.2, 2.4)).toBeLessThan(2.4);
  });
});
