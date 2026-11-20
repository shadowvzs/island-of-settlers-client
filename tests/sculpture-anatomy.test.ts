import { expect, it } from "vitest";

import { anatomySurface, type SculptureAnatomy, sculptureAnatomyDistance } from "../src/render-common/props/national-sculptures/sculpture-anatomy";

it("finds a muzzle surface even when coordinate zero is outside its detached query cross-section", () => {
  const shape: SculptureAnatomy = { kind: "anatomy", blend: .02, resolution: 20,
    bounds: { min: [-.2, .7, .4], max: [.2, 1.1, .8] },
    lobes: [{ position: [0, .9, .6], radii: [.1, .1, .1] }] };
  const z = anatomySurface(shape, [.03, .92, 0], 2);
  expect(z).toBeGreaterThan(.68);
  expect(Math.abs(sculptureAnatomyDistance(shape, .03, .92, z))).toBeLessThan(.00001);
  expect(anatomySurface(shape, [.2, .92, 0], 2)).toBe(0);
});
