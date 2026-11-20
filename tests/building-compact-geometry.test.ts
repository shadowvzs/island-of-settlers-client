import { Vector3 } from "three";
import { expect, it } from "vitest";

import type { BuildingPart } from "../src/render-common/buildings/building-recipe";
import { roofTopAt } from "../src/render-common/buildings/levels/level-roof-surface";
import { createNationRoofGeometry } from "../src/renderers/three/buildings/nation-roof-geometry";
import { createRomanPartGeometry } from "../src/renderers/three/buildings/roman-building";

it("keeps the compact roof's contact sampler on its rendered triangles", () => {
  const part: BuildingPart = { compactGeometry: true, position: [0, 0, 0], roofProfile: "japanese-pyramid",
    shape: "nation-roof", size: [1, 1, 1], stage: 4, surface: "roof" };
  const compact = createNationRoofGeometry("japanese-pyramid", false, part.size, undefined, true);
  const ordinary = createNationRoofGeometry("japanese-pyramid", false);
  expect(compact.index!.count).toBeLessThan(ordinary.index!.count);
  const positions = compact.attributes.position!, indices = compact.index!;
  // The first eight triangles are the four compact roof slopes; the rest close the eave rims.
  for (let offset = 0; offset < 24; offset += 3) {
    const centre = new Vector3();
    for (let vertex = 0; vertex < 3; vertex++)
      centre.add(new Vector3().fromBufferAttribute(positions, indices.getX(offset + vertex)));
    centre.divideScalar(3);
    expect(roofTopAt([part], centre.x, centre.z, false)).toBeCloseTo(centre.y, 6);
  }
  compact.dispose(); ordinary.dispose();
});

it("retains the chamfered trim envelope while reducing its hidden ring density", () => {
  const part: BuildingPart = { position: [1, 2, 3], shape: "bevel-box", size: [.2, .1, .3],
    stage: 3, surface: "wood" };
  const ordinary = createRomanPartGeometry(part, true);
  const compact = createRomanPartGeometry({ ...part, compactGeometry: true }, true);
  ordinary.computeBoundingBox(); compact.computeBoundingBox();
  expect(compact.boundingBox).toEqual(ordinary.boundingBox);
  expect(compact.index?.count ?? compact.attributes.position!.count)
    .toBeLessThan(ordinary.index?.count ?? ordinary.attributes.position!.count);
  compact.dispose(); ordinary.dispose();
});

it("retains Viking roof height after removing redundant longitudinal strips", () => {
  const roof: BuildingPart = { position: [0, 0, 0], roofProfile: "viking", shape: "nation-roof",
    size: [1, 1, 1], stage: 4, surface: "roof" };
  for (const x of [-.5, -.375, -.25, -.125, 0, .125, .25, .375, .5]) {
    const height = roofTopAt([roof], x, -.49, false);
    for (const z of [-.25, 0, .25, .49]) expect(roofTopAt([roof], x, z, false)).toBeCloseTo(height!, 12);
  }
});
