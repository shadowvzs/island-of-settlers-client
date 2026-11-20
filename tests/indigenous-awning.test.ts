import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import { expect, it } from "vitest";

import { indigenousRoofHeight } from "../src/render-common/buildings/indigenous-roof-profile";
import { createIndigenousAwningSkin } from "../src/renderers/three/buildings/indigenous-awning-skin";

it("keeps the original textile top and a small folded hem without solid gables or a false flat underside", () => {
  for (const detailed of [true, false]) {
    const geometry = createIndigenousAwningSkin(detailed), material = new MeshBasicMaterial({ side: DoubleSide });
    const mesh = new Mesh(geometry, material); mesh.updateMatrixWorld(true);
    expect(Array.from(geometry.getAttribute("position").array).every(value => Math.abs(value) <= .50001)).toBe(true);
    for (const x of [-.25, 0, .25]) for (const z of [-.25, 0, .25]) {
      const expected = indigenousRoofHeight("awning", x, z);
      const above = new Raycaster(new Vector3(x, 1, z), new Vector3(0, -1, 0)).intersectObject(mesh)[0]!;
      const below = new Raycaster(new Vector3(x, -1, z), new Vector3(0, 1, 0)).intersectObject(mesh)[0]!;
      expect(above.point.y).toBeCloseTo(expected, 5);
      expect(below.point.y).toBeCloseTo(expected, 5);
    }
    expect(new Raycaster(new Vector3(0, 0, 1), new Vector3(0, 0, -1)).intersectObject(mesh)).toEqual([]);
    geometry.dispose(); material.dispose();
  }
});
