import { expect, it } from "vitest";

import type { BuildingPart } from "../src/render-common/buildings/building-recipe";
import { mayaLimestoneDetail } from "../src/renderers/three/buildings/maya-stone-detail";
import { createRomanPartGeometry } from "../src/renderers/three/buildings/roman-building";

it("maps both vertical faces of a real wall corner onto identical world masonry coordinates", () => {
  const front: BuildingPart = { shape: "box", surface: "plaster", stage: 1,
    position: [0, .8, 1], size: [2, 1.6, .1], mayaMasonryUv: "wall", worldUv: 1 };
  const side: BuildingPart = { ...front, position: [.95, .8, 0], size: [.1, 1.6, 2.1] };
  const coordinates: number[][] = [];
  for (const part of [front, side]) {
    const geometry = createRomanPartGeometry(part, true);
    try {
      const positions = geometry.getAttribute("position"), normals = geometry.getAttribute("normal"), uv = geometry.getAttribute("uv");
      for (let index = 0; index < positions.count; index++)
        if (Math.abs(positions.getX(index) - 1) < 1e-6 && Math.abs(positions.getZ(index) - 1.05) < 1e-6 &&
          positions.getY(index) < 1e-6 && Math.abs(normals.getY(index)) < .1)
          coordinates.push([uv.getX(index), uv.getY(index)]);
    } finally { geometry.dispose(); }
  }
  expect(coordinates.length).toBeGreaterThanOrEqual(2);
  for (const uv of coordinates) { expect(uv[0]).toBeCloseTo(2.05, 6); expect(uv[1]).toBeCloseTo(0, 6); }
});

it("keeps actual single ashlar faces free from a contradictory miniature wall grid", () => {
  const part: BuildingPart = { shape: "bevel-box", surface: "cut-stone", stage: 2,
    position: [.3, 1.2, .6], size: [.68, .33, .18], mayaMasonryUv: "block", worldUv: 1.8 };
  const geometry = createRomanPartGeometry(part, true);
  try {
    const uv = geometry.getAttribute("uv"), indices = geometry.index;
    const count = indices?.count ?? uv.count;
    for (let offset = 0; offset < count; offset += 3) {
      let u = 0, v = 0;
      for (let corner = 0; corner < 3; corner++) {
        const index = indices ? indices.getX(offset + corner) : offset + corner;
        u += uv.getX(index) / 3; v += uv.getY(index) / 3;
      }
      expect(mayaLimestoneDetail({ u, v, grain: .5, mineral: .5, weather: .5 }).height).toBeGreaterThan(.60);
    }
  } finally { geometry.dispose(); }
});
