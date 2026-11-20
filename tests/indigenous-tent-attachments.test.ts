import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import { expect, it } from "vitest";

import type { BuildingPart, BuildingRecipe } from "../src/render-common/buildings/building-recipe";
import { getRomanPartBounds } from "../src/render-common/buildings/building-recipe-fit";
import { addIndigenousSkirtPegs, indigenousSkirtAnchors }
  from "../src/render-common/buildings/indigenous-tent-attachments";
import { createIndigenousFrameSkin } from "../src/renderers/three/buildings/indigenous-frame-skin";

it("ties rounded fortress skirts to actual cloth at both detail levels", () => {
  for (const detailed of [true, false]) for (const radius of [.065, .20]) {
    const geometry = createIndigenousFrameSkin(detailed, undefined, undefined, radius);
    const material = new MeshBasicMaterial({ side: DoubleSide }), mesh = new Mesh(geometry, material);
    mesh.updateMatrixWorld(true);
    for (const [x, z] of indigenousSkirtAnchors("framed", radius, detailed)) {
      const point = new Vector3(x, -.484, z), origin = new Vector3(x * 1.2, -.484, z * 1.2);
      const ray = new Raycaster(origin, point.clone().sub(origin).normalize());
      const hit = ray.intersectObject(mesh)[0];
      expect(hit, `${detailed}/${radius}/${x}/${z}`).toBeDefined();
      expect(Math.hypot(x, z) - Math.hypot(hit!.point.x, hit!.point.z),
        "rope root must not float outside the actual sleeve").toBeLessThan(.003);
      expect(hit!.point.distanceTo(point), "tie may sink slightly into the sewn hem").toBeLessThan(.016);
    }
    geometry.dispose(); material.dispose();
  }
});

it("buries stakes and keeps them clear of foundation rocks and service lanes", () => {
  const parts: BuildingPart[] = [], recipe: BuildingRecipe = {
    door: [0, 0, 5], doorProfile: "flat", mechanism: [0, 0, 0], parts: [],
    workPoint: [5, 0, 5], workerExit: [5, 0, 6]
  };
  const rock: BuildingPart = { position: [-.4, .025, .49], shape: "rock",
    size: [.23, .25, .3], stage: 0, surface: "stone" };
  addIndigenousSkirtPegs(part => parts.push({ stage: 1, ...part }), [0, 0, 0], [1, 2, 1], "framed",
    recipe, [rock], true, .20);
  const stakes = parts.filter(part => part.shape === "cylinder");
  expect(stakes.length).toBeGreaterThan(4);
  const bounds = getRomanPartBounds(rock);
  for (const stake of stakes) {
    expect(stake.position[1] - stake.size[1] / 2).toBeLessThan(0);
    const [x, , z] = stake.position;
    expect(x > bounds.min[0] - .05 && x < bounds.max[0] + .05
      && z > bounds.min[2] - .05 && z < bounds.max[2] + .05).toBe(false);
  }
});
