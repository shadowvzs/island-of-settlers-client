import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import { expect, it } from "vitest";

import { createIndigenousRoofGeometry }
  from "../src/renderers/three/buildings/indigenous-roof-geometry";

it("keeps the stretched entrance hood straight without sawtooth triangles on either LOD", () => {
  const entrance: [number, number, number] = [-.14, .14, -.12];
  for (const detailed of [true, false]) {
    const geometry = createIndigenousRoofGeometry("tipi", detailed, entrance);
    const material = new MeshBasicMaterial({ side: DoubleSide }), roof = new Mesh(geometry, material);
    roof.updateMatrixWorld();
    for (const x of [-.139, -.10, 0, .10, .139]) for (const z of [.36, .38, .40, .42]) {
      if (Math.hypot(x, z) > .46) continue;
      const hits = new Raycaster(new Vector3(x, 1, z), new Vector3(0, -1, 0)).intersectObject(roof);
      expect(hits.length, `${detailed}/${x}/${z}`).toBeGreaterThan(0);
      expect(Math.abs(hits[0]!.point.y - entrance[2])).toBeLessThan(.0035);
    }
    for (const value of geometry.getAttribute("position").array)
      expect(Math.abs(value)).toBeLessThanOrEqual(.50001);
    material.dispose();geometry.dispose();
  }
});
