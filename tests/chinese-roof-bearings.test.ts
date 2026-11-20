import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { chineseRoofSoffit } from "../src/render-common/buildings/chinese-roof-bearings";
import { leveledBuildingRecipe } from "../src/render-common/buildings/levels/leveled-building-recipe";
import { createChinesePanCoverRoof } from "../src/renderers/three/buildings/chinese-pan-cover-roof";

it.each([true, false])("samples actual Chinese roof undersides rather than bounding boxes (%s)", detailed => {
  const recipe = leveledBuildingRecipe(getBuildingDefinition(0), "chinese", detailed, 1);
  const roofs = recipe.parts.filter(part => part.shape === "occupation-roof" && part.roofTiles === "pan-cover");
  expect(roofs.length).toBeGreaterThanOrEqual(2);
  for (const roof of roofs) {
    const geometry = createChinesePanCoverRoof(roof, detailed);
    const material = new MeshBasicMaterial({ side: DoubleSide });
    const mesh = new Mesh(geometry, material);
    mesh.scale.set(...roof.size); mesh.position.set(...roof.position);
    if (roof.rotation) mesh.rotation.set(...roof.rotation);
    mesh.updateMatrixWorld(true);
    for (const u of [-.35, -.17, .13, .36]) for (const v of [-.37, -.12, .16, .39]) {
      const yaw = roof.rotation?.[1] ?? 0;
      const x = roof.position[0] + Math.cos(yaw) * u * roof.size[0] + Math.sin(yaw) * v * roof.size[2];
      const z = roof.position[2] - Math.sin(yaw) * u * roof.size[0] + Math.cos(yaw) * v * roof.size[2];
      const hit = new Raycaster(new Vector3(x, roof.position[1] - roof.size[1], z), new Vector3(0, 1, 0))
        .intersectObject(mesh)[0];
      expect(hit).toBeDefined();
      expect(chineseRoofSoffit(roof, x, z, detailed)).toBeCloseTo(hit!.point.y, 6);
    }
    geometry.dispose(); material.dispose();
  }
});

it.each([true, false])("keeps the hip ridge breaks bonded to continuous roof bedding (%s)", detailed => {
  const recipe = leveledBuildingRecipe(getBuildingDefinition(0), "chinese", detailed, 1);
  for (const roof of recipe.parts.filter(part => part.shape === "occupation-roof" && part.occupationRoof === "hip")) {
    const yaw = roof.rotation?.[1] ?? 0;
    for (const side of [-1, 1]) {
      const z = side * .3 * roof.size[2];
      const worldX = roof.position[0] + Math.sin(yaw) * z;
      const worldZ = roof.position[2] + Math.cos(yaw) * z;
      // Bearings meet the actual underlay, including its inset beneath convex ceramic chords.
      const geometry = createChinesePanCoverRoof(roof, detailed);
      const material = new MeshBasicMaterial({ side: DoubleSide }), mesh = new Mesh(geometry, material);
      mesh.scale.set(...roof.size); mesh.position.set(...roof.position);
      if (roof.rotation) mesh.rotation.set(...roof.rotation);
      mesh.updateMatrixWorld(true);
      const hit = new Raycaster(new Vector3(worldX, roof.position[1] - roof.size[1], worldZ),
        new Vector3(0, 1, 0)).intersectObject(mesh)[0];
      expect(hit).toBeDefined();
      expect(chineseRoofSoffit(roof, worldX, worldZ, detailed)).toBeCloseTo(hit!.point.y, 6);
      geometry.dispose(); material.dispose();
    }
  }
});
