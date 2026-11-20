import { BufferGeometry, DoubleSide, Float32BufferAttribute, FrontSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { chineseRoofBeddingHeight } from "../src/render-common/buildings/chinese-roof-bedding";
import { leveledBuildingRecipe } from "../src/render-common/buildings/levels/leveled-building-recipe";
import { createChinesePanCoverRoof } from "../src/renderers/three/buildings/chinese-pan-cover-roof";

it.each([true, false])("closes the actual clipped half-hip bedding eaves (%s)", detailed => {
  const roofs = leveledBuildingRecipe(getBuildingDefinition(37), "chinese", detailed, 5).parts
    .filter(part => part.shape === "occupation-roof" && part.occupationRoof === "half-hip");
  for (const roof of roofs) {
    const geometry = createChinesePanCoverRoof(roof, detailed), position = geometry.getAttribute("position");
    const colours = geometry.getAttribute("color"), indices = geometry.index!, walls: number[] = [];
    for (let index = 0; index < indices.count; index += 3) {
      const ids = [indices.getX(index), indices.getX(index + 1), indices.getX(index + 2)];
      if (!ids.every(id => Math.abs(colours.getX(id) - .9) < 1e-6)) continue;
      const points = ids.map(id => new Vector3().fromBufferAttribute(position, id));
      const normal = points[1]!.clone().sub(points[0]!).cross(points[2]!.clone().sub(points[0]!)).normalize();
      if (Math.abs(normal.y) < 1e-8) points.forEach(point => walls.push(...point.toArray()));
    }
    const wallGeometry = new BufferGeometry();
    wallGeometry.setAttribute("position", new Float32BufferAttribute(walls, 3));
    const material = new MeshBasicMaterial({ side: DoubleSide }), mesh = new Mesh(wallGeometry, material);
    mesh.updateMatrixWorld();
    try {
      for (const sideX of [-1, 1]) for (const sideZ of [-1, 1]) for (const x of [.33, .4, .47]) {
        const top = chineseRoofBeddingHeight(roof, sideX * x, sideZ * .5, detailed)!;
        const ray = new Raycaster(new Vector3(sideX * x, top - .035, sideZ * .6),
          new Vector3(0, 0, -sideZ));
        const hit = ray.intersectObject(mesh)[0];
        expect(hit, `${detailed}/${sideX}/${sideZ}/${x}: exterior bed wall`).toBeDefined();
        expect(hit!.point.z).toBeCloseTo(sideZ * .5, 6);
      }
    } finally { geometry.dispose(); wallGeometry.dispose(); material.dispose(); }
  }
});

it.each([true, false])("orients ceramic eave skirts toward the actual FrontSide exterior (%s)", detailed => {
  const roofs = leveledBuildingRecipe(getBuildingDefinition(37), "chinese", detailed, 5).parts
    .filter(part => part.shape === "occupation-roof" && part.occupationRoof === "half-hip");
  for (const roof of roofs) {
    const geometry = createChinesePanCoverRoof(roof, detailed);
    const material = new MeshBasicMaterial({ side: FrontSide }), mesh = new Mesh(geometry, material);
    mesh.updateMatrixWorld();
    try {
      for (const sideX of [-1, 1]) for (const sideZ of [-1, 1]) {
        const x = sideX * .4, z = sideZ * .4995;
        const y = chineseRoofBeddingHeight(roof, x, z, detailed)! + .02;
        const ray = new Raycaster(new Vector3(x, y, sideZ * .6), new Vector3(0, 0, -sideZ));
        const hit = ray.intersectObject(mesh)[0];
        expect(hit, `${detailed}/${sideX}/${sideZ}: opaque exterior ceramic skirt`).toBeDefined();
        expect(hit!.point.z).toBeCloseTo(z, 6);
        expect(hit!.face!.normal.z * sideZ).toBeGreaterThan(.99);
      }
    } finally { geometry.dispose(); material.dispose(); }
  }
});
